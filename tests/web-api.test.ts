import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  READ_TIMEOUT_MESSAGE,
  REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  SLOW_REQUEST_TIMEOUT_MS,
  WRITE_TIMEOUT_MESSAGE,
  api,
  errorMessage,
  request,
} from '../web/api.js';

/** fetch qui ne répond jamais : seule l’annulation du signal le termine. */
function hangingFetch(t: TestContext) {
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit = {}) => {
    calls.push(init);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
  });
  return calls;
}

function respondWith(t: TestContext, response: () => Response) {
  t.mock.method(globalThis, 'fetch', async () => response());
}

test('une modification sans réponse échoue après le délai avec un message clair', async (t) => {
  hangingFetch(t);
  await assert.rejects(
    request('/api/admin/opening', { method: 'PATCH', body: '{}', timeoutMs: 20 }),
    (error: unknown) => {
      assert.ok(error instanceof RequestTimeoutError);
      assert.equal(errorMessage(error), WRITE_TIMEOUT_MESSAGE);
      return true;
    },
  );
});

test('une lecture sans réponse ne parle pas de modification perdue', async (t) => {
  hangingFetch(t);
  await assert.rejects(request('/api/state', { timeoutMs: 20 }), (error: unknown) => {
    assert.equal(errorMessage(error), READ_TIMEOUT_MESSAGE);
    return true;
  });
});

test('le délai vaut 15 s par défaut et s’allonge pour les services extérieurs', async (t) => {
  const delays: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    delays.push(ms);
    return timeout(ms);
  });
  respondWith(t, () => Response.json({ snapshot: null, error: null }));
  await request('/api/state');
  await api.testAddonInstance('meteo');
  await api.discoverAgent('camille');
  await api.refreshHomeAssistant();
  assert.deepEqual(delays, [
    REQUEST_TIMEOUT_MS,
    SLOW_REQUEST_TIMEOUT_MS,
    SLOW_REQUEST_TIMEOUT_MS,
    SLOW_REQUEST_TIMEOUT_MS,
  ]);
  assert.equal(REQUEST_TIMEOUT_MS, 15_000);
});

test('un abandon voulu par l’appelant reste un abandon', async (t) => {
  hangingFetch(t);
  const controller = new AbortController();
  const pending = request('/api/media/status', {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(!(error instanceof RequestTimeoutError));
    assert.equal((error as Error).name, 'AbortError');
    assert.equal(errorMessage(error), 'Demande interrompue avant la réponse du serveur.');
    return true;
  });
});

test('une réponse illisible et un serveur injoignable donnent des messages compréhensibles', async (t) => {
  respondWith(
    t,
    () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  );
  await assert.rejects(request('/api/state'), (error: unknown) => {
    assert.ok(error instanceof SyntaxError);
    assert.match(errorMessage(error), /^Réponse illisible du serveur/u);
    return true;
  });
  assert.equal(errorMessage(new DOMException('délai', 'TimeoutError')), WRITE_TIMEOUT_MESSAGE);
  assert.equal(
    errorMessage(new TypeError('Failed to fetch')),
    'Le serveur est injoignable. Vérifiez la connexion locale.',
  );
  assert.equal(errorMessage(new Error('Profil introuvable.')), 'Profil introuvable.');
});

test('le message d’erreur du serveur reste celui affiché', async (t) => {
  respondWith(t, () => Response.json({ error: 'Révision périmée.' }, { status: 409 }));
  await assert.rejects(request('/api/admin/opening', { method: 'PATCH', body: '{}' }), {
    message: 'Révision périmée.',
  });
});
