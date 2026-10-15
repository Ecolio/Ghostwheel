import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMISSION_SOUNDS, isAdmissionSound } from '../shared/admission-sound.js';
import { playAdmissionSound } from '../web/audio/admission-sound.js';

/** Contexte audio minimal : enregistre les nœuds, leurs démarrages et leurs arrêts. */
function fakeContext() {
  const started: number[] = [];
  const stopped: number[] = [];
  const connections: unknown[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime() {},
    exponentialRampToValueAtTime(value: number) {
      assert.ok(value > 0, 'une rampe exponentielle exige une valeur positive');
    },
  });
  const node = () => ({
    connect(target: unknown) {
      connections.push(target);
      return target;
    },
    disconnect() {},
  });
  const source = () => ({
    ...node(),
    type: 'sine',
    buffer: null,
    frequency: param(),
    detune: param(),
    start(at: number) {
      started.push(at);
    },
    stop(at: number) {
      stopped.push(at);
    },
  });
  const context = {
    currentTime: 10,
    sampleRate: 48_000,
    destination: node(),
    createOscillator: source,
    createBufferSource: source,
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', Q: param(), frequency: param() }),
    createBuffer: (_channels: number, length: number) => {
      const samples = new Float32Array(length);
      return { getChannelData: () => samples };
    },
  };
  return { context: context as unknown as BaseAudioContext, started, stopped, connections };
}

test('les six sons d’ouverture sont distincts, courts et libèrent leurs sources', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  assert.equal(ADMISSION_SOUNDS.length, 6);
  const signatures = new Set<string>();
  for (const sound of ADMISSION_SOUNDS) {
    const f = fakeContext();
    const duration = playAdmissionSound(f.context, sound);
    assert.ok(duration > 0.2 && duration < 1.5, sound + ' : ' + duration + ' s');
    assert.ok(f.started.length > 0, sound);
    assert.equal(f.stopped.length, f.started.length, sound + ' : chaque source s’arrête');
    assert.ok(
      f.started.every((at) => at >= 10),
      sound + ' : rien avant maintenant',
    );
    signatures.add(f.started.length + ':' + duration.toFixed(3));
  }
  assert.ok(signatures.size >= 5, 'les sons ne sont pas des copies');
  t.mock.timers.tick(2000);
});

test('le réglage du son d’ouverture refuse les sons inconnus et les champs en trop', () => {
  assert.equal(isAdmissionSound({ enabled: true, sound: 'goutte' }), true);
  assert.equal(isAdmissionSound({ enabled: true, sound: 'sirène' }), false);
  assert.equal(isAdmissionSound({ enabled: 1, sound: 'goutte' }), false);
  assert.equal(isAdmissionSound({ enabled: true, sound: 'goutte', volume: 1 }), false);
});
