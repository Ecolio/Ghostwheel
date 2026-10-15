import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { StateEvent } from '../../shared/types';
import { screenshots } from './env';

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

type AudioProbe = {
  peers: RTCPeerConnection[];
  streams: MediaStream[];
  calls: number;
  worklets: number;
  NativePeer: typeof RTCPeerConnection;
  remote?: RTCPeerConnection;
  outgoingAudio?: {
    context: AudioContext;
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode;
    sink: GainNode;
  };
  signalAudio?: { context: AudioContext; oscillator: OscillatorNode };
};
declare global {
  interface Window {
    audioProbe: AudioProbe;
  }
}

async function fixture(page: Page, wake = false, signal = false, advanced = false) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((signal) => {
    const NativePeer = window.RTCPeerConnection;
    window.audioProbe = { peers: [], streams: [], calls: 0, worklets: 0, NativePeer };
    window.RTCPeerConnection = class extends NativePeer {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        window.audioProbe.peers.push(this);
      }
    };
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.audioProbe.calls++;
      let stream: MediaStream;
      if (signal) {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 440;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        window.audioProbe.signalAudio = { context, oscillator };
        stream = destination.stream;
        void context.resume();
      } else stream = await getMedia(constraints);
      window.audioProbe.streams.push(stream);
      return stream;
    };
    const addModule = Worklet.prototype.addModule;
    Worklet.prototype.addModule = function (...args) {
      window.audioProbe.worklets++;
      return addModule.apply(this, args);
    };
  }, signal);
  const snapshot: StateEvent = {
    schemaVersion: 1,
    type: 'state',
    bootId: 'latency-browser-fixture',
    sequence: 0,
    sentAt: Date.now(),
    interactionId: null,
    profileEpoch: 0,
    contextVersion: 0,
    state: {
      openaiBlocked: false,
      privacyMode: false,
      advancedAudioBuffer: advanced,
      delegationMode: 'fast',
      wakeWord: { enabled: wake, ready: wake, detail: null },
      browserConnected: true,
      browserAudioReady: true,
      session: {
        phase: 'idle',
        reason: null,
        mode: wake ? 4 : 3,
        interactionId: null,
        profileEpoch: 0,
        contextVersion: 0,
        startedAt: null,
        readyAt: null,
        manualStop: false,
        microphoneEnabled: false,
      },
      presence: {
        state: 'absent',
        health: 'ok',
        peopleCount: 0,
        people: [],
        engagementId: null,
        observedAt: Date.now(),
      },
      activeProfile: null,
      selection: 'household',
      profiles: [],
      cards: [],
      ambientDisplays: [],
      voice: { phase: 'idle', startedAt: 0, endsAt: null },
      diagnostic: null,
    },
  };
  let socket: WebSocketRoute | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const measures: { name?: string; message?: string; event?: string; stage?: string }[] = [];
  const statuses: string[] = [];
  let offers = 0;
  let wakeFrames = 0;
  let wakeSocket: WebSocketRoute | undefined;
  let wakeEnergy = 0;
  let vadEnergy = 0;
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/client-logs', async (route) => {
    const body = route.request().postDataJSON();
    measures.push(...(body.entries ?? [body]));
    await route.fulfill({ json: {} });
  });
  await page.route('**/api/media/status', async (route) => {
    statuses.push(route.request().postDataJSON().type);
    await route.fulfill({ json: {} });
  });
  await page.route('**/api/media/offer', async (route) => {
    offers++;
    const offer = route.request().postDataJSON().sdp;
    // A real second local WebRTC peer replaces OpenAI; no external API call.
    const sdp = await page.evaluate(async (sdp: string) => {
      const remote = new window.audioProbe.NativePeer();
      window.audioProbe.remote = remote;
      remote.ondatachannel = ({ channel }) => {
        channel.onopen = () => channel.send(JSON.stringify({ type: 'session.started' }));
      };
      await remote.setRemoteDescription({ type: 'offer', sdp });
      await remote.setLocalDescription(await remote.createAnswer());
      if (remote.iceGatheringState !== 'complete')
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Loopback ICE timeout')), 3000);
          remote.onicegatheringstatechange = () => {
            if (remote.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              resolve();
            }
          };
        });
      return remote.localDescription!.sdp;
    }, offer);
    await route.fulfill({ json: { transport: { sdp } } });
  });
  await page.routeWebSocket('**/wake-audio', (ws) => {
    wakeSocket = ws;
    ws.onMessage((data) => {
      wakeFrames++;
      const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
      const samples = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
      wakeEnergy = Math.max(wakeEnergy, ...Array.from(samples, (sample) => Math.abs(sample)));
    });
  });
  await page.routeWebSocket('**/audio?*', (ws) => {
    ws.onMessage((data) => {
      const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
      const samples = new Int16Array(
        bytes.buffer,
        bytes.byteOffset,
        Math.floor(bytes.byteLength / 2),
      );
      vadEnergy = Math.max(vadEnergy, ...Array.from(samples, (sample) => Math.abs(sample)));
    });
  });
  await page.routeWebSocket('**/events?role=kiosk', (ws) => {
    socket = ws;
    ws.send(JSON.stringify(snapshot));
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(
      () =>
        ws.send(
          JSON.stringify({
            schemaVersion: 1,
            type: 'heartbeat',
            bootId: snapshot.bootId,
            sequence: snapshot.sequence,
            sentAt: Date.now(),
          }),
        ),
      1000,
    );
  });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Miroir Cornelius' })).toBeVisible();
  const activate = page.getByRole('button', { name: 'Activer la voix' });
  if (await activate.count()) await activate.click();
  await expect(activate).toHaveCount(0);
  if (signal) await page.evaluate(() => window.audioProbe.signalAudio?.context.resume());
  const publish = () => {
    snapshot.sequence++;
    snapshot.sentAt = Date.now();
    socket!.send(JSON.stringify(snapshot));
  };
  const presence = () => {
    snapshot.state.presence.people = [{ trackId: 'visitor', profileId: null, engaged: false }];
    snapshot.state.presence.peopleCount = 1;
    snapshot.state.presence.observedAt = Date.now();
  };
  return {
    snapshot,
    publish,
    presence,
    measures,
    statuses,
    errors,
    offers: () => offers,
    wakeFrames: () => wakeFrames,
    signalWake: () => wakeSocket?.send(JSON.stringify({ type: 'wake_detected' })),
    energy: () => ({ wakeEnergy, vadEnergy }),
    outgoingLevel: () =>
      page.evaluate(async () => {
        if (!window.audioProbe.outgoingAudio) {
          const track = window.audioProbe.peers[0]?.getSenders()[0]?.track;
          if (!track) return 0;
          const context = new AudioContext();
          await context.resume();
          const analyser = context.createAnalyser();
          const sink = context.createGain();
          sink.gain.value = 0;
          const source = context.createMediaStreamSource(new MediaStream([track]));
          source.connect(analyser).connect(sink).connect(context.destination);
          window.audioProbe.outgoingAudio = { context, analyser, source, sink };
        }
        const samples = new Float32Array(512);
        window.audioProbe.outgoingAudio.analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
      }),
    async close() {
      if (heartbeat) clearInterval(heartbeat);
      await page.evaluate(async () => {
        await window.audioProbe.outgoingAudio?.context.close();
        window.audioProbe.signalAudio?.oscillator.stop();
        await window.audioProbe.signalAudio?.context.close();
        window.audioProbe.remote?.close();
      });
    },
  };
}

