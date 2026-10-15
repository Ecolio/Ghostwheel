/** Son local joué par le miroir quand une conversation s’ouvre (admission par le serveur). */
export const ADMISSION_SOUNDS = [
  'carillon',
  'goutte',
  'cristal',
  'bulle',
  'cloche',
  'souffle',
] as const;
export type AdmissionSoundId = (typeof ADMISSION_SOUNDS)[number];

export interface AdmissionSound {
  enabled: boolean;
  sound: AdmissionSoundId;
}

export const DEFAULT_ADMISSION_SOUND: Readonly<AdmissionSound> = {
  enabled: false,
  sound: 'carillon',
};

export const ADMISSION_SOUND_LABELS: Readonly<
  Record<AdmissionSoundId, { label: string; detail: string }>
> = {
  carillon: { label: 'Carillon', detail: 'Deux notes montantes, claires et douces.' },
  goutte: { label: 'Goutte', detail: 'Une goutte d’eau brève, très discrète.' },
  cristal: { label: 'Cristal', detail: 'Trois notes aiguës en arpège.' },
  bulle: { label: 'Bulle', detail: 'Deux bulles qui remontent, ludique.' },
  cloche: { label: 'Cloche', detail: 'Un tintement de cloche qui résonne.' },
  souffle: { label: 'Souffle', detail: 'Un souffle feutré et une note grave.' },
};

export function isAdmissionSoundId(value: unknown): value is AdmissionSoundId {
  return typeof value === 'string' && (ADMISSION_SOUNDS as readonly string[]).includes(value);
}

export function isAdmissionSound(value: unknown): value is AdmissionSound {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (
    Object.keys(settings).length === 2 &&
    typeof settings.enabled === 'boolean' &&
    isAdmissionSoundId(settings.sound)
  );
}
