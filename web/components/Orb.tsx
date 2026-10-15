import { memo, useEffect, useRef, useState } from 'react';
import type { SessionPhase, VoiceActivity } from '../../shared/types';
import { createOrbRenderer, ORB_SIZE, type SceneLayout } from './orb-renderer';
import type { PresencePose } from './orb-presence';

interface OrbProps {
  phase: SessionPhase;
  activity?: VoiceActivity | null;
  now: number;
  presence?: PresencePose;
  recognitionKey?: string | null;
  webSearchActive?: boolean;
  fullscreen?: boolean;
  readAudio?: () => { input: number; output: number };
}

export const Orb = memo(function Orb({
  phase,
  activity = null,
  now,
  presence = 'sleeping',
  recognitionKey = null,
  webSearchActive = false,
  fullscreen = false,
  readAudio,
}: OrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendererState, setRendererState] = useState<'loading' | 'three' | 'fallback'>('loading');
  const [webSearchHeld, setWebSearchHeld] = useState(webSearchActive);
  const showWebSearchRim = phase === 'ready' && (webSearchActive || webSearchHeld);
  useEffect(() => {
    if (phase !== 'ready') {
      setWebSearchHeld(false);
      return;
    }
    if (webSearchActive) {
      setWebSearchHeld(true);
      return;
    }
    const timeout = setTimeout(() => setWebSearchHeld(false), 2_000);
    return () => clearTimeout(timeout);
  }, [phase, webSearchActive]);
  const current = useRef({
    phase,
    activity,
    now,
    presence,
    recognitionKey,
    webSearchActive: showWebSearchRim,
    readAudio,
    receivedAt: performance.now(),
  });
  const receivedAt = current.current.now === now ? current.current.receivedAt : performance.now();
  current.current = {
    phase,
    activity,
    now,
    presence,
    recognitionKey,
    webSearchActive: showWebSearchRim,
    readAudio,
    receivedAt,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: ReturnType<typeof createOrbRenderer>;
    try {
      scene = createOrbRenderer(canvas);
      setRendererState('three');
    } catch {
      setRendererState('fallback');
      return;
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const root = fullscreen ? canvas.closest('.mirror-page') : null;
    // Première apparition de chaque carte : sa naissance depuis l’orbe part de cet instant.
    const births = new WeakMap<Element, number>();
    let frame = 0;
    let last = -Infinity;
    let width = 0;
    let height = 0;
    let ratio = 0;
    let contextLost = false;

    const layout = (): SceneLayout => {
      const bounds = canvas.getBoundingClientRect();
      const anchor = root?.querySelector('.mirror-orb-anchor')?.getBoundingClientRect() ?? bounds;
      return {
        width: bounds.width || ORB_SIZE,
        height: bounds.height || ORB_SIZE,
        orb: {
          x: anchor.left - bounds.left + anchor.width / 2,
          y: anchor.top - bounds.top + anchor.height / 2,
          size: anchor.width || ORB_SIZE,
        },
        cards: Array.from(root?.querySelectorAll<HTMLElement>('.display-card') ?? [])
          .slice(0, 3)
          .map((card) => {
            const rect = card.getBoundingClientRect();
            const slot = card.closest('.mirror-card-slot') ?? card;
            let born = births.get(card);
            if (born === undefined) {
              born = performance.now();
              births.set(card, born);
            }
            return {
              x: rect.left - bounds.left + rect.width / 2,
              y: rect.top - bounds.top + rect.height / 2,
              width: rect.width,
              height: rect.height,
              radius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
              opacity: Number(getComputedStyle(slot).opacity),
              kind: card.dataset.kind ?? 'luna',
              born,
            };
          }),
      };
    };
    const draw = (timestamp: number) => {
      if (document.hidden || contextLost) return;
      frame = requestAnimationFrame(draw);
      const interval = motion.matches ? 250 : 1000 / 30;
      if (timestamp - last < interval - 0.5) return;
      last = Number.isFinite(last)
        ? timestamp - Math.max(0, (timestamp - last) % interval)
        : timestamp;
      const viewport = layout();
      if (width !== viewport.width || height !== viewport.height || ratio !== devicePixelRatio) {
        width = viewport.width;
        height = viewport.height;
        ratio = devicePixelRatio;
        scene.resize(width, height, ratio);
      }
      const props = current.current;
      scene.render(
        {
          ...props,
          audio: props.readAudio?.(),
          now: props.now + Math.max(0, timestamp - props.receivedAt),
          timestamp,
          reducedMotion: motion.matches,
        },
        viewport,
      );
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !contextLost) {
        last = -Infinity;
        frame = requestAnimationFrame(draw);
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      cancelAnimationFrame(frame);
      setRendererState('fallback');
    };
    const restored = () => {
      contextLost = false;
      setRendererState('three');
      resume();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    document.addEventListener('visibilitychange', resume);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      scene.dispose();
    };
  }, [fullscreen]);

  const voicePhase =
    phase === 'ready' && activity && (!activity.endsAt || activity.endsAt > now)
      ? activity.phase
      : 'idle';

  return (
    <div
      className={`orb${fullscreen ? ' orb-fullscreen' : ''}`}
      data-renderer={rendererState}
      data-phase={phase}
      data-voice-phase={voicePhase}
      data-presence={presence}
      data-web-search={showWebSearchRim ? 'active' : 'idle'}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
      {rendererState === 'fallback' && <span className="orb-fallback" />}
    </div>
  );
});
