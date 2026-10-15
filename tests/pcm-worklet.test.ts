import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

type Message = { type: string; advanced?: boolean; lookbackSeconds?: number };
type Worklet = {
  port: { onmessage: (event: { data: Message }) => void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

function makeWorklet() {
  const messages: { type: string }[] = [];
  let Capture: (new () => Worklet) | undefined;
  class Base {
    port = {
      onmessage: (_event: { data: Message }) => {},
      postMessage: (message: { type: string }) => messages.push(message),
    };
  }
  runInNewContext(readFileSync(new URL('../web/audio/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: Base,
    sampleRate: 16000,
    Float32Array,
    Int16Array,
    Math,
    Number,
    registerProcessor: (_name: string, constructor: new () => Worklet) => {
      Capture = constructor;
    },
  });
  assert.ok(Capture);
  const worklet = new Capture();
  const send = (data: Message) => worklet.port.onmessage({ data });
  const frame = (amplitude: number) => {
    const output = new Float32Array(128);
    worklet.process([[new Float32Array(128).fill(amplitude)]], [[output]]);
    return output;
  };
  const frames = (count: number, amplitude: number) =>
    Array.from({ length: count }, () => frame(amplitude));
  return { send, frame, frames, messages };
}

test('le tampon avancé transmet une commande dite pendant l’ouverture', () => {
  const advanced = makeWorklet();
  advanced.frames(125, 0);
  advanced.frames(25, 0.7);
  advanced.frames(100, 0);
  advanced.send({ type: 'trigger', advanced: true });
  assert.equal(Math.max(...advanced.frame(0)), 0);
  advanced.send({ type: 'play' });
  const heard = advanced.frames(125, 0).flatMap((frame) => Array.from(frame));
  assert.ok(Math.max(...heard) > 0.5);
});

test('le repère précoce conserve la parole jusqu’à la session et reset écarte une ancienne détection', () => {
  const worklet = makeWorklet();
  worklet.frames(125, 0);
  worklet.send({ type: 'trigger', advanced: true });
  worklet.frames(25, 0.7);
  worklet.frames(100, 0);
  worklet.send({ type: 'play' });
  const heard = worklet.frames(150, 0).flatMap((frame) => Array.from(frame));
  assert.ok(Math.max(...heard) > 0.5);

  worklet.send({ type: 'reset' });
  worklet.frames(125, 0);
  worklet.send({ type: 'trigger', advanced: true });
  worklet.send({ type: 'play' });
  const next = worklet.frames(125, 0).flatMap((frame) => Array.from(frame));
  assert.equal(Math.max(...next), 0);
});

test('le rattrapage garde la parole récente et élimine le retard accumulé', () => {
  const worklet = makeWorklet();
  worklet.frames(125, 0);
  worklet.send({ type: 'trigger', advanced: true });
  worklet.frames(100, 0.7);
  worklet.send({ type: 'play' });
  worklet.frame(0.7);
  worklet.send({ type: 'catchup' });

  const caughtUp = worklet.frame(0.4);
  assert.ok(Math.max(...caughtUp) > 0.5);
});

test('le retard d’ouverture est rattrapé en sautant les blancs, jamais la parole', () => {
  const worklet = makeWorklet();
  // Une phrase d’une demi-seconde, puis deux secondes de silence le temps que la session s’ouvre.
  worklet.frames(64, 0.6);
  worklet.frames(250, 0);
  worklet.send({ type: 'trigger', advanced: true, lookbackSeconds: 3 });
  worklet.send({ type: 'play' });
  const heard = worklet.frames(120, 0).flatMap((frame) => Array.from(frame));
  const spoken = heard.filter((sample) => sample > 0.5).length;
  // Toute la parole est rendue, et pas en accéléré.
  assert.ok(spoken >= 64 * 128 - 160, String(spoken));
  // Les 2 s de blanc ne sont pas rejouées : le direct est rattrapé en moins d’une seconde.
  const lastSpeech = heard.findLastIndex((sample) => sample > 0.5);
  const afterSpeech = heard.slice(lastSpeech + 1);
  assert.ok(afterSpeech.length >= 16000 * 0.15, 'une pause naturelle reste après la phrase');
  const backlog = worklet.frames(45, 0.3).flatMap((frame) => Array.from(frame));
  assert.ok(
    backlog.some((sample) => sample > 0.25),
    'le direct arrive avec 0,3 s de marge au plus, sans attendre la fin du blanc',
  );
});
