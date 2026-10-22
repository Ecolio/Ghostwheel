import { useEffect, useRef, useState } from 'react';
import type { ScreensaverImage } from '../../shared/screensaver';
import { api } from '../api';
import {
  createScreensaverRenderer,
  type ScreensaverFrame,
  type ScreensaverSlot,
} from './screensaver-renderer';

/**
 * off : rien n’est affiché. entering : la peinture sort de l’orbe endormie. on : la peinture
 * occupe l’écran. leaving : l’orbe s’éveille devant elle et l’aspire.
 */
export type ScreensaverScene = 'off' | 'entering' | 'on' | 'leaving';

type Values = Pick<ScreensaverFrame, 'collapse' | 'gray' | 'veil' | 'mix'>;
type Ease = (t: number) => number;
interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: Ease;
}

const easeIn: Ease = (t) => t * t * t;
const easeOut: Ease = (t) => 1 - (1 - t) ** 3;
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const CROSSFADE_MS = 2_400;
/** Plus grand côté envoyé à la carte graphique : au-delà, l’image est réduite au chargement. */
const MAX_SIDE = 2_560;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

async function loadBitmap(image: ScreensaverImage): Promise<ImageBitmap> {
  const response = await fetch(image.url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Image ${image.id} : ${response.status}`);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const ratio = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (ratio >= 1) return bitmap;
  bitmap.close();
  return createImageBitmap(blob, {
    resizeWidth: Math.round(bitmap.width * ratio),
    resizeHeight: Math.round(bitmap.height * ratio),
    resizeQuality: 'high',
  });
}

/** Peintures et photos plein écran, derrière l’orbe, quand personne n’est devant le miroir. */
export function Screensaver({
  active,
  revision,
  intervalMs,
  onSceneChange,
}: {
  active: boolean;
  revision: string;
  intervalMs: number;
  onSceneChange: (scene: ScreensaverScene) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scene, setScene] = useState<ScreensaverScene>('off');
  const [caption, setCaption] = useState<ScreensaverImage | null>(null);
  const [fallback, setFallback] = useState<{ current: string; next: string | null } | null>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const engine = useRef<{
    wake: (active: boolean) => void;
    setImages: (images: ScreensaverImage[]) => void;
    setInterval: (ms: number) => void;
  } | null>(null);
  const sceneChanged = useRef(onSceneChange);
  sceneChanged.current = onSceneChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: ReturnType<typeof createScreensaverRenderer> | null = null;
    try {
      renderer = createScreensaverRenderer(canvas);
    } catch {
      // Sans WebGL : la même chorégraphie, jouée par CSS sur deux images.
      renderer = null;
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const values: Values = { collapse: 1, gray: 1, veil: 1, mix: 0 };
    const tweens = new Map<keyof Values, Tween>();
    let current: ScreensaverImage | null = null;
    let next: ScreensaverImage | null = null;
    let images: ScreensaverImage[] = [];
    let bag: ScreensaverImage[] = [];
    let stage: ScreensaverScene = 'off';
    let wanted = false;
    let interval = intervalMs;
    let slideshow: ReturnType<typeof setTimeout> | null = null;
    let loading = false;
    let frame = 0;
    let disposed = false;
    let size = { width: 0, height: 0, ratio: 0 };

    const changeStage = (value: ScreensaverScene) => {
      if (stage === value) return;
      stage = value;
      setScene(value);
      sceneChanged.current(value);
    };
    const animate = (
      key: keyof Values,
      to: number,
      duration: number,
      delay = 0,
      ease = easeOut,
    ) => {
      const now = performance.now();
      if (duration <= 0 && delay <= 0) {
        values[key] = to;
        tweens.delete(key);
        return;
      }
      tweens.set(key, { from: values[key], to, start: now + delay, duration, ease });
    };
    const center = () => {
      const bounds = canvas.getBoundingClientRect();
      const anchor = canvas
        .closest('.mirror-page')
        ?.querySelector('.mirror-orb-anchor')
        ?.getBoundingClientRect();
      return anchor
        ? {
            x: anchor.left - bounds.left + anchor.width / 2,
            y: anchor.top - bounds.top + anchor.height / 2,
          }
        : { x: bounds.width / 2, y: bounds.height / 2 };
    };
    const paint = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width || innerWidth;
      const height = bounds.height || innerHeight;
      const middle = center();
      if (renderer) {
        if (size.width !== width || size.height !== height || size.ratio !== devicePixelRatio) {
          size = { width, height, ratio: devicePixelRatio };
          renderer.resize(width, height, devicePixelRatio);
        }
        renderer.render({ width, height, center: middle, ...values });
        return;
      }
      const layer = fallbackRef.current;
      if (!layer) return;
      layer.style.transformOrigin = `${middle.x}px ${middle.y}px`;
      layer.style.transform = `rotate(${-values.collapse * 220}deg) scale(${Math.max(0, 1 - values.collapse)})`;
      layer.style.filter = `grayscale(${values.gray}) brightness(${1 - 0.3 * values.collapse})`;
      layer.style.opacity = String(values.veil);
      layer.style.setProperty('--screensaver-mix', String(values.mix));
    };
    /** Fin d’un mouvement : ce que la scène devient ensuite. */
    const settle = () => {
      if (stage === 'entering' && wanted) {
        changeStage('on');
        schedule();
      } else if (stage === 'leaving' && !wanted) {
        changeStage('off');
        setCaption(null);
      }
      if (values.mix >= 1 && next) {
        renderer?.promote();
        current = next;
        next = null;
        values.mix = 0;
        setFallback((shown) => (shown?.next ? { current: shown.next, next: null } : shown));
        setCaption(current);
        paint();
      }
    };
    const tick = (timestamp: number) => {
      frame = 0;
      if (disposed) return;
      for (const [key, tween] of tweens) {
        const t = Math.min(1, Math.max(0, (timestamp - tween.start) / tween.duration));
        values[key] = tween.from + (tween.to - tween.from) * tween.ease(t);
        if (t >= 1) tweens.delete(key);
      }
      paint();
      if (tweens.size > 0) frame = requestAnimationFrame(tick);
      else settle();
    };
    const run = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(tick);
    };

    const pick = (): ScreensaverImage | null => {
      if (images.length === 0) return null;
      if (bag.length === 0) bag = shuffle(images).filter((image) => image.id !== current?.id);
      return bag.shift() ?? images[0] ?? null;
    };
    const load = async (slot: ScreensaverSlot): Promise<ScreensaverImage | null> => {
      // Une image illisible est sautée ; au plus un tour complet de la liste.
      for (let attempt = 0; attempt < Math.max(1, images.length); attempt++) {
        const image = pick();
        if (!image) return null;
        try {
          if (renderer) {
            const bitmap = await loadBitmap(image);
            // L’image reste ouverte jusqu’à son envoi à la carte graphique ; le moteur la ferme.
            if (disposed) {
              bitmap.close();
              return null;
            }
            renderer.set(slot, bitmap);
          } else {
            await new Promise<void>((resolve, reject) => {
              const probe = new Image();
              probe.onload = () => resolve();
              probe.onerror = () => reject(new Error(image.url));
              probe.src = image.url;
            });
            setFallback((shown) =>
              slot === 'current'
                ? { current: image.url, next: null }
                : { current: shown?.current ?? image.url, next: image.url },
            );
          }
          return image;
        } catch {
          images = images.filter((candidate) => candidate.id !== image.id);
        }
      }
      return null;
    };
    const schedule = () => {
      if (slideshow) clearTimeout(slideshow);
      slideshow = null;
      if (stage !== 'on' || images.length < 2) return;
      slideshow = setTimeout(() => void advance(), interval);
    };
    const advance = async () => {
      if (loading || stage !== 'on') return schedule();
      loading = true;
      const image = await load('next').finally(() => (loading = false));
      if (!image || disposed) return schedule();
      next = image;
      values.mix = 0;
      animate('mix', 1, motion.matches ? 800 : CROSSFADE_MS, 0, easeInOut);
      run();
      schedule();
    };

    const enter = async () => {
      if (stage === 'off') {
        if (loading) return;
        loading = true;
        const image = await load('current').finally(() => (loading = false));
        if (!image || disposed || !wanted) return;
        current = image;
        next = null;
        // Départ : la toile repliée dans l’orbe endormie, grise.
        Object.assign(
          values,
          motion.matches
            ? { collapse: 0, gray: 0, veil: 0, mix: 0 }
            : { collapse: 1, gray: 1, veil: 1, mix: 0 },
        );
        setCaption(image);
      }
      changeStage('entering');
      if (motion.matches) {
        animate('collapse', 0, 0);
        animate('gray', 0, 0);
        animate('veil', 1, 900);
      } else {
        animate('veil', 1, 300);
        animate('collapse', 0, 1_900, 0, easeOut);
        animate('gray', 0, 1_500, 1_100, easeInOut);
      }
      run();
    };
    const leave = () => {
      if (slideshow) clearTimeout(slideshow);
      slideshow = null;
      changeStage('leaving');
      if (motion.matches) {
        animate('gray', 1, 300);
        animate('veil', 0, 700);
      } else {
        // La toile se grise d’abord, puis l’orbe l’aspire en accélérant.
        animate('gray', 1, 550, 0, easeOut);
        animate('collapse', 1, 1_700, 250, easeIn);
      }
      run();
    };

    engine.current = {
      wake(active) {
        wanted = active;
        if (active && (stage === 'off' || stage === 'leaving')) void enter();
        else if (!active && (stage === 'entering' || stage === 'on')) leave();
      },
      setImages(list) {
        images = list;
        bag = bag.filter((image) => list.some((candidate) => candidate.id === image.id));
        // L’image affichée a été retirée : passer à la suivante sans attendre.
        if (stage === 'on' && current && !list.some((image) => image.id === current!.id))
          void advance();
        else schedule();
        if (wanted && stage === 'off') void enter();
      },
      setInterval(ms) {
        interval = ms;
        schedule();
      },
    };
    const resized = () => {
      if (stage !== 'off') paint();
    };
    addEventListener('resize', resized);
    return () => {
      disposed = true;
      engine.current = null;
      removeEventListener('resize', resized);
      cancelAnimationFrame(frame);
      if (slideshow) clearTimeout(slideshow);
      renderer?.dispose();
    };
    // intervalMs n’est lu qu’au départ ; setInterval suit ses changements.
  }, []);

  useEffect(() => {
    if (!revision) return void engine.current?.setImages([]);
    let cancelled = false;
    void api
      .screensaverImages()
      .then(({ images }) => !cancelled && engine.current?.setImages(images))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);
  useEffect(() => engine.current?.setInterval(intervalMs), [intervalMs]);
  useEffect(() => engine.current?.wake(active), [active]);

  return (
    <div className="mirror-screensaver" data-scene={scene} aria-hidden="true">
      <canvas ref={canvasRef} hidden={fallback !== null} />
      {fallback && (
        <div ref={fallbackRef} className="mirror-screensaver-fallback">
          <img src={fallback.current} alt="" />
          {fallback.next && <img className="is-next" src={fallback.next} alt="" />}
        </div>
      )}
      {caption?.credit && (
        <p className="mirror-screensaver-caption" key={caption.id}>
          <span>{caption.title}</span>
          {caption.credit}
        </p>
      )}
    </div>
  );
}
