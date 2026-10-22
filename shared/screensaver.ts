/**
 * Écran de veille du miroir : des peintures et des photos, plein écran, quand personne n’est
 * devant lui. Une personne détectée fait revenir l’orbe.
 */
export interface ScreensaverSettings {
  enabled: boolean;
  /** Durée d’affichage de chaque image avant la suivante. */
  intervalMs: number;
  /** Délai sans personne devant le miroir avant le retour des images. */
  returnDelayMs: number;
}

export const SCREENSAVER_INTERVAL_MIN_MS = 10_000;
export const SCREENSAVER_INTERVAL_MAX_MS = 86_400_000;
export const SCREENSAVER_RETURN_DELAY_MAX_MS = 3_600_000;

export const DEFAULT_SCREENSAVER: ScreensaverSettings = {
  enabled: false,
  intervalMs: 300_000,
  returnDelayMs: 30_000,
};

/** Durées proposées d’un geste dans l’administration. */
export const SCREENSAVER_INTERVALS_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000];
export const SCREENSAVER_RETURN_DELAYS_MS = [5_000, 30_000, 60_000, 300_000];

export function isScreensaverSettings(value: unknown): value is ScreensaverSettings {
  if (!value || typeof value !== 'object') return false;
  const { enabled, intervalMs, returnDelayMs, ...rest } = value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    typeof enabled === 'boolean' &&
    Number.isInteger(intervalMs) &&
    (intervalMs as number) >= SCREENSAVER_INTERVAL_MIN_MS &&
    (intervalMs as number) <= SCREENSAVER_INTERVAL_MAX_MS &&
    Number.isInteger(returnDelayMs) &&
    (returnDelayMs as number) >= 0 &&
    (returnDelayMs as number) <= SCREENSAVER_RETURN_DELAY_MAX_MS
  );
}

/** Ce que le miroir reçoit dans son état : les réglages, et de quoi relire la liste d’images. */
export interface ScreensaverState extends ScreensaverSettings {
  imageCount: number;
  /** Change dès qu’une image est ajoutée ou retirée. */
  revision: string;
}

export interface ScreensaverImage {
  id: string;
  url: string;
  /** Titre de l’œuvre, ou nom du fichier envoyé. */
  title: string;
  /** Artiste et date pour une peinture de la collection ; vide pour une photo envoyée. */
  credit: string;
  origin: 'upload' | 'collection';
}

export interface ScreensaverCollectionStatus {
  total: number;
  installed: number;
  downloading: boolean;
  error: string | null;
}

export interface ScreensaverView {
  images: ScreensaverImage[];
  collection: ScreensaverCollectionStatus;
}

/** Formats acceptés à l’envoi, reconnus à leurs premiers octets. */
export const SCREENSAVER_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ScreensaverImageType = (typeof SCREENSAVER_IMAGE_TYPES)[number];
export const SCREENSAVER_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
