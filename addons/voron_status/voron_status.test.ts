import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AddonRepository,
  AddonRuntime,
  openDatabase,
  validateAddonDefinition,
} from '#cornelius/testing';
import { AddonCollectError, type AddonHttpClient, type AddonHttpRequest } from '#cornelius/addons';
import { validators } from '#cornelius/validation';
import addon from './index.js';
import printing from './fixtures/printing.json' with { type: 'json' };
import ready from './fixtures/ready.json' with { type: 'json' };

const tool = 'voron_status__read';
const baseUrl = 'http://192.168.1.106:7125';
// Mêmes formateurs que le module : l’espace avant « % » est une espace insécable étroite.
const frPercent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const pct96 = frPercent.format(0.96);

function setup(
  t: { after(fn: () => void): void },
  options: {
    config?: Record<string, unknown>;
    secrets?: Record<string, string | undefined>;
    now?: () => number;
  } = {},
) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: addon.id,
    profileId: null,
    ref: 'voron-2-4',
    label: 'Voron 2.4',
    config: { ...addon.configDefaults, baseUrl, ...options.config },
    configVersion: addon.configVersion,
  });
  let status = 200;
  let body: string | null = JSON.stringify(printing);
  let failure: AddonCollectError | null = null;
  const calls: AddonHttpRequest[] = [];
  const http: AddonHttpClient = {
    async fetch(request) {
      calls.push(request);
      if (failure) throw failure;
      const text = body ?? '';
      return { status, headers: {}, text: () => text, json: () => JSON.parse(text) as unknown };
    },
  };
  const runtime = new AddonRuntime({
    addons: [addon],
    instances,
    http,
    secrets: options.secrets,
    ...(options.now ? { now: options.now } : {}),
  });
  const signal = new AbortController().signal;
  return {
    runtime,
    instances,
    instance,
    calls,
    signal,
    read: () => runtime.read(addon.id, null, null, signal),
    invoke: () => runtime.invoke(tool, null, null, signal, { instanceRef: null }),
    respond: (nextStatus: number, nextBody: string | null) => {
      status = nextStatus;
      body = nextBody;
    },
    failWith: (error: AddonCollectError | null) => {
      failure = error;
    },
  };
}

test('définition v1 valide et réglages par défaut', (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(addon), null);
  assert.equal(f.runtime.validateConfig(addon.id, addon.configDefaults).ok, true);
  assert.equal(f.runtime.validateConfig(addon.id, { baseUrl }).ok, true);
  for (const bad of ['ftp://h', 'http://h/api', 'http://', 'pas une adresse', 'http://u:p@h']) {
    assert.equal(f.runtime.validateConfig(addon.id, { baseUrl: bad }).ok, false, bad);
  }
  assert.deepEqual(
    f.runtime.tools().map((descriptor) => descriptor.name),
    [tool],
  );
});

test('impression en cours : requête de statut en lecture seule et carte affichée', async (t) => {
  const f = setup(t);
  const invoked = await f.invoke();
  assert.ok(invoked);
  const { outcome, tool: result } = invoked;
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  // Une seule requête, en lecture, vers l’API Moonraker de la source.
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]?.url, `${baseUrl}/printer/objects/query`);
  assert.equal(f.calls[0]?.method, 'POST');
  assert.ok(f.calls[0]?.signal);
  assert.deepEqual(JSON.parse(f.calls[0]!.body!), {
    objects: {
      webhooks: null,
      print_stats: null,
      virtual_sdcard: null,
      toolhead: ['homed_axes'],
      extruder: ['temperature', 'target'],
      heater_bed: ['temperature', 'target'],
    },
  });
  assert.equal(f.calls[0]?.headers?.['Content-Type'], 'application/json');
  assert.equal(f.calls[0]?.headers?.['X-Api-Key'], undefined);
  // Carte et relevé conformes aux contrats du cœur.
  assert.equal(validators.moduleSnapshot(outcome.snapshot), true);
  assert.equal(validators.moduleCard(outcome.card), true);
  assert.equal(validators.toolResult(result), true);
  assert.equal(result.status, 'succeeded');
  assert.equal(outcome.card.title, 'Voron 2.4');
  assert.equal(outcome.card.primaryValue, pct96);
  // Nom de fichier raccourci à 60 caractères pour la carte.
  assert.equal(
    outcome.card.subtitle,
    'Ball - bottom part with thick rim shell 1.2mm_PLA_20m49s.gc…',
  );
  assert.deepEqual(outcome.card.items[0], { label: 'Buse', value: '230,9 °C (but 230,0 °C)' });
  assert.deepEqual(outcome.card.items[1], { label: 'Lit', value: '65,2 °C (but 65,0 °C)' });
  assert.deepEqual(outcome.card.items[2], { label: 'Temps écoulé', value: '1 h 02 min' });
  assert.deepEqual(outcome.card.items[3], { label: 'Filament', value: '13,95 m' });
  assert.equal(outcome.card.stale, false);
  assert.match(outcome.presentation.summary, /^Voron 2\.4 imprime « Ball/);
  assert.ok(outcome.presentation.summary.includes(`à ${pct96} depuis 1 h 02 min`));
  assert.match(outcome.presentation.summary, /Encore environ 3 min/);
  assert.match(outcome.presentation.summary, /buse 230,9 °C, lit 65,2 °C/);
  assert.equal(outcome.snapshot.source?.provider, 'moonraker');
  assert.equal(outcome.snapshot.source?.sourceId, '192.168.1.106:7125');
});

