import assert from 'node:assert/strict';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createApp } from '../server/app.js';
import type { AppConfig } from '../server/config.js';

const origin = 'http://localhost';
const password = 'mot-de-passe-test-1234';
const minute = 60 * 1000;

async function fixture(t: TestContext, overrides: Partial<AppConfig> = {}) {
  const imageRoot = mkdtempSync(join(tmpdir(), 'cornelius-session-images-'));
  let now = Date.parse('2026-09-16T12:00:00Z');
  const services = await createApp(
    {
      databasePath: ':memory:',
      openaiKey: 'test-key',
      perceptionToken: 'p'.repeat(40),
      imageGenerationToken: 'i'.repeat(40),
      adminPassword: password,
      origins: [origin],
      secureCookies: false,
      ...overrides,
    } satisfies AppConfig,
    { timers: false, imageGenerationRoot: imageRoot, now: () => now },
  );
  await services.app.ready();
  t.after(async () => {
    await services.app.close();
    rmdirSync(imageRoot);
  });
  return {
    ...services,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function login(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { origin },
    payload: { password },
  });
  assert.equal(response.statusCode, 200, response.body);
  const entry = response.cookies.find((cookie) => cookie.name === 'cornelius_admin');
  assert.ok(entry);
  assert.equal(entry.maxAge, 3600);
  return `${entry.name}=${entry.value}`;
}

test('la session administrateur se prolonge à chaque requête et expire après une heure d’inactivité', async (t) => {
  const f = await fixture(t);
  const cookie = await login(f);
  const profiles = () => f.app.inject({ url: '/api/admin/profiles', headers: { cookie } });

  // Trois quarts d’heure d’activité régulière : bien au-delà de l’heure fixe d’avant.
  for (let step = 0; step < 3; step++) {
    f.advance(45 * minute);
    const response = await profiles();
    assert.equal(response.statusCode, 200, `requête ${step + 1}`);
    // Le cookie du navigateur est prolongé avec la session.
    const renewed = response.cookies.find((entry) => entry.name === 'cornelius_admin');
    assert.ok(renewed);
    assert.equal(`${renewed.name}=${renewed.value}`, cookie);
    assert.equal(renewed.maxAge, 3600);
  }

  // La vérification d’identité de la page compte aussi comme une activité.
  f.advance(59 * minute);
  assert.deepEqual(
    (await f.app.inject({ url: '/api/auth?role=admin', headers: { cookie } })).json(),
    { role: 'admin' },
  );

  // Une heure sans requête : la session est fermée, et la requête refusée ne la prolonge pas.
  f.advance(60 * minute);
  const expired = await profiles();
  assert.equal(expired.statusCode, 401);
  assert.equal(
    expired.cookies.some((entry) => entry.name === 'cornelius_admin'),
    false,
  );
  assert.deepEqual(
    (await f.app.inject({ url: '/api/auth?role=admin', headers: { cookie } })).json(),
    { role: null },
  );
});

test('une requête sur une adresse introuvable note le chemin dans le journal, sans paramètres', async (t) => {
  const f = await fixture(t);
  const response = await f.app.inject({ url: '/page-inexistante?jeton=secret' });
  assert.equal(response.statusCode, 404);
  const entry = f.logs
    .snapshot()
    .entries.find((item) => item.source === 'http' && item.details.status === 404);
  assert.ok(entry, 'entrée http de la 404');
  assert.equal(entry.level, 'warn');
  assert.equal(entry.details.url, '/page-inexistante');
  assert.equal(JSON.stringify(entry).includes('secret'), false);

  // Les autres erreurs n’ajoutent pas d’adresse.
  await f.app.inject({ url: '/api/admin/profiles' });
  const refused = f.logs
    .snapshot()
    .entries.find((item) => item.source === 'http' && item.details.status === 401);
  assert.ok(refused);
  assert.equal('url' in refused.details, false);
});

test('au-delà de 64 sessions, une connexion ferme la moins récemment utilisée au lieu d’être refusée', async (t) => {
  // 65 connexions de suite : la limite de fréquence des connexions n’est pas le sujet ici.
  const f = await fixture(t, { loginRateLimit: 100 });
  const profiles = (cookie: string) =>
    f.app.inject({ url: '/api/admin/profiles', headers: { cookie } });
  const first = await login(f);
  const second = await login(f);
  for (let index = 2; index < 64; index++) await login(f);
  // La première session sert encore : c’est la deuxième, inactive, qui devient la plus ancienne.
  f.advance(minute);
  assert.equal((await profiles(first)).statusCode, 200);

  // 65ᵉ connexion avec le bon mot de passe : acceptée.
  const latest = await login(f);
  assert.equal((await profiles(latest)).statusCode, 200);
  assert.equal((await profiles(second)).statusCode, 401);
  assert.equal((await profiles(first)).statusCode, 200);
  assert.ok(
    f.logs
      .snapshot()
      .entries.some((entry) => entry.event === 'Session administrateur la plus ancienne fermée'),
  );
});
