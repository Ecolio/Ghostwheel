import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';

const origin = 'http://localhost';

async function fixture(t: TestContext, adminPassword: string, restart?: () => void) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-password-images-'));
  const services = await createApp(
    {
      databasePath: ':memory:',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword,
      origins: [origin],
      secureCookies: false,
    } satisfies AppConfig,
    { timers: false, imageGenerationRoot: imageRoot, restart },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmSync(imageRoot, { recursive: true, force: true });
  });
  const login = async (password: string) => {
    const response = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin },
      payload: { password },
    });
    const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_admin');
    return { status: response.statusCode, cookie: entry ? `${entry.name}=${entry.value}` : '' };
  };
  return { app: services.app, login };
}

test('le mot de passe se change dans l’administration et remplace celui de .env', async (t) => {
  const f = await fixture(t, 'cornelius');
  const first = await f.login('cornelius');
  const other = await f.login('cornelius');
  const headers = { origin, cookie: first.cookie };
  const devices = async (cookie: string) =>
    f.app.inject({ url: '/api/admin/devices', headers: { origin, cookie } });
  assert.equal((await devices(first.cookie)).json().defaultPassword, true);

  const change = (current: string, next: string) =>
    f.app.inject({
      method: 'POST',
      url: '/api/admin/password',
      headers,
      payload: { current, next },
    });
  assert.equal((await change('mauvais', 'nouveau-mot-de-passe')).statusCode, 403);
  assert.equal((await change('cornelius', 'court')).statusCode, 400);
  assert.equal((await change('cornelius', 'cornelius')).statusCode, 400);
  const changed = await change('cornelius', 'nouveau-mot-de-passe');
  assert.equal(changed.statusCode, 200, changed.body);

  // La session qui a changé le mot de passe reste ouverte, les autres sont fermées.
  assert.equal((await devices(first.cookie)).statusCode, 200);
  assert.equal((await devices(other.cookie)).statusCode, 401);
  assert.equal((await devices(first.cookie)).json().defaultPassword, false);
  assert.equal((await f.login('cornelius')).status, 401);
  assert.equal((await f.login('nouveau-mot-de-passe')).status, 200);
  const logs = await f.app.inject({ url: '/api/admin/logs', headers });
  assert.ok(!logs.body.includes('nouveau-mot-de-passe'));
});

test('redémarrage : réservé à l’administration, indisponible sans lanceur', async (t) => {
  let restarted = 0;
  const f = await fixture(t, 'mot-de-passe-test', () => restarted++);
  assert.equal(
    (await f.app.inject({ method: 'POST', url: '/api/admin/restart', headers: { origin } }))
      .statusCode,
    401,
  );
  const { cookie } = await f.login('mot-de-passe-test');
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/admin/restart',
    headers: { origin, cookie },
  });
  assert.equal(response.statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(restarted, 1);

  const without = await fixture(t, 'mot-de-passe-test');
  const login = await without.login('mot-de-passe-test');
  const refused = await without.app.inject({
    method: 'POST',
    url: '/api/admin/restart',
    headers: { origin, cookie: login.cookie },
  });
  assert.equal(refused.statusCode, 503);
});