test('imprimante prête et au repos', async (t) => {
  const f = setup(t);
  f.respond(200, JSON.stringify(ready));
  const outcome = await f.read();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.primaryValue, 'Prête');
  assert.equal(outcome.card.subtitle, 'Axes xyz');
  assert.match(outcome.presentation.summary, /^Voron 2\.4 est prête\./);
  assert.match(outcome.presentation.summary, /buse 21,4 °C, lit 20,9 °C/);
  assert.equal(validators.moduleCard(outcome.card), true);
});

test('Klipper joignable mais pas prêt : état distinct d’une imprimante hors ligne', async (t) => {
  const f = setup(t);
  f.respond(
    200,
    JSON.stringify({
      result: {
        status: {
          webhooks: { state: 'startup', state_message: 'Starting up' },
          print_stats: { state: 'standby', filename: '', print_duration: 0, filament_used: 0 },
        },
        eventtime: 1,
      },
    }),
  );
  const outcome = await f.read();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.card.primaryValue, 'Démarrage');
  assert.equal(outcome.card.description, 'Starting up');
  assert.match(outcome.presentation.summary, /Klipper est en état « startup »/);
  // Le message brut de Klipper n’est jamais dit à l’oral.
  assert.doesNotMatch(outcome.presentation.summary, /Starting up/);
});

test('les statuts HTTP de Moonraker deviennent des erreurs compréhensibles', async (t) => {
  const cases: [number, string, boolean][] = [
    [401, 'auth', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [400, 'invalid_params', false],
    [405, 'invalid_params', false],
    [500, 'unavailable', true],
    [503, 'unavailable', true],
    [418, 'upstream', false],
  ];
  for (const [status, code, retryable] of cases) {
    const f = setup(t);
    f.respond(status, '{}');
    const outcome = await f.read();
    assert.equal(outcome.ok, false, `HTTP ${status}`);
    if (outcome.ok === false) {
      assert.equal(outcome.error?.code, code, `HTTP ${status}`);
      assert.equal(outcome.error?.retryable, retryable, `HTTP ${status}`);
      // Lecture ordinaire : le message compréhensible du module est dit, aucune carte.
      assert.match(outcome.summary, /^Source indisponible : /);
    }
  }
});

test('les réponses illisibles sont signalées malformed', async (t) => {
  const bodies = ['pas du json', '{}', '{"result":{}}', '{"result":{"status":{}}}', '[]'];
  for (const body of bodies) {
    const f = setup(t);
    f.respond(200, body);
    const outcome = await f.read();
    assert.equal(outcome.ok, false, body);
    if (outcome.ok === false) assert.equal(outcome.error?.code, 'malformed', body);
  }
});

test('imprimante hors ligne : aucune requête réussie, aucune carte', async (t) => {
  const f = setup(t);
  f.failWith(new AddonCollectError('unavailable', 'Source réseau injoignable.', true));
  const invoked = await f.invoke();
  assert.ok(invoked);
  assert.equal(invoked.outcome.ok, false);
  if (invoked.outcome.ok === false) {
    assert.equal(invoked.outcome.error?.code, 'unavailable');
    assert.equal(invoked.outcome.summary, 'Source indisponible : Source réseau injoignable.');
  }
  assert.equal(invoked.tool.status, 'failed');
  assert.equal(invoked.tool.result, null);
  // Hors ligne, aucune carte n’est produite : le cœur ne pousse que les cartes valides.
  assert.equal(validators.toolResult(invoked.tool), true);
});

test('après un succès, une panne garde le dernier relevé connu et le signale', async (t) => {
  let now = 1_000_000;
  const f = setup(t, { now: () => now });
  const first = await f.read();
  assert.equal(first.ok, true);
  // Le relevé de 15 s est expiré : la prochaine lecture repart en collecte.
  now += 60_000;
  f.respond(500, '{}');
  const second = await f.read();
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.stale, true);
  assert.equal(second.card.stale, true);
  assert.equal(second.card.description, 'Dernier relevé connu.');
  assert.equal(second.card.primaryValue, pct96);
  assert.match(second.presentation.summary, /Dernier relevé connu\./);
  assert.equal(validators.moduleCard(second.card), true);
});

test('tant que le relevé est frais, aucune nouvelle requête ne part', async (t) => {
  const f = setup(t);
  await f.read();
  await f.read();
  assert.equal(f.calls.length, 1);
});

test('la clé API Moonraker est envoyée quand elle est configurée', async (t) => {
  const withKey = setup(t, { secrets: { moonrakerApiKey: 'cle-test' } });
  await withKey.read();
  assert.equal(withKey.calls[0]?.headers?.['X-Api-Key'], 'cle-test');
  const withoutKey = setup(t);
  await withoutKey.read();
  assert.equal(withoutKey.calls[0]?.headers?.['X-Api-Key'], undefined);
});

test('une source inconnue ne déclenche aucune requête', async (t) => {
  const f = setup(t);
  const invoked = await f.runtime.invoke(tool, null, 'autre', f.signal, { instanceRef: 'autre' });
  assert.ok(invoked);
  assert.equal(invoked.outcome.ok, false);
  assert.equal(f.calls.length, 0);
});

test('les champs optionnels absents passent à null sans erreur', async (t) => {
  const f = setup(t);
  f.respond(
    200,
    JSON.stringify({
      result: {
        status: {
          webhooks: { state: 'ready' },
          print_stats: { state: 'standby', filename: '', print_duration: 0, filament_used: 0 },
        },
        eventtime: 2,
      },
    }),
  );
  const outcome = await f.read();
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(validators.moduleSnapshot(outcome.snapshot), true);
  assert.equal(outcome.card.primaryValue, 'Prête');
  assert.deepEqual(outcome.card.items, []);
  assert.match(outcome.presentation.summary, /^Voron 2\.4 est prête\.$/);
});
