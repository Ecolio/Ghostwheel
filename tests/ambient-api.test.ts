import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';

test('l’affichage permanent se configure par source, avec validation et droits administrateur', async (t) => {
  const origin = 'http://localhost';
  const { app } = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'test-ambient-only',
      origins: [origin],
      secureCookies: false,
    },
    { timers: false },
  );
  t.after(() => app.close());
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password: 'test-ambient-only' },
  });
  const auth = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
  const headers = { origin, cookie: `${auth.name}=${auth.value}` };
  const input = {
    addonId: 'weather',
    profileId: null,
    ref: 'foyer',
    label: 'Météo du foyer',
    config: { insee: '75056', lat: null, lon: null, days: 3 },
  };
  const denied = await app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers: { origin },
    payload: { ...input, displayEnabled: true },
  });
  assert.equal(denied.statusCode, 401);
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/addons/instances',
    headers,
    payload: input,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().displayEnabled, false);
  const id = created.json().id as string;
  const catalog = (await app.inject({ url: '/api/admin/addons', headers })).json();
  assert.equal(
    catalog.definitions.find((definition: { id: string }) => definition.id === 'weather').ambient,
    true,
  );
  const invalid = await app.inject({
    method: 'PATCH',
    url: '/api/admin/addons/instances/' + id,
    headers,
    payload: { displayEnabled: 'yes' },
  });
  assert.equal(invalid.statusCode, 400);
  for (const displayEnabled of [true, false]) {
    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/admin/addons/instances/' + id,
      headers,
      payload: { displayEnabled },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    assert.equal(patched.json().displayEnabled, displayEnabled);
  }
  const state = (await app.inject('/api/state')).json();
  assert.deepEqual(state.state.ambientDisplays, []);
  assert.deepEqual(state.state.cards, []);
});
