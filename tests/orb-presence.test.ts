import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceMotion, type PresenceMotionInput } from '../web/components/orb-presence.js';

const frame = (
  timestamp: number,
  overrides: Partial<PresenceMotionInput> = {},
): PresenceMotionInput => ({
  pose: 'recognized',
  recognitionKey: 'camille',
  timestamp,
  reducedMotion: false,
  voiceActive: false,
  ...overrides,
});

test('la reconnaissance laisse le point se réveiller puis salue une seule fois', () => {
  const motion = createPresenceMotion();
  assert.equal(motion(frame(0)).greeting, false);
  const flight = motion(frame(700));
  assert.equal(flight.greeting, true);
  assert.ok(flight.lift < -20);
  assert.ok(flight.twist > 0);
  assert.ok(flight.flow > 0 && flight.flow < Math.PI * 2);
  for (const time of [2_400, 2_650, 3_000, 20_000]) {
    assert.deepEqual(motion(frame(time)), {
      lift: 0,
      twist: 0,
      flow: 0,
      stretchX: 1,
      stretchY: 1,
      greeting: false,
    });
  }
});

test('une autre personne ou une nouvelle arrivée peut déclencher un nouveau salut', () => {
  const motion = createPresenceMotion();
  motion(frame(0, { pose: 'aware', recognitionKey: null }));
  assert.equal(motion(frame(1_000)).greeting, true);
  assert.equal(motion(frame(3_000)).greeting, false);
  assert.equal(motion(frame(3_100, { recognitionKey: 'robin' })).greeting, true);
  assert.equal(motion(frame(3_200, { pose: 'sleeping', recognitionKey: null })).greeting, false);
  assert.equal(motion(frame(4_000)).greeting, false);
  assert.equal(motion(frame(4_800)).greeting, true);
});

test('un départ, une parole ou le mouvement réduit interrompent le salut sans le rejouer', () => {
  for (const interrupt of [
    { pose: 'sleeping', recognitionKey: null },
    { voiceActive: true },
    { reducedMotion: true },
  ] satisfies Partial<PresenceMotionInput>[]) {
    const motion = createPresenceMotion();
    motion(frame(0));
    assert.equal(motion(frame(1_000)).greeting, true);
    const stopped = motion(frame(1_100, interrupt));
    assert.equal(stopped.greeting, false);
    assert.equal(stopped.twist, 0);
    assert.equal(stopped.flow, 0);
    if (interrupt.pose !== 'sleeping') assert.equal(motion(frame(1_200)).greeting, false);
  }
});

test('un retour dans un onglet après le salut ne rejoue pas une animation ancienne', () => {
  const motion = createPresenceMotion();
  motion(frame(0));
  assert.equal(motion(frame(60_000)).greeting, false);
});
