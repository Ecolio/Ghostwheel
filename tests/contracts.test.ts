import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compile, validators } from '../shared/validation.js';

function json<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as T;
}

const examples = [
  ['lunaCard', 'luna-card'],
  ['moduleCard', 'module-card'],
  ['moduleCard', 'module-card-stale'],
  ['presenceState', 'presence-state'],
  ['moduleSnapshot', 'module-snapshot'],
  ['moduleSnapshot', 'module-snapshot-first-error'],
  ['memoryChanges', 'memory-changes'],
  ['visionObservation', 'vision-observation'],
] as const;

test('les exemples publics respectent les contrats validés par le serveur', () => {
  for (const [name, file] of examples) {
    const validate = validators[name];
    assert.equal(
      validate(json(`schemas/examples/${file}.json`)),
      true,
      `${file}: ${JSON.stringify(validate.errors)}`,
    );
  }
});

test('les entrées refusent les champs de contrôle non prévus', () => {
  for (const [name, file] of examples) {
    const input = { ...json(`schemas/examples/${file}.json`), profileId: 'another-profile' };
    assert.equal(validators[name](input), false, file);
  }

  const card = json('schemas/examples/luna-card.json');
  card.items = [{ label: 'Bus', value: '5 min', html: '<script>run()</script>' }];
  assert.equal(validators.lunaCard(card), false);

  const proposal = json<{ changes: Record<string, unknown>[] }>(
    'schemas/examples/memory-changes.json',
  );
  proposal.changes[0]!.profileId = 'another-profile';
  assert.equal(validators.memoryChanges(proposal), false);
});

test('une première collecte en erreur ne prétend pas avoir un dernier succès', () => {
  const firstError = json('schemas/examples/module-snapshot-first-error.json');
  assert.equal(validators.moduleSnapshot(firstError), true);

  const invalidFields = {
    revision: 1,
    fetchedAt: '2026-09-15T06:10:00Z',
    observedAt: '2026-09-15T06:10:00Z',
    validUntil: '2026-09-15T06:12:00Z',
    source: { provider: 'demo', sourceId: 'demo-transit' },
    status: 'empty',
  };
  for (const [field, value] of Object.entries(invalidFields)) {
    assert.equal(validators.moduleSnapshot({ ...firstError, [field]: value }), false, field);
  }
});

test('un succès exige ses références et une date valide, sans confondre erreur et vide', () => {
  const snapshot = json('schemas/examples/module-snapshot.json');
  for (const [field, value] of Object.entries({
    revision: 0,
    fetchedAt: null,
    validUntil: null,
    source: null,
    status: 'error',
    observedAt: 'hier',
  })) {
    assert.equal(validators.moduleSnapshot({ ...snapshot, [field]: value }), false, field);
  }
  assert.equal(
    validators.moduleSnapshot({ ...snapshot, status: 'empty', data: { departures: [] } }),
    true,
  );
});

test('la portée foyer ne porte aucun propriétaire et une portée personnelle en exige un', () => {
  const snapshot = json('schemas/examples/module-snapshot.json');
  for (const scope of [
    { kind: 'household', userId: 'person-demo-1' },
    { kind: 'user', userId: null },
    { kind: 'user', userId: '' },
  ]) {
    assert.equal(validators.moduleSnapshot({ ...snapshot, scope }), false);
  }
  assert.equal(
    validators.moduleSnapshot({
      ...snapshot,
      scope: { kind: 'user', userId: 'person-demo-1' },
    }),
    true,
  );
});

test('un engagement exige un visage et une identification exige une correspondance', () => {
  const presence = json('schemas/examples/presence-state.json');
  for (const [field, value] of Object.entries({
    engagementId: null,
    primaryFace: null,
    faceCount: 0,
    match: null,
    observedAt: 'hier',
  })) {
    assert.equal(validators.presenceState({ ...presence, [field]: value }), false, field);
  }
});

test('les schémas d’addons valident leur configuration et les données normalisées', () => {
  const weatherConfig = compile(json('addons/weather/config.schema.json'));
  const weatherData = compile(json('addons/weather/data.schema.json'));
  const transitConfig = compile(json('addons/transit/config.schema.json'));
  const transitData = compile(json('addons/transit/data.schema.json'));

  const weather = { insee: '75056', lat: null, lon: null, days: 3 };
  assert.equal(weatherConfig(weather), true, JSON.stringify(weatherConfig.errors));
  assert.equal(weatherConfig({ ...weather, token: 'secret' }), false);
  assert.equal(
    transitConfig({
      stopAreaId: 'stop_area:IDFM:71264',
      stopAreaLabel: 'Hôtel de Ville (Paris)',
      routeId: 'route:IDFM:C01072-inbound',
      routeLabel: '72 → Gare de Lyon (Paris)',
    }),
    true,
  );

  const snapshot = json<{ data: unknown }>('schemas/examples/module-snapshot.json');
  assert.equal(transitData(snapshot.data), true, JSON.stringify(transitData.errors));
  assert.equal(
    weatherData({
      city: 'Paris',
      days: [
        {
          date: '2026-09-17',
          tmin: 12,
          tmax: 21,
          summary: 'Peu nuageux',
          rainProbability: 10,
          windKmh: 14,
        },
      ],
    }),
    true,
    JSON.stringify(weatherData.errors),
  );
  assert.equal(weatherData({ city: 'Paris', days: [{ date: '17/09/2026' }] }), false);
});