test('mode normal : aucun micro avant l’admission, puis une offre immédiate rejointe par le micro', async ({
  page,
}) => {
  const f = await fixture(page, false, true);
  try {
    f.presence();
    f.publish();
    await expect(page.locator('.mirror-person')).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.audioProbe.peers.length)).toBe(0);
    expect(f.offers()).toBe(0);
    f.snapshot.state.session = {
      ...f.snapshot.state.session,
      phase: 'connecting',
      interactionId: 'local-loopback',
      startedAt: Date.now(),
    };
    f.publish();
    await expect.poll(() => f.statuses).toContain('connected');
    await expect.poll(() => f.statuses).toContain('started');
    await expect.poll(f.outgoingLevel).toBeGreaterThan(0.005);
    await expect.poll(() => f.energy().vadEnergy).toBeGreaterThan(0);
    expect(f.statuses).not.toContain('failed');
    expect(f.offers()).toBe(1);
    expect(
      await page.evaluate(() => ({
        peers: window.audioProbe.peers.length,
        calls: window.audioProbe.calls,
        worklets: window.audioProbe.worklets,
      })),
    ).toEqual({ peers: 1, calls: 1, worklets: 1 });
    await expect
      .poll(
        () =>
          f.measures.find((measure) => measure.name === 'audio_preparation_reutilisee')?.message,
      )
      .toBe('{"value":0}');
    f.snapshot.state.session.phase = 'closing';
    f.publish();
    await expect
      .poll(() =>
        page.evaluate(() => window.audioProbe.streams[0]!.getAudioTracks()[0]!.readyState),
      )
      .toBe('ended');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('tampon avancé : le micro vidéo est prêt avant la première détection', async ({ page }) => {
  const f = await fixture(page, false, true, true);
  try {
    await expect
      .poll(() => page.evaluate(() => window.audioProbe.peers[0]?.iceGatheringState))
      .toBe('complete');
    await expect.poll(f.outgoingLevel).toBe(0);
    expect(f.offers()).toBe(0);
    f.presence();
    f.publish();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.evaluate(() => window.audioProbe.signalAudio?.oscillator.disconnect());
    await page.waitForTimeout(1_200);
    f.snapshot.state.session = {
      ...f.snapshot.state.session,
      phase: 'connecting',
      interactionId: 'advanced-video-loopback',
      startedAt: Date.now(),
    };
    f.publish();
    // La relecture du tampon dure environ deux secondes : l’échantillonner pendant qu’elle joue.
    await expect.poll(f.outgoingLevel, { intervals: [50] }).toBeGreaterThan(0.005);
    expect(f.statuses).toContain('started');
    expect(f.offers()).toBe(1);
    expect(
      await page.evaluate(() => ({
        peers: window.audioProbe.peers.length,
        calls: window.audioProbe.calls,
        worklets: window.audioProbe.worklets,
      })),
    ).toEqual({ peers: 1, calls: 1, worklets: 1 });
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('tampon avancé : la commande suit le wakeword sans attendre la session', async ({ page }) => {
  const f = await fixture(page, true, true, true);
  try {
    await expect.poll(f.wakeFrames).toBeGreaterThan(0);
    await expect.poll(f.outgoingLevel).toBe(0);
    f.signalWake();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await page.evaluate(() => window.audioProbe.signalAudio?.oscillator.disconnect());
    await page.waitForTimeout(1_200);
    f.snapshot.state.session = {
      ...f.snapshot.state.session,
      phase: 'connecting',
      interactionId: 'advanced-wake-loopback',
      startedAt: Date.now(),
    };
    f.publish();
    // La relecture du tampon dure environ deux secondes : l’échantillonner pendant qu’elle joue.
    await expect.poll(f.outgoingLevel, { intervals: [50] }).toBeGreaterThan(0.005);
    expect(f.statuses).toContain('started');
    expect(f.offers()).toBe(1);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('tampon avancé : la date d’admission rattrape un signal wake perdu', async ({ page }) => {
  const f = await fixture(page, true, true, true);
  try {
    await expect.poll(f.wakeFrames).toBeGreaterThan(0);
    await expect.poll(f.outgoingLevel).toBe(0);
    const admittedAt = Date.now();
    await page.evaluate(() => window.audioProbe.signalAudio?.oscillator.disconnect());
    await page.waitForTimeout(1_200);
    f.snapshot.state.session = {
      ...f.snapshot.state.session,
      phase: 'connecting',
      interactionId: 'advanced-wake-fallback-loopback',
      startedAt: admittedAt,
    };
    f.publish();
    // La relecture du tampon dure environ deux secondes : l’échantillonner pendant qu’elle joue.
    await expect.poll(f.outgoingLevel, { intervals: [50] }).toBeGreaterThan(0.005);
    expect(f.statuses).toContain('started');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('mot d’appel : la veille transmet son micro et son offre sans deuxième capture', async ({
  page,
}) => {
  const f = await fixture(page, true, true);
  try {
    await expect
      .poll(() => page.evaluate(() => window.audioProbe.peers[0]?.iceGatheringState))
      .toBe('complete');
    await expect.poll(f.wakeFrames).toBeGreaterThan(0);
    await expect.poll(() => f.energy().wakeEnergy).toBeGreaterThan(0);
    await expect.poll(f.outgoingLevel).toBe(0);
    expect(f.offers()).toBe(0);
    f.snapshot.state.session = {
      ...f.snapshot.state.session,
      phase: 'connecting',
      interactionId: 'wake-loopback',
      startedAt: Date.now(),
    };
    f.publish();
    await expect.poll(() => f.statuses).toContain('started');
    await expect.poll(f.outgoingLevel).toBeGreaterThan(0.005);
    await expect.poll(() => f.energy().vadEnergy).toBeGreaterThan(0);
    expect(f.statuses).not.toContain('failed');
    expect(f.offers()).toBe(1);
    expect(
      await page.evaluate(() => ({
        peers: window.audioProbe.peers.length,
        calls: window.audioProbe.calls,
        worklets: window.audioProbe.worklets,
      })),
    ).toEqual({ peers: 1, calls: 1, worklets: 1 });
    f.snapshot.state.session.phase = 'closing';
    f.publish();
    await expect
      .poll(() =>
        page.evaluate(() => window.audioProbe.streams[0]!.getAudioTracks()[0]!.readyState),
      )
      .toBe('ended');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('une recherche web colore puis libère le bord organique de l’orbe', async ({ page }) => {
  const f = await fixture(page);
  try {
    f.snapshot.state.session.phase = 'ready';
    f.snapshot.state.session.manualStop = true;
    f.snapshot.state.presence.state = 'present';
    f.presence();
    f.publish();
    await expect(page.locator('.orb')).toHaveAttribute('data-presence', 'aware');
    await expect(page.locator('.orb')).toHaveAttribute('data-renderer', 'three');
    const redPixels = async () => {
      const screenshot = await page.locator('.orb canvas').screenshot();
      return page.evaluate(async (png) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + png;
        await image.decode();
        const sample = document.createElement('canvas');
        sample.width = image.width;
        sample.height = image.height;
        const context = sample.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (
            pixels[i]! > 130 &&
            pixels[i]! > pixels[i + 1]! * 1.7 &&
            pixels[i]! > pixels[i + 2]! * 1.4
          )
            count++;
        return count;
      }, screenshot.toString('base64'));
    };
    const idleRedPixels = await redPixels();
    f.snapshot.state.webSearchActive = true;
    f.publish();
    await expect(page.locator('.orb')).toHaveAttribute('data-web-search', 'active');
    await expect(page.locator('.orb-search-halo')).toHaveCount(0);
    await expect.poll(redPixels).toBeGreaterThan(idleRedPixels + 60);
    await page.locator('.orb').screenshot({ path: `${screenshots}/orb-web-search.png` });

    f.snapshot.state.webSearchActive = false;
    f.publish();
    await expect(page.locator('.orb')).toHaveAttribute('data-web-search', 'active');
    await page.waitForTimeout(1_000);
    await expect(page.locator('.orb')).toHaveAttribute('data-web-search', 'active');
    await expect.poll(redPixels).toBeGreaterThan(idleRedPixels + 60);
    await expect(page.locator('.orb')).toHaveAttribute('data-web-search', 'idle');
    await expect.poll(redPixels).toBeLessThan(idleRedPixels + 30);
  } finally {
    await f.close();
  }
});

test('tampon avancé : blocage, arrêt manuel et plusieurs personnes libèrent la préparation', async ({
  page,
}) => {
  const f = await fixture(page, false, false, true);
  try {
    f.presence();
    f.publish();
    await expect.poll(() => page.evaluate(() => window.audioProbe.peers.length)).toBe(1);
    for (const guard of ['blocked', 'stopped', 'privacy'] as const) {
      const peers = await page.evaluate(() => window.audioProbe.peers.length);
      f.snapshot.state.openaiBlocked = guard === 'blocked';
      f.snapshot.state.session.manualStop = guard === 'stopped';
      f.snapshot.state.privacyMode = guard === 'privacy';
      f.snapshot.state.presence.peopleCount = guard === 'privacy' ? 2 : 1;
      f.publish();
      await expect
        .poll(() => page.evaluate(() => window.audioProbe.peers.at(-1)!.connectionState))
        .toBe('closed');
      await expect
        .poll(() =>
          page.evaluate(() => window.audioProbe.streams.at(-1)!.getAudioTracks()[0]!.readyState),
        )
        .toBe('ended');
      f.snapshot.state.openaiBlocked = false;
      f.snapshot.state.session.manualStop = false;
      f.snapshot.state.privacyMode = false;
      f.snapshot.state.presence.peopleCount = 1;
      f.publish();
      await expect.poll(() => page.evaluate(() => window.audioProbe.peers.length)).toBe(peers + 1);
    }
    expect(f.offers()).toBe(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

for (const enabled of [true, false]) {
  test(
    'son d’ouverture ' + (enabled ? 'joué une fois' : 'muet') + ' à l’admission',
    async ({ page }) => {
      await page.addInitScript(() => {
        const create = BaseAudioContext.prototype.createOscillator;
        (window as unknown as { oscillators: number }).oscillators = 0;
        BaseAudioContext.prototype.createOscillator = function () {
          (window as unknown as { oscillators: number }).oscillators++;
          return create.call(this);
        };
      });
      const f = await fixture(page);
      const oscillators = () =>
        page.evaluate(() => (window as unknown as { oscillators: number }).oscillators);
      try {
        f.snapshot.state.admissionSound = { enabled, sound: 'carillon' };
        f.presence();
        f.publish();
        await expect(page.locator('.mirror-person')).toHaveCount(1);
        expect(await oscillators()).toBe(0);
        f.snapshot.state.session = {
          ...f.snapshot.state.session,
          phase: 'connecting',
          interactionId: 'admission-sound',
          startedAt: Date.now(),
        };
        f.publish();
        await expect.poll(() => f.offers()).toBe(1);
        if (enabled) await expect.poll(oscillators).toBe(4);
        // Un nouvel état de la même ouverture ne rejoue pas le son.
        f.publish();
        await page.waitForTimeout(300);
        expect(await oscillators()).toBe(enabled ? 4 : 0);
        expect(f.errors).toEqual([]);
      } finally {
        await f.close();
      }
    },
  );
}
