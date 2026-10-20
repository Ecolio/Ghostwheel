import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import type { AddonHttpClient, AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon from './index.js';
import payload from './fixtures/availability.json' with { type: 'json' };

function setup(t: { after(fn: () => void): void }) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'demo',
    label: 'Parking de démonstration',
    config: { ...addon.configDefaults },
    configVersion: addon.configVersion,
  });
  let now = Date.parse('2026-09-22T10:00:00Z');
  let status = 200;
  let body = JSON.stringify(payload);
  const calls: AddonHttpRequest[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      return { status, headers: {}, text: () => body, json: () => JSON.parse(body) as unknown };
    },
  };
  const runtime = new AddonRuntime({ addons: [addon], instances, http, now: () => now });
  const signal = new AbortController().signal;
  return {
    runtime,
    instances,
    instance,
    calls,
    read: () => runtime.read(addon.id, null, 'demo', signal),
    advance: (ms: number) => {
      now += ms;
    },
    respond: (nextStatus: number, nextBody: string) => {
      status = nextStatus;
      body = nextBody;
    },
  };
}

test('définition v1, configuration, snapshot, carte et résultat outil conformes', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { parkingId: '../autre' }).ok, false);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.card.primaryValue, '12 places');
  assert.equal(result.snapshot.validUntil, '2026-09-22T10:01:00.000Z');
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.ambientPresentation(f.runtime.ambientDisplay(f.instance).content), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  assert.equal(f.calls[0]?.url, 'https://parking.example.invalid/parkings/demo');
  assert.ok(f.calls[0]?.signal);
});

test('les lectures simultanées et le cache frais ne doublent pas la collecte', async (t) => {
  const f = setup(t);
  const [first, second] = await Promise.all([f.read(), f.read()]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  await f.read();
  assert.equal(f.calls.length, 1);
});

test('zéro place reste un succès utile', async (t) => {
  const f = setup(t);
  f.respond(200, JSON.stringify({ ...payload, available: 0 }));
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.status, 'ready');
  assert.equal(result.card.primaryValue, '0 places');
});

test('une panne après expiration conserve les dates et annonce le dernier succès', async (t) => {
  const f = setup(t);
  const first = await f.read();
  assert.equal(first.ok, true);
  if (!first.ok) return;
  f.advance(60_001);
  f.respond(503, '{}');
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stale, true);
  assert.equal(result.snapshot.revision, first.snapshot.revision);
  assert.equal(result.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.equal(result.snapshot.validUntil, first.snapshot.validUntil);
  assert.match(result.presentation.summary, /Dernière disponibilité connue/);
  assert.equal(f.runtime.toolResult(result).status, 'stale');
});

test('une première panne ne crée ni données ni date de succès', async (t) => {
  const f = setup(t);
  f.respond(503, '{}');
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'unavailable');
  const snapshot = f.instances.getSnapshot(f.instance);
  assert.equal(snapshot?.status, 'error');
  assert.equal(snapshot?.data, null);
  assert.equal(snapshot?.fetchedAt, null);
  assert.equal(snapshot?.validUntil, null);
});

test('une valeur fournisseur invalide est signalée, jamais convertie en zéro', async (t) => {
  const f = setup(t);
  f.respond(200, JSON.stringify({ ...payload, available: 'inconnu' }));
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'malformed');
});

test('une référence inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const result = await f.runtime.read(addon.id, null, 'autre', new AbortController().signal);
  assert.equal(result.ok, false);
  assert.equal(f.calls.length, 0);
});
