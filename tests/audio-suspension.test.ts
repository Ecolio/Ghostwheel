import assert from 'node:assert/strict';
import test from 'node:test';
import {
  audioPreparation,
  invalidateAudioPreparation,
  prepareAudio,
  releasePreparedMicrophone,
  restoreAudioPermission,
} from '../web/audio/preparation.js';

/** AudioContext factice : setSinkId suit la spécification (suspended, puis running). */
function fakeContext() {
  const listeners: (() => void)[] = [];
  const context = {
    state: 'suspended' as AudioContextState,
    sinkId: '',
    resumable: true,
    audioWorklet: { async addModule() {} },
    addEventListener(_type: string, listener: () => void) {
      listeners.push(listener);
    },
    emit(state: AudioContextState) {
      context.state = state;
      listeners.forEach((listener) => listener());
    },
    async resume() {
      if (context.resumable && context.state !== 'closed') context.emit('running');
    },
    async setSinkId(id: string) {
      const wasRunning = context.state === 'running';
      if (wasRunning) context.emit('suspended');
      await Promise.resolve();
      context.sinkId = id;
      if (wasRunning) context.emit('running');
    },
  };
  return context;
}

test('une suspension brève (sortie audio choisie) garde la voix ; une coupure durable la retire', async (t) => {
  const context = fakeContext();
  const track = { enabled: true, readyState: 'live', stop() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  // Un PermissionStatus est vivant : son état change sans nouvel objet.
  const permission: { state: string; onchange: null } = { state: 'prompt', onchange: null };
  let microphones = 0;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify({ microphone: '', speaker: 'haut-parleur' }) },
    AudioContext: function () {
      return context;
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          microphones++;
          return stream;
        },
      },
      permissions: { query: async () => permission },
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

  // Sans autorisation micro déjà accordée, aucune tentative silencieuse n’ouvre le micro.
  await restoreAudioPermission();
  assert.equal(microphones, 0);
  // Micro autorisé (politique du navigateur) mais son bloqué sans geste : pas de micro non plus.
  permission.state = 'granted';
  context.resumable = false;
  await restoreAudioPermission();
  assert.equal(microphones, 0);
  assert.equal(audioPreparation().ready, false);
  // Le navigateur du miroir autorise le son : la voix se prépare seule, sortie choisie comprise.
  context.resumable = true;
  await restoreAudioPermission();
  assert.equal(audioPreparation().ready, true);
  assert.equal(context.sinkId, 'haut-parleur');
  assert.equal(microphones, 1);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Changement de sortie pendant une conversation : suspended puis running.
  await context.setSinkId('autre-sortie');
  assert.equal(audioPreparation().ready, true);
  // Suspension sans reprise : la voix tient le délai de grâce, puis demande une réactivation.
  context.resumable = false;
  context.emit('suspended');
  t.mock.timers.tick(2900);
  assert.equal(audioPreparation().ready, true);
  t.mock.timers.tick(200);
  assert.equal(audioPreparation().ready, false);
  assert.match(audioPreparation().error ?? '', /suspendu/);

  // Une fermeture du contexte retire la voix immédiatement.
  context.resumable = true;
  context.state = 'suspended';
  t.mock.timers.reset();
  await prepareAudio();
  assert.equal(audioPreparation().ready, true);
  context.emit('closed');
  assert.equal(audioPreparation().ready, false);
});
