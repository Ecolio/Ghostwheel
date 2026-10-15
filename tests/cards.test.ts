import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { DEFAULT_CARD_SETTINGS, isCardSettings } from '../shared/cards.js';

test('réglage des cartes : bornes et clés vérifiées', () => {
  assert.ok(isCardSettings(DEFAULT_CARD_SETTINGS));
  assert.ok(isCardSettings({ maxCards: 1, compactSecondary: false, lifetimeMs: 15_000 }));
  for (const value of [
    null,
    { maxCards: 0, compactSecondary: true, lifetimeMs: 60_000 },
    { maxCards: 5, compactSecondary: true, lifetimeMs: 60_000 },
    { maxCards: 2.5, compactSecondary: true, lifetimeMs: 60_000 },
    { maxCards: 2, compactSecondary: 'oui', lifetimeMs: 60_000 },
    { maxCards: 2, compactSecondary: true, lifetimeMs: 1_000 },
    { maxCards: 2, compactSecondary: true, lifetimeMs: 3_600_000 },
    { maxCards: 2, compactSecondary: true, lifetimeMs: 60_000, extra: 1 },
    { maxCards: 2, compactSecondary: true },
  ])
    assert.ok(!isCardSettings(value), JSON.stringify(value));
});

test('le module Cartes règle nombre, durée et taille, et reste après un redémarrage', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-cards-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    databasePath: join(directory, 'cornelius.sqlite'),
    perceptionToken: 'p'.repeat(40),
    imageGenerationToken: 'i'.repeat(40),
    adminPassword: 'mot-de-passe-cartes',
    origins: ['http://localhost'],
    secureCookies: false,
  };
  const open = async () => {
    const services = await createApp(config, { timers: false, imageGenerationRoot: directory });
    await services.app.ready();
    const login = await services.app.inject({
      method: 'POST',
      url: '/api/login',
      headers: { origin: 'http://localhost' },
      payload: { password: 'mot-de-passe-cartes' },
    });
    const entry = login.cookies.find((cookie) => cookie.name === 'cornelius_admin')!;
    return {
      ...services,
      headers: { origin: 'http://localhost', cookie: `${entry.name}=${entry.value}` },
    };
  };
  const first = await open();
  assert.deepEqual(first.controller.snapshot().state.cardSettings, DEFAULT_CARD_SETTINGS);
  const refused = await first.app.inject({
    method: 'PATCH',
    url: '/api/admin/cards',
    headers: first.headers,
    payload: { maxCards: 9, compactSecondary: true, lifetimeMs: 60_000 },
  });
  assert.equal(refused.statusCode, 400);
  const anonymous = await first.app.inject({
    method: 'PATCH',
    url: '/api/admin/cards',
    headers: { origin: 'http://localhost' },
    payload: DEFAULT_CARD_SETTINGS,
  });
  assert.equal(anonymous.statusCode, 401);
  const next = { maxCards: 2, compactSecondary: false, lifetimeMs: 120_000 };
  const saved = await first.app.inject({
    method: 'PATCH',
    url: '/api/admin/cards',
    headers: first.headers,
    payload: next,
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().state.cardSettings, next);
  await first.app.close();
  const second = await open();
  assert.deepEqual(second.controller.snapshot().state.cardSettings, next);
  await second.app.close();
});
