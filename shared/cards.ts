/** Réglages des cartes du miroir (module « Cartes »). */
export interface CardSettings {
  /** Cartes affichées en même temps : la principale et les complémentaires. */
  maxCards: number;
  /** Les cartes passées au second plan se raccourcissent (titre, valeur, deux lignes). */
  compactSecondary: boolean;
  /** Durée d’affichage d’une carte, en millisecondes. */
  lifetimeMs: number;
}

export const CARD_COUNT_MIN = 1;
export const CARD_COUNT_MAX = 4;
export const CARD_LIFETIME_MIN_MS = 15_000;
export const CARD_LIFETIME_MAX_MS = 600_000;
export const CARD_LIFETIME_PRESETS_MS = [30_000, 60_000, 120_000, 300_000] as const;

export const DEFAULT_CARD_SETTINGS: CardSettings = {
  maxCards: 3,
  compactSecondary: true,
  lifetimeMs: 60_000,
};

export function isCardSettings(value: unknown): value is CardSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Record<string, unknown>;
  return (
    Object.keys(settings).every((key) =>
      ['maxCards', 'compactSecondary', 'lifetimeMs'].includes(key),
    ) &&
    Number.isInteger(settings.maxCards) &&
    (settings.maxCards as number) >= CARD_COUNT_MIN &&
    (settings.maxCards as number) <= CARD_COUNT_MAX &&
    typeof settings.compactSecondary === 'boolean' &&
    Number.isInteger(settings.lifetimeMs) &&
    (settings.lifetimeMs as number) >= CARD_LIFETIME_MIN_MS &&
    (settings.lifetimeMs as number) <= CARD_LIFETIME_MAX_MS
  );
}
