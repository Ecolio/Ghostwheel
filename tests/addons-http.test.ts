import assert from 'node:assert/strict';
import test from 'node:test';
import { AddonCollectError } from '../shared/addons.js';
import { createHttpClient, networkFailure } from '../server/addons/http.js';

test('un signal HTTP déjà annulé empêche tout envoi au fournisseur', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  await assert.rejects(
    createHttpClient().fetch({
      url: 'https://maison.example/action',
      method: 'POST',
      signal: AbortSignal.abort(),
    }),
    (error: unknown) => error instanceof AddonCollectError && error.code === 'unavailable',
  );
  assert.equal(fetch.mock.callCount(), 0);
});

/** Port local où personne n’écoute : la connexion est refusée, rien n’est envoyé. */
async function closedPort(): Promise<number> {
  const { createServer } = await import('node:net');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('requête invalide, destination injoignable et connexion coupée se distinguent', async (t) => {
  const client = createHttpClient();
  const port = await closedPort();
  const failure = async (request: Parameters<typeof client.fetch>[0]) => {
    try {
      await client.fetch(request);
    } catch (error) {
      assert.ok(error instanceof AddonCollectError);
      return { code: error.code, message: error.message };
    }
    assert.fail('La requête aurait dû échouer.');
  };
  assert.deepEqual(
    await failure({ url: `http://127.0.0.1:${port}/`, headers: { 'Mon en-tête': 'x' } }),
    { code: 'invalid_params', message: 'Requête invalide : nom d’en-tête « Mon en-tête » refusé.' },
  );
  assert.equal((await failure({ url: `http://127.0.0.1:${port}/` })).code, 'unavailable');
  // Le serveur reçoit la requête puis coupe : l’envoi a peut-être eu lieu.
  const { createServer } = await import('node:http');
  const server = createServer((request) => request.socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port: open } = server.address() as { port: number };
  assert.deepEqual(await failure({ url: `http://127.0.0.1:${open}/` }), {
    code: 'upstream',
    message: 'Connexion interrompue avant la réponse.',
  });
});

test('networkFailure classe les erreurs de fetch sans réseau', () => {
  assert.equal(
    networkFailure(new TypeError('Request with GET/HEAD method cannot have body.')).message,
    'Requête invalide : une requête GET ne peut pas avoir de corps.',
  );
  const refused = new TypeError('fetch failed', {
    cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }),
  });
  assert.equal(networkFailure(refused).code, 'unavailable');
  const reset = new TypeError('fetch failed', {
    cause: Object.assign(new Error('x'), { code: 'UND_ERR_SOCKET' }),
  });
  assert.equal(networkFailure(reset).code, 'upstream');
  assert.equal(networkFailure(new Error('inattendue')).code, 'upstream');
  const redirect = networkFailure(
    new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
  );
  assert.equal(redirect.code, 'upstream');
  assert.equal(redirect.retryable, false);
  assert.match(redirect.message, /utiliser son adresse finale/u);
});
