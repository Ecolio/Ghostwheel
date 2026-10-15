/** Résolution et cadence de la caméra, appliquées par la perception. */
export interface CameraMode {
  width: number;
  height: number;
  fps: number;
}

export const CAMERA_RESOLUTIONS = [
  {
    width: 640,
    height: 480,
    label: '640 x 480',
    hint: 'La plus légère : pour un processeur modeste. Visages reconnus jusqu’à 1,5 m environ.',
  },
  {
    width: 1280,
    height: 720,
    label: '1280 x 720 (HD)',
    hint: 'Recommandée : visages reconnus plus loin et vision plus précise, pour un coût raisonnable.',
  },
  {
    width: 1920,
    height: 1080,
    label: '1920 x 1080 (Full HD)',
    hint: 'La plus détaillée, mais la détection des visages travaille plus : pour un processeur puissant.',
  },
] as const;

export const CAMERA_FRAME_RATES = [
  { fps: 15, label: '15 images par seconde', hint: 'Image plus lumineuse dans une pièce sombre.' },
  {
    fps: 30,
    label: '30 images par seconde',
    hint: 'Recommandée : image la plus récente et la plus nette en mouvement.',
  },
] as const;

export const DEFAULT_CAMERA_MODE: CameraMode = { width: 1280, height: 720, fps: 30 };

export function isCameraMode(value: unknown): value is CameraMode {
  if (!value || typeof value !== 'object') return false;
  const mode = value as Record<string, unknown>;
  return (
    CAMERA_RESOLUTIONS.some(
      (resolution) => resolution.width === mode.width && resolution.height === mode.height,
    ) && CAMERA_FRAME_RATES.some((rate) => rate.fps === mode.fps)
  );
}
