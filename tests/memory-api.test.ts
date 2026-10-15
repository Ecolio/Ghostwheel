import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';

test('API mémoire réservée à l’admin : isolation, correction, version, oubli et désactivation', async (t) => {
  const origin = 'http://localhost';
  const { app, profiles, memory } = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'memory-test-only',
      origins: [origin],
      secureCookies: false,
    },
    { timers: false },
  );
  t.after(() => app.close());
  const alice = profiles.create('Alice');
  const bob = profiles.create('Bob');
  const batch = memory.repository.begin('session', alice.id, 0)!;
  memory.repository.apply(
    batch,
    {
      schemaVersion: 1,
      changes: [
        {
          operation: 'add',
          memoryId: null,
          topic: 'goûts',
          fact: 'Aime le thé vert.',
          evidenceTurnIds: ['user-1'],
          scope: 'durable',
          expiresAt: null,
        },
      ],
    },
    [
      {
        id: 'user-1',
        profileId: alice.id,
        version: 0,
        text: 'J’aime le thé vert.',
        startMs: 100,
        endMs: 500,
      },
    ],
  );
  const id = memory.repository.list(alice.id)[0]!.id;
  const base = '/api/admin/memory/' + alice.id;
  for (const method of ['GET', 'PATCH', 'PUT', 'DELETE'] as const) {
    const denied = await app.inject({
      method,
      url: base + (method === 'PUT' ? '/' + id : ''),
      headers: { origin },
    });
    assert.equal(denied.statusCode, 401, denied.body);
  }
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password: 'memory-test-only' },
  });
  const auth = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const headers = { origin, cookie: `${auth.name}=${auth.value}` };
  const read = await app.inject({ url: base, headers });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().memories[0].fact, 'Aime le thé vert.');
  assert.deepEqual(
    (await app.inject({ url: '/api/admin/memory/' + bob.id, headers })).json().memories,
    [],
  );
  assert.equal((await app.inject({ url: '/api/admin/memory/household', headers })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/state' })).body.includes('thé vert'), false);
  const edit = {
    version: 1,
    topic: 'goûts',
    fact: 'Préfère le café.',
    scope: 'durable',
    expiresAt: null,
  };
  const invalid = await app.inject({
    method: 'PUT',
    url: base + '/' + id,
    headers,
    payload: { ...edit, profileId: bob.id },
  });
  assert.equal(invalid.statusCode, 400);
  const expired = await app.inject({
    method: 'PUT',
    url: base + '/' + id,
    headers,
    payload: { ...edit, scope: 'temporary', expiresAt: '2000-01-01T00:00:00.000Z' },
  });
  assert.equal(expired.statusCode, 400);
  const foreign = await app.inject({
    method: 'PUT',
    url: '/api/admin/memory/' + bob.id + '/' + id,
    headers,
    payload: { ...edit, version: 0 },
  });
  assert.equal(foreign.statusCode, 404);
  const corrected = await app.inject({
    method: 'PUT',
    url: base + '/' + id,
    headers,
    payload: edit,
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  assert.equal(corrected.json().memories[0].fact, 'Préfère le café.');
  assert.equal(corrected.json().version, 2);
  assert.equal(
    (await app.inject({ method: 'PUT', url: base + '/' + id, headers, payload: edit })).statusCode,
    409,
  );
  const disabled = await app.inject({
    method: 'PATCH',
    url: base,
    headers,
    payload: { enabled: false, version: 2 },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().enabled, false);
  assert.equal(disabled.json().memories.length, 1);
  const forgotten = await app.inject({
    method: 'DELETE',
    url: base + '/' + id,
    headers,
    payload: { version: 3 },
  });
  assert.equal(forgotten.statusCode, 200, forgotten.body);
  assert.deepEqual(forgotten.json().memories, []);
  assert.equal(
    (await app.inject({ method: 'DELETE', url: base, headers, payload: { version: 4 } }))
      .statusCode,
    200,
  );
  const csrf = await app.inject({
    method: 'PATCH',
    url: base,
    headers: { ...headers, origin: 'https://other.example' },
    payload: { enabled: true, version: 5 },
  });
  assert.equal(csrf.statusCode, 403);
  await app.inject({ method: 'DELETE', url: '/api/admin/profiles/' + alice.id, headers });
  assert.equal((await app.inject({ url: base, headers })).statusCode, 404);
});
