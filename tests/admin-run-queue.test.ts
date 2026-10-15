import assert from 'node:assert/strict';
import test from 'node:test';
import { createRunQueue, type Charge } from '../web/components/admin/run-queue.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function queue(control: () => Charge = () => [null, '']) {
  const events: string[] = [];
  const run = createRunQueue(
    {
      start: () => events.push('start'),
      succeeded: (label) => events.push('ok ' + label),
      failed: (error) => events.push('erreur ' + String(error)),
      busy: (value) => events.push(value ? 'occupé' : 'libre'),
    },
    control,
  );
  return { run, events };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('deux réglages rapides d’ouverture sont enregistrés tous les deux', async () => {
  // Ancien comportement : le second partageait le libellé « Ouverture enregistrée. » du
  // premier, encore en cours, et était ignoré alors que le message confirmait.
  const { run } = queue();
  const saved: unknown[] = [];
  const server = deferred();
  const save = (opening: object) => async () => {
    saved.push(opening);
    if (saved.length === 1) await server.promise;
  };
  const first = run('Ouverture enregistrée.', save({ audience: 'members' }), {
    payload: { audience: 'members' },
  });
  const second = run('Ouverture enregistrée.', save({ trigger: 'voice', audience: 'members' }), {
    payload: { trigger: 'voice', audience: 'members' },
  });
  assert.deepEqual(saved, [{ audience: 'members' }], 'la première part tout de suite');
  server.resolve();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(saved, [{ audience: 'members' }, { trigger: 'voice', audience: 'members' }]);
});

test('un double clic sur la même action destructive ne la lance qu’une fois', async () => {
  const button = {};
  const { run } = queue(() => [button, '']);
  const server = deferred();
  let deletions = 0;
  const remove = async () => {
    deletions++;
    await server.promise;
  };
  const first = run('Profil supprimé.', remove);
  const second = run('Profil supprimé.', remove);
  assert.equal(await second, false);
  server.resolve();
  assert.equal(await first, true);
  await flush();
  assert.equal(deletions, 1);
});

test('le contrôle déclencheur distingue deux choix d’un même réglage', async () => {
  let control: Charge = [{ name: 'membres' }, 'members:true'];
  const { run } = queue(() => control);
  const server = deferred();
  const sent: string[] = [];
  const first = run('Ouverture enregistrée.', async () => {
    sent.push('membres');
    await server.promise;
  });
  control = [{ name: 'voix' }, 'voice:true'];
  const second = run('Ouverture enregistrée.', async () => {
    sent.push('voix');
  });
  server.resolve();
  assert.deepEqual([await first, await second], [true, true]);
  assert.deepEqual(sent, ['membres', 'voix']);
});

test('seule la dernière demande en attente d’un réglage part', async () => {
  const { run, events } = queue();
  const server = deferred();
  const sent: string[] = [];
  const send = (value: string) => async () => {
    sent.push(value);
    if (value === 'A') await server.promise;
  };
  const a = run('Délégation enregistrée.', send('A'), { payload: 'A' });
  const b = run('Délégation enregistrée.', send('B'), { payload: 'B' });
  const c = run('Délégation enregistrée.', send('C'), { payload: 'C' });
  // Même contenu que la demande en attente : rien de plus.
  assert.equal(await run('Délégation enregistrée.', send('C'), { payload: 'C' }), false);
  server.resolve();
  assert.deepEqual([await a, await b, await c], [true, true, true]);
  assert.deepEqual(sent, ['A', 'C']);
  assert.equal(events.at(-1), 'libre');
});

test('des réglages différents s’enchaînent dans l’ordre, même après un échec', async () => {
  const { run, events } = queue();
  const server = deferred();
  const order: string[] = [];
  const first = run('Accueil enregistré.', async () => {
    order.push('accueil');
    await server.promise;
  });
  const second = run(
    'Son enregistré.',
    async () => {
      order.push('son');
    },
    { key: 'son' },
  );
  assert.deepEqual(order, ['accueil']);
  server.reject('refus');
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(order, ['accueil', 'son']);
  assert.deepEqual(events, [
    'occupé',
    'start',
    'erreur refus',
    'start',
    'ok Son enregistré.',
    'libre',
  ]);
});

test('une clé explicite sépare deux réglages qui partagent un libellé', async () => {
  const { run } = queue();
  const server = deferred();
  const sent: string[] = [];
  const first = run(
    'Ouverture enregistrée.',
    async () => {
      sent.push('qui');
      await server.promise;
    },
    { key: 'audience' },
  );
  const second = run(
    'Ouverture enregistrée.',
    async () => {
      sent.push('quoi');
    },
    { key: 'trigger' },
  );
  server.resolve();
  assert.deepEqual([await first, await second], [true, true]);
  assert.deepEqual(sent, ['qui', 'quoi']);
});

test('une erreur reprise par l’appelant ne s’affiche pas en plus en bas à droite', async () => {
  const { run, events } = queue();
  const shown: string[] = [];
  const ok = await run(
    'Home Assistant connecté.',
    async () => {
      throw new Error('Home Assistant ne répond pas.');
    },
    { onError: (error) => shown.push(String(error)) },
  );
  assert.equal(ok, false);
  assert.deepEqual(shown, ['Error: Home Assistant ne répond pas.']);
  assert.deepEqual(events, ['occupé', 'start', 'libre']);
  // Sans onError, l’erreur passe toujours par le message commun.
  await run('Autre.', async () => {
    throw new Error('refus');
  });
  assert.ok(events.includes('erreur Error: refus'));
});
