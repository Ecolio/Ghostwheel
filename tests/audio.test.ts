import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('le microphone conserve une seconde de son en PCM16 mono à 16 kHz, à 44,1 et 48 kHz', () => {
  const source = readFileSync(new URL('../web/audio/pcm-worklet.js', import.meta.url), 'utf8');
  for (const sampleRate of [44100, 48000]) {
    const chunks: Int16Array[] = [];
    let Processor!: new () => { process(inputs: Float32Array[][]): boolean; offset: number };
    runInNewContext(source, {
      sampleRate,
      AudioWorkletProcessor: class {
        port = { postMessage: (data: ArrayBuffer) => chunks.push(new Int16Array(data)) };
      },
      registerProcessor(_name: string, value: typeof Processor) {
        Processor = value;
      },
    });
    const capture = new Processor();
    for (let i = 0; i < sampleRate; i += 128)
      capture.process([[new Float32Array(Math.min(128, sampleRate - i)).fill(0.5)]]);
    assert.equal(chunks.length * 512 + capture.offset, 16000);
    assert.equal(
      chunks.every(
        (frame) => frame.length === 512 && frame.every((value) => Math.abs(value - 16384) <= 1),
      ),
      true,
    );
  }
});

test('le tampon garde la parole avant et pendant la connexion puis la rejoue sans doublon', () => {
  const source = readFileSync(new URL('../web/audio/pcm-worklet.js', import.meta.url), 'utf8');
  let Processor!: new () => {
    port: { onmessage: (event: { data: { type: string } }) => void };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  };
  runInNewContext(source, {
    sampleRate: 16000,
    AudioWorkletProcessor: class {
      port = { onmessage: null, postMessage() {} };
    },
    registerProcessor(_name: string, value: typeof Processor) {
      Processor = value;
    },
  });
  const capture = new Processor();
  const feed = (sample: number, blocks: number) => {
    const played: number[] = [];
    for (let i = 0; i < blocks; i++) {
      const output = new Float32Array(128);
      capture.process([[new Float32Array(128).fill(sample)]], [[output]]);
      played.push(...output);
    }
    return played;
  };
  assert.ok(feed(0.1, 125).every((sample) => sample === 0));
  capture.port.onmessage({ data: { type: 'trigger' } });
  assert.ok(feed(0.2, 5).every((sample) => sample === 0));
  capture.port.onmessage({ data: { type: 'play' } });
  const played = feed(0.3, 68);
  for (const [index, expected] of [
    [0, 0.1],
    [7999, 0.1],
    [8000, 0.2],
    [8639, 0.2],
    [8640, 0.3],
  ] as [number, number][]) {
    assert.ok(Math.abs(played[index]! - expected) < 0.00001, 'sample ' + index);
  }
});

import { getEventListeners } from 'node:events';
import type { TestContext } from 'node:test';
import { createAudioSession } from '../web/audio/session.js';

function browserAudioFixture(t: TestContext, running = false) {
  const window = new EventTarget();
  let microphoneRequests = 0;
  let releaseMicrophone!: (stream: MediaStream) => void;
  let rejectPlayback!: (error: Error) => void;
  let peer!: Peer;
  const locked: boolean[] = [];
  class Context extends EventTarget {
    state = running ? 'running' : 'suspended';
    createAnalyser() {
      return { fftSize: 256, getFloatTimeDomainData() {} };
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    resume() {
      return new Promise<void>(() => {});
    }
    async close() {
      this.state = 'closed';
    }
  }
  class Peer {
    ontrack: ((event: { track: unknown }) => void) | null = null;
    localDescription: { type: string; sdp: string } | null = null;
    constructor() {
      peer = this;
    }
    createDataChannel() {
      return { close() {} };
    }
    addTransceiver() {
      return { sender: { replaceTrack: async () => {} } };
    }
    async createOffer() {
      return { type: 'offer', sdp: 'local-sdp' };
    }
    async setLocalDescription(value: { type: string; sdp: string }) {
      this.localDescription = value;
    }
    async setRemoteDescription() {}
    close() {}
  }
  class Output {
    autoplay = false;
    srcObject: unknown = null;
    pause() {}
    play() {
      return new Promise<void>((_resolve, reject) => {
        rejectPlayback = reject;
      });
    }
  }
  const replacements: Record<string, unknown> = {
    window,
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          microphoneRequests++;
          return new Promise<MediaStream>((resolve) => {
            releaseMicrophone = resolve;
          });
        },
      },
    },
    localStorage: { getItem: () => null },
    RTCPeerConnection: Peer,
    Audio: Output,
    AudioContext: Context,
    MediaStream: class {},
    fetch: async (url: string) =>
      new Response(
        JSON.stringify(url === '/api/media/offer' ? { transport: { sdp: 'answer' } } : {}),
        { status: 200 },
      ),
  };
  let audio!: ReturnType<typeof createAudioSession>;
  t.after(() => audio?.dispose());
  for (const [key, value] of Object.entries(replacements)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  audio = createAudioSession(
    { interactionId: 'test-audio', profileEpoch: 1, contextVersion: 1 },
    () => assert.fail('Unexpected audio failure'),
    (value) => locked.push(value),
  );
  return {
    audio,
    window,
    locked,
    microphoneRequests: () => microphoneRequests,
    releaseMicrophone: (stream: MediaStream) => releaseMicrophone(stream),
    receiveTrack: () => peer.ontrack?.({ track: {} }),
    rejectPlayback: () => rejectPlayback(new Error('Autoplay blocked')),
  };
}

const flushAudio = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

for (const stop of ['silence', 'dispose'] as const) {
  test(
    'un arrêt audio via ' + stop + ' pendant le blocage navigateur ne demande jamais le microphone',
    async (t) => {
      const f = browserAudioFixture(t);
      assert.deepEqual(f.locked, [true]);
      f.audio[stop]();
      await flushAudio();
      assert.equal(f.microphoneRequests(), 0);
      assert.deepEqual(f.locked, [true, false]);
      for (const gesture of ['pointerdown', 'keydown', 'touchstart'])
        assert.equal(getEventListeners(f.window, gesture).length, 0);
    },
  );
}

test('une permission microphone accordée après arrêt libère immédiatement la piste', async (t) => {
  const f = browserAudioFixture(t, true);
  await flushAudio();
  assert.equal(f.microphoneRequests(), 1);
  f.audio.silence();
  let stopped = false;
  f.releaseMicrophone({
    getTracks: () => [
      {
        stop() {
          stopped = true;
        },
      },
    ],
  } as unknown as MediaStream);
  await flushAudio();
  assert.equal(stopped, true);
});

for (const late of [false, true]) {
  test(
    'le refus autoplay ' +
      (late ? 'tardif' : 'déjà reçu') +
      ' ne laisse aucun écouteur après clôture',
    async (t) => {
      const f = browserAudioFixture(t, true);
      await flushAudio();
      f.receiveTrack();
      if (late) f.audio.dispose();
      f.rejectPlayback();
      await flushAudio();
      if (!late) {
        assert.equal(getEventListeners(f.window, 'pointerdown').length, 1);
        f.audio.dispose();
      }
      for (const gesture of ['pointerdown', 'keydown'])
        assert.equal(getEventListeners(f.window, gesture).length, 0);
    },
  );
}
