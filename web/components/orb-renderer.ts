import {
  Color,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import {
  orbVertexShader,
  orbFragmentShader,
  haloVertexShader,
  haloFragmentShader,
  cardFragmentShader,
  listeningLineFragmentShader,
} from './orb-shaders';
import type { SessionPhase, VoiceActivity } from '../../shared/types';

import { createPresenceMotion, type PresencePose } from './orb-presence';

export const ORB_SIZE = 512;

export interface SceneLayout {
  width: number;
  height: number;
  orb: { x: number; y: number; size: number };
  cards: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    opacity: number;
    /** Famille de la carte (bus, météo, Luna, web…) : teinte du verre. */
    kind?: string;
    /** Instant (horloge de performance) de la première apparition de la carte. */
    born?: number;
  }[];
}

/** Teintes discrètes par famille : on reconnaît une carte avant de la lire. */
const cardTints: Record<string, string> = {
  bus: '#ffb35c',
  weather: '#7cc4ff',
  clock: '#dfe6ee',
  luna: '#b39dff',
  web: '#ff8f7a',
  image: '#f2efe8',
  module: '#9fe0c0',
};
// Une carte naît de l’orbe : goutte détachée puis étirée en verre, en moins d’une seconde.
const cardBirthMs = 900;

interface RenderInput {
  audio?: { input: number; output: number };
  phase: SessionPhase;
  activity: VoiceActivity | null;
  now: number;
  timestamp: number;
  reducedMotion: boolean;
  presence: PresencePose;
  recognitionKey: string | null;
  webSearchActive: boolean;
}

interface Appearance {
  awake: number;
  /** 1 : aucune conversation ouverte avec OpenAI, l’orbe est grise. */
  offline: number;
  hue: number;
  accent: number;
  energy: number;
  vivid: number;
  listening: number;
  thinking: number;
  speaking: number;
}

interface Palette {
  hue: number;
  accent: number;
  energy: number;
  vivid: number;
}

function appearanceFor({ phase, activity, now, presence, audio }: RenderInput): Appearance {
  const voice =
    audio && phase === 'ready' && (audio.output > 0.035 || audio.input > 0.05)
      ? audio.output > 0.035
        ? 'speaking'
        : 'listening'
      : phase === 'ready' && activity && (activity.endsAt === null || activity.endsAt > now)
        ? activity.phase
        : 'idle';
  const recognized = presence === 'recognized';
  // Repos bleu, écoute turquoise, pensée violette et parole orange.
  const palette: Palette =
    phase === 'connecting'
      ? { hue: 45, accent: 18, energy: 0.72, vivid: 0.9 }
      : phase === 'closing'
        ? { hue: 12, accent: 342, energy: 0.3, vivid: 0.4 }
        : phase === 'blocked'
          ? { hue: 350, accent: 20, energy: 0.22, vivid: 0.3 }
          : phase !== 'ready'
            ? { hue: 218, accent: 245, energy: 0.17, vivid: 0.2 }
            : voice === 'listening'
              ? { hue: 174, accent: 188, energy: 0.96, vivid: 1 }
              : voice === 'thinking'
                ? { hue: 285, accent: 318, energy: 0.82, vivid: 0.85 }
                : voice === 'speaking'
                  ? { hue: 28, accent: 8, energy: 1, vivid: 1 }
                  : recognized
                    ? { hue: 210, accent: 230, energy: 0.42, vivid: 0.42 }
                    : { hue: 218, accent: 245, energy: 0.38, vivid: 0.36 };
  return {
    ...palette,
    awake: Number(presence !== 'sleeping'),
    // En veille, rien ne part vers OpenAI (reconnaissance et mot d’appel restent locaux) : gris.
    offline: Number(phase === 'idle'),
    listening: Number(voice === 'listening'),
    thinking: Number(voice === 'thinking'),
    speaking: Number(voice === 'speaking'),
  };
}

function hueMix(from: number, to: number, amount: number) {
  return from + (((((to - from) % 360) + 540) % 360) - 180) * amount;
}

