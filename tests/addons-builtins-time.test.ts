import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddonInstance, ModuleSnapshot } from '../shared/addons.js';
import { validators } from '../shared/validation.js';
import { createTestModule } from '../server/addons/testing.js';
import clock from '../addons/clock/index.js';
import transit from '../addons/transit/index.js';
import weather from '../addons/weather/index.js';

/** Modules livrés et le temps : affichage recalculé à l'heure dite, jours du foyer, vide dit. */
const instance = { id: 'i', ref: 'maison' } as AddonInstance;
const context = (iso: string, timeZone = 'Europe/Paris') => ({
  instance,
  now: () => Date.parse(iso),
  timeZone,
});
function snapshot<T extends Record<string, unknown>>(
  data: T,
  status: ModuleSnapshot['status'] = 'ready',
): ModuleSnapshot<T> {
  return {
    schemaVersion: 1,
    snapshotId: 's',
    cacheKey: 'k',
    revision: 1,
    moduleId: 'm',
    dataVersion: 1,
    scope: { kind: 'household', userId: null },
    source: { provider: 'test', sourceId: 'test' },
    fetchedAt: '2026-10-20T08:00:00.000Z',
    observedAt: null,
    validUntil: '2026-10-20T09:00:00.000Z',
    status,
    data,
  };
}

test('l’horloge permanente se recalcule à la minute suivante, ou à la seconde', async (t) => {
  const f = createTestModule(t, clock, { at: '2026-10-20T08:00:42.500Z' });
  await f.read();
  assert.equal(f.ambient().content?.refreshAt, '2026-10-20T08:01:00.000Z');
  assert.equal(f.ambient().content?.value, '10:00');
  f.configure({ showSeconds: true });
  await f.read();
  assert.equal(f.ambient().content?.refreshAt, '2026-10-20T08:00:43.000Z');
});

test('la météo saute les jours passés et change de jour à minuit, heure du foyer', () => {
  const data = {
    city: 'Rennes',
    days: [
      { date: '2026-10-20', tmin: 8, tmax: 15, summary: 'Pluie', rainProbability: 80, windKmh: 20 },
      { date: '2026-10-21', tmin: 6, tmax: 17, summary: 'Soleil', rainProbability: 0, windKmh: 10 },
      {
        date: '2026-10-22',
        tmin: 7,
        tmax: 16,
        summary: 'Nuageux',
        rainProbability: 10,
        windKmh: 15,
      },
    ],
  };
  const evening = weather.present(snapshot(data), context('2026-10-20T20:00:00Z'));
  assert.equal(evening.primaryValue, '8 / 15 °C');
  // 0 h 30 à Paris le 21 : le relevé de la veille donne déjà la journée du 21.
  const night = weather.present(snapshot(data), context('2026-10-20T22:30:00Z'));
  assert.equal(night.primaryValue, '6 / 17 °C');
  assert.equal(night.items[0]?.label, 'jeudi');
  const ambient = weather.ambient!.present(snapshot(data), context('2026-10-20T20:00:00Z'));
  assert.equal(ambient.refreshAt, '2026-10-20T22:00:00.000Z');
  assert.equal(validators.ambientPresentation(ambient), true);
  // À La Réunion (UTC+4), minuit tombe plus tôt.
  const reunion = weather.ambient!.present(
    snapshot(data),
    context('2026-10-20T15:00:00Z', 'Indian/Reunion'),
  );
  assert.equal(reunion.refreshAt, '2026-10-20T20:00:00.000Z');
});

test('les bus : « aucun passage » dit comme tel, compte à rebours à la minute', () => {
  const data = { stopId: 'stop', lineLabel: '72', direction: 'Gare', departures: [] };
  const none = transit.present(snapshot(data, 'empty'), context('2026-10-20T08:00:00Z'));
  assert.equal(none.primaryValue, 'Aucun passage');
  assert.match(none.summary, /^Aucun passage prévu pour le moment sur la ligne 72/u);
  const quiet = transit.ambient!.present(snapshot(data, 'empty'), context('2026-10-20T08:00:00Z'));
  assert.equal(quiet.value, 'Aucun passage');
  assert.equal(quiet.refreshAt, undefined);

  const departing = {
    ...data,
    departures: [
      {
        id: 'a',
        scheduledAt: '2026-10-20T08:05:00Z',
        expectedAt: '2026-10-20T08:05:00Z',
        realtime: true,
        cancelled: false,
      },
    ],
  };
  const soon = transit.ambient!.present(snapshot(departing), context('2026-10-20T08:00:20Z'));
  assert.equal(soon.refreshAt, '2026-10-20T08:01:00.000Z');
  assert.equal(validators.ambientPresentation(soon), true);
});
