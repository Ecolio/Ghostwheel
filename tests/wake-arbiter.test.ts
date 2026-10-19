import assert from 'node:assert/strict';
import test from 'node:test';
import { WakeArbiter } from '../server/wake-arbiter.js';

test('arbitrage : un seul flux passe aussitôt', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const accepted: string[] = [];
  const arbiter = new WakeArbiter(
    () => 1,
    () => now,
  );
  arbiter.detected({ score: 0.6, accept: () => accepted.push('mirror') });
  assert.deepEqual([...accepted], ['mirror']);
  // Écho du même appel : ignoré ; un nouvel appel plus tard passe.
  now = 500;
  arbiter.detected({ score: 0.9, accept: () => accepted.push('echo') });
  now = 2000;
  arbiter.detected({ score: 0.7, accept: () => accepted.push('again') });
  assert.deepEqual([...accepted], ['mirror', 'again']);
});

test('arbitrage : plusieurs appareils, le meilleur score l’emporte', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const accepted: string[] = [];
  const arbiter = new WakeArbiter(
    () => 3,
    () => now,
  );
  arbiter.detected({ score: 0.6, accept: () => accepted.push('mirror') });
  arbiter.detected({ score: 0.95, accept: () => accepted.push('kitchen') });
  arbiter.detected({ score: 0.7, accept: () => accepted.push('bedroom') });
  assert.deepEqual([...accepted], []);
  t.mock.timers.tick(250);
  assert.deepEqual([...accepted], ['kitchen']);
  now = 400;
  arbiter.detected({ score: 0.99, accept: () => accepted.push('late') });
  t.mock.timers.tick(250);
  assert.deepEqual([...accepted], ['kitchen']);
  arbiter.dispose();
});
