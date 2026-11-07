import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERSON_HOLD_MS,
  UNKNOWN_DELAY_MS,
  rememberPeople,
  steadyPeople,
  type PeopleMemory,
  type PresencePerson,
} from '../web/components/steady-people.js';

const camille: PresencePerson = { trackId: 'a', profileId: 'camille', engaged: false };
const stranger = (trackId: string): PresencePerson => ({
  trackId,
  profileId: null,
  engaged: false,
});
const empty = (): PeopleMemory => ({ known: new Map(), unknown: null });
const names = (memory: PeopleMemory, at: number) =>
  steadyPeople(memory, at).people.map((person) => person.profileId ?? 'inconnu');

test('une personne reconnue s’affiche tout de suite et survit à une image manquée', () => {
  let memory = rememberPeople(empty(), [camille], 0);
  assert.deepEqual(names(memory, 0), ['camille']);
  assert.deepEqual(names(memory, 60_000), ['camille']); // Toujours là : jamais retirée.
  memory = rememberPeople(memory, [], 500);
  assert.deepEqual(names(memory, 500), ['camille']);
  assert.deepEqual(names(memory, 500 + PERSON_HOLD_MS), []);
});

test('un inconnu qui apparaît et disparaît par à-coups ne fait pas clignoter le bas', () => {
  let memory = rememberPeople(empty(), [stranger('1')], 0);
  assert.deepEqual(names(memory, 0), []);
  assert.equal(steadyPeople(memory, 0).nextChangeAt, UNKNOWN_DELAY_MS);
  // Détecté, perdu, retrouvé sous une autre piste : le même épisode continue.
  memory = rememberPeople(memory, [], 600);
  memory = rememberPeople(memory, [stranger('2')], 1_200);
  assert.deepEqual(names(memory, UNKNOWN_DELAY_MS), ['inconnu']);
  memory = rememberPeople(memory, [], 2_000);
  assert.deepEqual(names(memory, 4_000), ['inconnu']);
  assert.deepEqual(names(memory, 2_000 + PERSON_HOLD_MS), []);
});

test('un inconnu vu un instant ne s’affiche jamais', () => {
  let memory = rememberPeople(empty(), [stranger('1')], 0);
  memory = rememberPeople(memory, [], 300);
  for (const at of [300, 1_000, UNKNOWN_DELAY_MS, 2_500]) assert.deepEqual(names(memory, at), []);
  // Revu bien plus tard : un nouvel épisode, avec un nouveau délai.
  memory = rememberPeople(memory, [stranger('2')], 10_000);
  assert.deepEqual(names(memory, 10_500), []);
});
