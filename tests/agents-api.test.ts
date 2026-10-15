import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { fakeHermes } from './helpers/hermes.js';

test('API Agents : authentification, origine, profils, secrets, configuration et accords exacts', async (t) => {
  const fake = await fakeHermes();
  const services = await createApp(
    {
      databasePath: ':memory:',
      adminPassword: 'test-admin-password',
      origins: ['http://localhost'],
      secureCookies: false,
    },
    { timers: false },
  );
  const { app, profiles, agents } = services;
  t.after(async () => {
    await app.close();
    await fake.close();
  });
  const alice = profiles.create('Alice Hermes'),
    bob = profiles.create('Bob Hermes');
  const root = '/api/admin/agents/' + alice.id;
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin: 'http://localhost' },
    payload: { password: 'test-admin-password' },
  });
  const cookie = login.cookies.find((c) => c.name === 'cornelius_admin')!;
  const headers = { cookie: cookie.name + '=' + cookie.value, origin: 'http://localhost' };
  for (const [method, suffix] of [
    ['GET', ''],
    ['PUT', ''],
    ['DELETE', ''],
    ['POST', '/discover'],
    ['POST', '/refresh'],
    ['POST', '/message'],
    ['POST', '/tasks/id/stop'],
    ['POST', '/tasks/id/approval'],
  ] as const) {
    const result = await app.inject({
      method,
      url: root + suffix,
      headers: { origin: 'http://localhost' },
      ...(method === 'GET' ? {} : { payload: {} }),
    });
    assert.equal(result.statusCode, 401, method + suffix);
  }
  const config = {
    url: fake.url,
    token: fake.token,
    enabled: true,
    description: 'Agenda et recherches',
    revision: 0,
  };
  const forbidden = await app.inject({
    method: 'PUT',
    url: root,
    headers: { ...headers, origin: 'http://evil.invalid' },
    payload: config,
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(fake.calls.length, 0);
  const saved = await app.inject({ method: 'PUT', url: root, headers, payload: config });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().connection.hasToken, true);
  assert.ok(!saved.body.includes(fake.token));
  assert.match(JSON.stringify(saved.json().connection.discovery), /calendar_create/);
  assert.equal((await app.inject({ url: '/api/admin/agents/missing', headers })).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'PUT', url: root, headers, payload: config })).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: root + '/message',
        headers,
        payload: { message: 'x', taskId: null, profileId: bob.id },
      })
    ).statusCode,
    400,
  );
  fake.options.initialStatus = 'completed';
  const sent = await app.inject({
    method: 'POST',
    url: root + '/message',
    headers,
    payload: { message: 'Mes informations privées', taskId: null },
  });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().status, 'succeeded');
  const taskId = sent.json().result.taskId;
  assert.equal(
    (await app.inject({ url: '/api/admin/agents/' + bob.id, headers })).json().tasks.length,
    0,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: root + '/tasks/' + taskId + '/approval',
        headers,
        payload: { requestId: 'a', choice: 'always' },
      })
    ).statusCode,
    400,
  );
  const run = agents.repository.find(taskId)!;
  fake.runs.get(run.runId!)!.status = 'waiting_for_approval';
  fake.runs.get(run.runId!)!.approval = {
    request_id: 'approval-exact',
    command: 'Créer un rendez-vous',
  };
  const refresh = await app.inject({
    method: 'POST',
    url: root + '/refresh',
    headers,
    payload: {},
  });
  assert.equal(refresh.json().tasks[0].approval.id, 'approval-exact');
  const approved = await app.inject({
    method: 'POST',
    url: root + '/tasks/' + taskId + '/approval',
    headers,
    payload: { requestId: 'approval-exact', choice: 'once' },
  });
  assert.equal(approved.statusCode, 200, approved.body);
  const logs = JSON.stringify(services.logs.snapshot());
  assert.doesNotMatch(logs, /hermes-fixture-secret|Mes informations privées/);
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/admin/profiles/' + alice.id,
    headers,
  });
  assert.equal(removed.statusCode, 200);
  assert.equal(agents.repository.find(taskId), null);
  assert.equal((await app.inject({ url: root, headers })).statusCode, 404);
  assert.equal(fake.runs.size, 1);
});
