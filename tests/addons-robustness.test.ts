import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import clockModule from '../addons/clock/index.js';
import type { AddonDefinition } from '../shared/addons.js';
import { ActionExecutor } from '../server/actions.js';
import { registerAddons } from '../server/addons-api.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { AddonRuntime } from '../server/addons/runtime.js';
import { DiagnosticLog } from '../server/logs.js';
import {
  ActionRepository,
  AddonRepository,
  openDatabase,
  ProfileRepository,
} from '../server/storage.js';

const clock = clockModule as unknown as AddonDefinition;
const config = { timeZone: 'Europe/Paris', showDate: true, showSeconds: false };
const http = { fetch: () => Promise.reject(new Error('aucun réseau dans ce test')) };

function setup(t: TestContext, addon: AddonDefinition) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const logs = new DiagnosticLog();
  const runtime = new AddonRuntime({ addons: [addon], instances, http, logs });
  instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'salon',
    label: 'Salon',
    config,
    configVersion: 1,
  });
  return {
    runtime,
    instances,
    logs: () => logs.snapshot().entries,
    read: () => runtime.read(addon.id, null, 'salon', new AbortController().signal),
  };
}

test('une exception imprévue du module donne un message simple, le texte brut va au journal', async (t) => {
  const raw = 'TypeError: Cannot read properties of undefined (reading "temp") ' + 'x'.repeat(400);
  const f = setup(t, {
    ...clock,
    async collect() {
      throw new TypeError(raw);
    },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(
    result.summary,
    'Source indisponible : Le module a rencontré une erreur inattendue.',
  );
  assert.deepEqual(result.error, {
    code: 'upstream',
    message: 'Le module a rencontré une erreur inattendue.',
    retryable: false,
  });
  assert.doesNotMatch(JSON.stringify(f.runtime.toolResult(result)), /Cannot read/u);
  const logged = f.logs().find((entry) => entry.event === 'Erreur inattendue du module');
  assert.ok(logged, 'le message brut est journalisé');
  assert.equal(logged.details.message, raw.slice(0, 300));
  assert.equal(logged.details.addonId, 'clock');
});

test('une carte hors contrat est un échec « illisible », pas un succès refusé à l’affichage', async (t) => {
  const f = setup(t, {
    ...clock,
    present(snapshot, context) {
      return { ...clock.present(snapshot, context), title: 'Heure '.repeat(30) };
    },
  });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'malformed');
  assert.equal(result.summary, 'Données reçues mais illisibles.');
  assert.equal(f.runtime.toolResult(result).status, 'failed');
  const logged = f.logs().find((entry) => entry.event === 'Carte de module non conforme');
  assert.ok(logged);
  assert.deepEqual(logged.details.errors, ['/title must NOT have more than 80 characters']);
});

test('la raison d’un module refusé nomme le schéma et le premier message de validation', () => {
  assert.equal(
    validateAddonDefinition({
      ...clock,
      configSchema: { type: 'object', properties: { timeZone: { type: 'texte' } } },
    }),
    'schéma de configuration invalide : data/properties/timeZone/type must be equal to one of the allowed values.',
  );
  assert.equal(
    validateAddonDefinition({ ...clock, dataSchema: { type: 'object', titel: 'x' } }),
    'schéma de données invalide : strict mode: unknown keyword: "titel".',
  );
  const [tool] = clock.tools;
  assert.match(
    validateAddonDefinition({
      ...clock,
      tools: [{ ...tool!, parameters: { type: 'object', minProperties: -1 } }],
    }) ?? '',
    /^paramètres de l’outil « .+ » invalide : data\/minProperties must be >= 0\.$/u,
  );
});

test('le catalogue expose les modules refusés et leur raison', async (t) => {
  const db = openDatabase(':memory:');
  const instances = new AddonRepository(db);
  const actionRepository = new ActionRepository(db);
  const app = Fastify();
  const rejected = [{ name: 'parking', reason: 'schéma de données invalide : must be object.' }];
  registerAddons(app, {
    runtime: new AddonRuntime({ addons: [clock], instances, http }),
    actions: new ActionExecutor(actionRepository, http),
    instances,
    actionRepository,
    profiles: new ProfileRepository(db),
    logs: new DiagnosticLog(),
    rejectedAddons: rejected,
    requireAdmin: async () => {},
  });
  t.after(async () => {
    await app.close();
    db.close();
  });
  const catalog = await app.inject({ method: 'GET', url: '/api/admin/addons' });
  assert.equal(catalog.statusCode, 200);
  assert.deepEqual(catalog.json<{ rejected: unknown }>().rejected, rejected);
});
