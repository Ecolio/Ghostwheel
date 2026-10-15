import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import clock from '../addons/clock/index.js';
import fixture from '../addons/clock/fixtures/paris.json' with { type: 'json' };
import { AddonRuntime } from '../server/addons/runtime.js';
import { validateAddonDefinition } from '../server/addons/registry.js';
import { AddonRepository, openDatabase } from '../server/storage.js';
import { validators } from '../shared/validation.js';

function setup(t: TestContext, config = fixture.config) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const instances = new AddonRepository(db);
  const instance = instances.createInstance({
    addonId: 'clock',
    profileId: null,
    ref: 'horloge',
    label: 'Heure du foyer',
    config,
    configVersion: 1,
  });
  let now = Date.parse(fixture.now);
  let collections = 0;
  const counted: typeof clock = {
    ...clock,
    async collect(context) {
      collections++;
      return clock.collect(context);
    },
  };
  const runtime = new AddonRuntime({
    addons: [counted],
    instances,
    now: () => now,
    http: {
      async fetch() {
        throw new Error('L’horloge ne doit pas appeler le réseau.');
      },
    },
  });
  return {
    runtime,
    instances,
    instance,
    read: () => runtime.read('clock', null, 'horloge', new AbortController().signal),
    collections: () => collections,
    setNow: (value: string) => {
      now = Date.parse(value);
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('le module heure respecte le contrat et produit une horloge sans réseau', async (t) => {
  const f = setup(t);
  assert.equal(validateAddonDefinition(clock), null);
  assert.equal(f.runtime.validateConfig('clock', fixture.config).ok, true);
  assert.equal(f.runtime.validateConfig('clock', { ...fixture.config, showDate: 'oui' }).ok, false);
  const result = await f.read();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.presentation.primaryValue, fixture.expected.time);
  assert.equal(validators.moduleSnapshot(result.snapshot), true);
  assert.equal(validators.moduleCard(result.card), true);
  assert.equal(validators.toolResult(f.runtime.toolResult(result)), true);
  const display = f.runtime.ambientDisplay(f.instance);
  assert.equal(validators.ambientPresentation(display.content), true);
  assert.equal(display.content?.value, fixture.expected.time);
  assert.equal(display.content?.subtitle, fixture.expected.date);
  assert.equal(display.content?.showCollectedAt, false);
});

test('l’heure avance dans les deux présentations sans nouvelle collecte ni écriture du cache', async (t) => {
  const f = setup(t, { ...fixture.config, showSeconds: true });
  const first = await f.read();
  assert.ok(first.ok);
  assert.equal(first.card.primaryValue, '12:34:56');
  f.advance(5000);
  const second = await f.read();
  assert.ok(second.ok);
  assert.equal(second.card.primaryValue, '12:35:01');
  assert.match(second.presentation.summary, /12:35:01/);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, '12:35:01');
  assert.equal(second.snapshot.revision, first.snapshot.revision);
  assert.equal(second.snapshot.fetchedAt, first.snapshot.fetchedAt);
  assert.equal(f.collections(), 1);
});

test('le changement de jour et le changement d’heure suivent le fuseau choisi', async (t) => {
  const f = setup(t, { ...fixture.config, showSeconds: true });
  f.setNow('2026-09-22T21:59:59Z');
  assert.equal((await f.read()).ok, true);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, '23:59:59');
  f.advance(1000);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, '00:00:00');
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.subtitle, 'mercredi 23 septembre');
  f.setNow('2026-10-25T00:59:59Z');
  assert.equal((await f.read()).ok, true);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, '02:59:59');
  f.advance(1000);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.value, '02:00:00');
});

test('le fuseau est propre à la source et la date peut être masquée sans perdre la réponse vocale', async (t) => {
  const f = setup(t, { timeZone: 'UTC', showDate: false, showSeconds: false });
  const result = await f.read();
  assert.ok(result.ok);
  assert.equal(result.card.primaryValue, '10:34');
  assert.equal(result.card.subtitle, 'UTC');
  assert.match(result.presentation.summary, /mardi 22 septembre/);
  assert.equal(f.runtime.ambientDisplay(f.instance).content?.subtitle, null);
});

test('un fuseau inconnu renvoie une erreur de configuration explicite', async (t) => {
  const f = setup(t, { ...fixture.config, timeZone: 'Mars/Introuvable' });
  const result = await f.read();
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'config_invalid');
    assert.match(result.error.message, /Europe\/Paris ou UTC/);
  }
});

test('la source heure est facultative, désactivable et supprimable sans recréation', async (t) => {
  const f = setup(t);
  assert.deepEqual(f.runtime.ambientInstances(null), []);
  f.instances.updateInstance(f.instance.id, { displayEnabled: true });
  assert.equal(f.runtime.ambientInstances(null).length, 1);
  await f.read();
  f.instances.updateInstance(f.instance.id, { displayEnabled: false });
  assert.deepEqual(f.runtime.ambientInstances(null), []);
  f.instances.deleteInstance(f.instance.id);
  assert.equal((await f.read()).ok, false);
  assert.deepEqual(f.runtime.ambientInstances(null), []);
  assert.deepEqual(f.instances.listInstances(), []);
});
