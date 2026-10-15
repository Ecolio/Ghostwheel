import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioPreparation,
  prepareAudio,
  takePreparedMicrophone,
  invalidateAudioPreparation,
  releasePreparedMicrophone,
  preparePcmWorklet,
} from '../web/audio/preparation.js';

test('une activation prépare micro et son, regroupe les demandes et permet de réessayer après refus', async (t) => {
  let calls = 0;
  let workletLoads = 0;
  let resolve!: (stream: MediaStream) => void;
  let denied = false;
  const context = {
    state: 'suspended',
    audioWorklet: {
      async addModule() {
        workletLoads++;
      },
    },
    async resume() {
      this.state = 'running';
    },
  };
  const track = {
    enabled: true,
    readyState: 'live',
    stop() {
      this.readyState = 'ended';
    },
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => null },
    AudioContext: function () {
      return context;
    },
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          calls++;
          return denied
            ? Promise.reject(Object.assign(new Error(), { name: 'NotAllowedError' }))
            : new Promise<MediaStream>((done) => {
                resolve = done;
              });
        },
      },
    },
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  t.after(() => {
    releasePreparedMicrophone();
    invalidateAudioPreparation();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const first = prepareAudio();
  const second = prepareAudio();
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(audioPreparation().ready, false);
  resolve(stream);
  await first;
  assert.equal(audioPreparation().ready, true);
  assert.equal(track.enabled, false);
  await preparePcmWorklet(context as unknown as AudioContext);
  assert.equal(workletLoads, 1);
  assert.equal(takePreparedMicrophone(), stream);
  track.stop();
  invalidateAudioPreparation();
  denied = true;
  await assert.rejects(prepareAudio(), /Microphone refusé/);
  assert.equal(audioPreparation().ready, false);
  denied = false;
  const retry = prepareAudio();
  resolve(stream);
  await retry;
  assert.equal(audioPreparation().ready, true);
});