/** One GPU scene for the deformable orb and card surfaces, without post-processing. */
export function createOrbRenderer(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  const camera = new OrthographicCamera(-256, 256, 256, -256, 0.1, 4000);
  camera.position.z = 1000;
  const uniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uSpeech: { value: 0 },
    uTwist: { value: 0 },
    uFlow: { value: 0 },
    uStretch: { value: new Vector2(1, 1) },
    uColor: { value: new Color() },
    uAccent: { value: new Color() },
    uShimmer: { value: 0 },
    uWebSearch: { value: 0 },
  };
  const geometry = new SphereGeometry(1, 80, 56);
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: orbVertexShader,
    fragmentShader: orbFragmentShader,
    transparent: true,
  });
  const orb = new Mesh(geometry, material);
  scene.add(orb);
  const haloGeometry = new PlaneGeometry(3.2, 3.2);
  const haloMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: haloVertexShader,
    fragmentShader: haloFragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const halo = new Mesh(haloGeometry, haloMaterial);
  halo.position.z = -200;
  halo.renderOrder = -2;
  scene.add(halo);
  const cardGeometry = new PlaneGeometry(1, 1);
  const cards = Array.from({ length: 3 }, (_, index) => {
    const cardUniforms = {
      uTime: uniforms.uTime,
      uColor: uniforms.uColor,
      uSize: { value: new Vector2() },
      uPlaneSize: { value: new Vector2() },
      uLight: { value: new Vector2() },
      uRadius: { value: 32 },
      uOpacity: { value: 1 },
      uTint: { value: new Color(cardTints.luna) },
      uBirth: { value: 1 },
      uVoice: { value: 0 },
      uMotion: { value: 1 },
      uSeed: { value: index * 2.3 },
    };
    const cardMaterial = new ShaderMaterial({
      uniforms: cardUniforms,
      vertexShader: haloVertexShader,
      fragmentShader: cardFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const mesh = new Mesh(cardGeometry, cardMaterial);
    mesh.visible = false;
    mesh.renderOrder = -1;
    scene.add(mesh);
    return mesh;
  });
  const listeningUniforms = {
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uMotion: { value: 1 },
    uSize: { value: new Vector2(180, 40) },
  };
  const listeningMaterial = new ShaderMaterial({
    uniforms: listeningUniforms,
    vertexShader: haloVertexShader,
    fragmentShader: listeningLineFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const listeningLine = new Mesh(cardGeometry, listeningMaterial);
  listeningLine.renderOrder = 1;
  listeningLine.visible = false;
  scene.add(listeningLine);
  let microphoneLevel = 0;
  let speechEnvelope = 0;
  let appearance: Appearance | null = null;
  let previous = 0;
  let deformationTime = 0;
  const presenceMotion = createPresenceMotion();

  return {
    resize(width: number, height: number, ratio: number) {
      // Bound fill-rate on high-DPI and 4K mirrors instead of multiplying every pixel by four.
      renderer.setPixelRatio(Math.min(ratio, 2, Math.sqrt(2_400_000 / (width * height))));
      renderer.setSize(width, height, false);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.updateProjectionMatrix();
    },
    render(input: RenderInput, layout: SceneLayout) {
      const target = appearanceFor(input);
      const motion = presenceMotion({
        pose: input.presence,
        recognitionKey: input.recognitionKey,
        timestamp: input.timestamp,
        reducedMotion: input.reducedMotion,
        voiceActive:
          input.phase === 'ready' &&
          input.activity !== null &&
          input.activity.phase !== 'idle' &&
          (input.activity.endsAt === null || input.activity.endsAt > input.now),
      });
      const delta = Math.max(0, Math.min(64, input.timestamp - previous));
      previous = input.timestamp;
      const blend = input.reducedMotion ? 1 : 1 - Math.exp(-delta / 200);
      if (!appearance) appearance = { ...target, awake: input.reducedMotion ? target.awake : 0 };
      const wakeBlend = input.reducedMotion ? 1 : 1 - Math.exp(-delta / (target.awake ? 260 : 600));
      appearance.awake += (target.awake - appearance.awake) * wakeBlend;
      appearance.hue = hueMix(appearance.hue, target.hue, blend);
      appearance.accent = hueMix(appearance.accent, target.accent, blend);
      for (const key of [
        'energy',
        'vivid',
        'offline',
        'listening',
        'thinking',
        'speaking',
      ] as const) {
        appearance[key] += (target[key] - appearance[key]) * blend;
      }
      const a = appearance;
      const time = input.reducedMotion ? 0 : input.timestamp / 1000;
      const voiceTime = input.reducedMotion
        ? 0.5
        : Math.max(0, input.now - (input.activity?.startedAt ?? input.now)) / 1000;
      const syllable = input.reducedMotion
        ? 0.35
        : Math.pow((Math.sin(voiceTime * 9.2) + 1) / 2, 2) *
          (0.45 + 0.55 * Math.pow(Math.sin(voiceTime * 3.7 + 0.4), 2));
      const speech = input.audio ? input.audio.output : a.speaking * syllable;
      // Envelope follower: the voice drives the colour, but the shape stays smooth.
      speechEnvelope +=
        (speech - speechEnvelope) * (1 - Math.exp(-delta / (speech > speechEnvelope ? 70 : 240)));
      const awakeSize = 0.052 + 0.948 * a.awake;
      const breath = 1 + Math.sin(time) * 0.025 + speechEnvelope * 0.055;
      const unit = layout.orb.size / 3.2;
      const x = layout.orb.x - layout.width / 2;
      const y = layout.height / 2 - layout.orb.y;
      orb.scale.setScalar(awakeSize * breath * unit);
      orb.position.set(
        x + Math.sin(time * 0.39) * 0.05 * a.awake * unit,
        y + (Math.sin(time * 0.65) * 0.065 * a.awake - motion.lift / 155) * unit,
        0,
      );
      // Microphone only: the assistant's output must not animate the listening indicator.
      const listening = input.phase === 'ready';
      const simulatedInput =
        input.activity?.phase === 'listening' &&
        (input.activity.endsAt === null || input.activity.endsAt > input.now)
          ? 0.25 + syllable * 0.5
          : 0;
      const level = listening
        ? Math.max(0, Math.min(1, ((input.audio?.input ?? simulatedInput) - 0.025) * 2.5))
        : 0;
      microphoneLevel = listening
        ? microphoneLevel +
          (level - microphoneLevel) * (1 - Math.exp(-delta / (level > microphoneLevel ? 45 : 150)))
        : 0;
      listeningLine.visible = listening;
      listeningLine.position.set(x, y - unit * 1.25, 1);
      const lineWidth = Math.min(190, layout.orb.size * 0.46);
      listeningLine.scale.set(lineWidth, 40, 1);
      listeningUniforms.uSize.value.set(lineWidth, 40);
      listeningUniforms.uTime.value = time;
      listeningUniforms.uMotion.value = input.reducedMotion ? 0 : 1;
      listeningUniforms.uLevel.value = microphoneLevel;
      halo.position.set(x, y, -200);
      halo.scale.setScalar(awakeSize * unit);
      cards.forEach((mesh, index) => {
        const card = layout.cards[index];
        mesh.visible = !!card;
        if (!card) return;
        mesh.position.set(card.x - layout.width / 2, layout.height / 2 - card.y, -200);
        mesh.scale.set(card.width + 128, card.height + 128, 1);
        const u = mesh.material.uniforms;
        u.uSize!.value.set(card.width, card.height);
        u.uPlaneSize!.value.set(card.width + 128, card.height + 128);
        u.uLight!.value.set(layout.orb.x - card.x, card.y - layout.orb.y);
        u.uRadius!.value = Math.min(card.radius, card.width / 2, card.height / 2);
        u.uOpacity!.value = card.opacity;
        (u.uTint!.value as Color).set(cardTints[card.kind ?? 'luna'] ?? cardTints.luna!);
        u.uBirth!.value =
          input.reducedMotion || card.born === undefined
            ? 1
            : Math.min(1, Math.max(0, (input.timestamp - card.born) / cardBirthMs));
        // La carte principale respire avec la voix de Cornelius, les autres à peine.
        u.uVoice!.value = speechEnvelope * (index === 0 ? 1 : 0.35);
        u.uMotion!.value = input.reducedMotion ? 0 : 1;
      });
      deformationTime += (delta / 1000) * (0.8 + a.thinking * 0.5);
      const pulse =
        input.reducedMotion || input.phase !== 'connecting'
          ? 0
          : 0.12 + 0.07 * Math.sin(time * 3.4);
      const shimmer =
        a.speaking * (0.35 + 0.5 * Math.min(1, speechEnvelope * 1.6)) +
        (input.phase === 'connecting' && !input.reducedMotion
          ? 0.16 * (0.5 + 0.5 * Math.sin(time * 3.4))
          : 0);
      uniforms.uTime.value = input.reducedMotion ? 0 : deformationTime;
      uniforms.uEnergy.value = Math.min(1, a.energy + pulse);
      uniforms.uSpeech.value =
        speechEnvelope + a.listening * (0.5 + 0.5 * Math.sin(voiceTime * 2.8)) * 0.15;
      uniforms.uShimmer.value = input.reducedMotion ? 0 : Math.min(1, shimmer);
      uniforms.uWebSearch.value = input.webSearchActive
        ? input.reducedMotion
          ? 1
          : 0.88 + 0.12 * Math.sin(time * 4.5)
        : 0;
      uniforms.uTwist.value = motion.twist;
      uniforms.uFlow.value = motion.flow;
      uniforms.uStretch.value.set(motion.stretchX, motion.stretchY);
      const saturation = (0.36 + a.vivid * 0.59) * (1 - 0.92 * a.offline);
      const lightness = 0.36 + a.vivid * 0.18 - 0.04 * a.offline;
      uniforms.uColor.value.setHSL((((a.hue % 360) + 360) % 360) / 360, saturation, lightness);
      uniforms.uAccent.value.setHSL(
        (((a.accent % 360) + 360) % 360) / 360,
        saturation * 0.92,
        Math.min(0.72, lightness + 0.04),
      );
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      cardGeometry.dispose();
      listeningMaterial.dispose();
      for (const mesh of cards) mesh.material.dispose();
      renderer.dispose();
    },
  };
}
