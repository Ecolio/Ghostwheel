import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationMeasures, type ConversationMeasureName } from '../web/audio/measures.js';

function recorder() {
  const events: Array<{ name: ConversationMeasureName; durationMs: number }> = [];
  return {
    events,
    emit: (name: ConversationMeasureName, durationMs: number) => events.push({ name, durationMs }),
  };
}

test('la latence de réponse va de la fin de parole à la première sortie audible', () => {
  const r = recorder();
  const measures = new ConversationMeasures(r.emit);
  measures.onPhase('listening', 1000);
  measures.sample(0, 1100);
  measures.onPhase('thinking', 2000);
  measures.sample(0, 2100);
  measures.sample(0.5, 2450);
  assert.deepEqual(r.events, [{ name: 'reponse_latence', durationMs: 450 }]);
});

test('une interruption mesure la parole utilisateur jusqu’au silence de la réponse', () => {
  const r = recorder();
  const measures = new ConversationMeasures(r.emit);
  measures.sample(0.4, 1000);
  measures.onPhase('listening', 1050);
  measures.sample(0.4, 1200);
  measures.sample(0, 1430);
  assert.deepEqual(r.events, [{ name: 'interruption', durationMs: 380 }]);
});

test('une attente sans réponse est abandonnée sans faux relevé', () => {
  const r = recorder();
  const measures = new ConversationMeasures(r.emit);
  measures.onPhase('listening', 1000);
  measures.onPhase('thinking', 2000);
  measures.sample(0, 12_500);
  measures.sample(0.5, 12_600);
  measures.reset();
  assert.equal(r.events.length, 0);
});

test('une parole sans réponse audible ne déclenche pas d’interruption', () => {
  const r = recorder();
  const measures = new ConversationMeasures(r.emit);
  measures.sample(0, 1000);
  measures.onPhase('listening', 1100);
  measures.sample(0, 1400);
  measures.onPhase('thinking', 1500);
  measures.sample(0.4, 1900);
  assert.deepEqual(r.events, [{ name: 'reponse_latence', durationMs: 400 }]);
});
