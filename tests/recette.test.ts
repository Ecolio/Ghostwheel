import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyLimits,
  parseLimits,
  parseProtocol,
  type RecetteProtocol,
} from '../scripts/recette-lib.js';

const valid = {
  version: 1,
  answerWaitMs: 15_000,
  gapMs: 900,
  passageSeconds: 6,
  approaches: 3,
  passages: 4,
  questions: [
    { id: 'q01', text: 'Quel temps fait-il ?' },
    { id: 'q02', text: 'Quand passe le bus ?' },
  ],
  interruptions: [{ id: 'i01', text: 'Attends.' }],
};

test('le protocole de recette est validé et ses valeurs par défaut appliquées', () => {
  const protocol = parseProtocol(valid);
  assert.equal(protocol.questions.length, 2);
  assert.equal(protocol.interruptions[0]?.text, 'Attends.');
  assert.equal(protocol.approaches, 3);
  const defaults = parseProtocol({
    version: 1,
    questions: valid.questions,
    interruptions: valid.interruptions,
  });
  assert.equal(defaults.answerWaitMs, 15_000);
  assert.equal(defaults.passages, 50);
});

test('un protocole invalide est refusé avec un message explicite', () => {
  assert.throws(() => parseProtocol(null), /objet attendu/);
  assert.throws(() => parseProtocol({ ...valid, version: 2 }), /version 1/);
  assert.throws(() => parseProtocol({ ...valid, questions: [] }), /questions/);
  assert.throws(
    () => parseProtocol({ ...valid, questions: [{ id: 'Q 1', text: 'x' }] }),
    /identifiant/,
  );
  assert.throws(
    () => parseProtocol({ ...valid, interruptions: [{ id: 'i01', text: '  ' }] }),
    /texte manquant/,
  );
  assert.throws(() => parseProtocol({ ...valid, answerWaitMs: 100 }), /au moins 1000/);
});

test('les limites de passage bornent le protocole sans jamais le dépasser', () => {
  const protocol = parseProtocol(valid);
  const limited = applyLimits(protocol, {
    questions: 1,
    interruptions: 5,
    approaches: 2,
    passages: null,
  });
  assert.equal(limited.questions.length, 1);
  assert.equal(limited.interruptions.length, 1);
  assert.equal(limited.approaches, 2);
  assert.equal(limited.passages, 4);
  const none = applyLimits(protocol, {
    questions: 0,
    interruptions: 0,
    approaches: 0,
    passages: 0,
  });
  assert.equal(none.questions.length, 0);
  assert.equal(none.approaches, 0);
});

test('les limites se lisent depuis les arguments de ligne de commande', () => {
  const limits = parseLimits(['--questions', '5', '--passages', '10', '--list']);
  assert.deepEqual(limits, { questions: 5, interruptions: null, approaches: null, passages: 10 });
  assert.throws(() => parseLimits(['--questions', 'abc']), /entier positif/);
  assert.throws(() => parseLimits(['--questions', '-2']), /entier positif/);
});

test('le protocole livré couvre les quatre volets de la recette', () => {
  const protocol: RecetteProtocol = parseProtocol(
    JSON.parse(readFileSync('tests/recette/protocol.json', 'utf8')),
  );
  assert.equal(protocol.questions.length, 50);
  assert.equal(protocol.interruptions.length, 20);
  assert.equal(protocol.approaches, 20);
  assert.equal(protocol.passages, 50);
});
