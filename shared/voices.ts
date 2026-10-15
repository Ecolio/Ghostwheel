/**
 * Voix intégrées de GPT-Live (liste du SDK OpenAI, type BuiltInVoice). La voix se choisit
 * avant l’ouverture d’une conversation : un changement compte à la suivante.
 */
export const LIVE_VOICES = [
  'cedar',
  'marin',
  'alloy',
  'ash',
  'ballad',
  'beacon',
  'bossa',
  'cinder',
  'coral',
  'delta',
  'echo',
  'gleam',
  'meridian',
  'quartz',
  'ripple',
  'sage',
  'shimmer',
  'stone',
  'tempo',
  'verse',
  'vesper',
  'willow',
] as const;
export type LiveVoice = (typeof LIVE_VOICES)[number];

export const DEFAULT_LIVE_VOICE: LiveVoice = 'cedar';

/** Voix sans accent étranger marqué en français, d’après les retours de développeurs. */
export const FRENCH_VOICES: readonly LiveVoice[] = ['cedar', 'marin'];

export function isLiveVoice(value: unknown): value is LiveVoice {
  return typeof value === 'string' && (LIVE_VOICES as readonly string[]).includes(value);
}

/** Nom affiché : « Cedar ». */
export function voiceLabel(voice: LiveVoice): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}
