/** Accueil parlé à l’ouverture d’une conversation avec une personne reconnue. */
export const GREETING_MODES = ['name', 'free', 'off'] as const;
export type GreetingMode = (typeof GREETING_MODES)[number];
/** « Bonjour Prénom. » : le comportement historique reste celui par défaut. */
export const DEFAULT_GREETING_MODE: GreetingMode = 'name';

export function isGreetingMode(value: unknown): value is GreetingMode {
  return GREETING_MODES.some((mode) => mode === value);
}

/** Fermeture après un silence dans les modes caméra, même si la personne reste devant le miroir. */
export interface SilenceClose {
  enabled: boolean;
  delayMs: number;
}
export const SILENCE_CLOSE_MIN_MS = 3_000;
export const SILENCE_CLOSE_MAX_MS = 300_000;
/** Désactivée par défaut : la conversation suit la présence et le regard, comme avant. */
export const DEFAULT_SILENCE_CLOSE: Readonly<SilenceClose> = { enabled: false, delayMs: 20_000 };

export function isSilenceClose(value: unknown): value is SilenceClose {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (
    Object.keys(settings).length === 2 &&
    typeof settings.enabled === 'boolean' &&
    typeof settings.delayMs === 'number' &&
    Number.isInteger(settings.delayMs) &&
    settings.delayMs >= SILENCE_CLOSE_MIN_MS &&
    settings.delayMs <= SILENCE_CLOSE_MAX_MS
  );
}
