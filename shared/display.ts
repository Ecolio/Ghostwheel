/** Taille de l’orbe sur le miroir, en pourcentage de sa taille d’origine. */
export const ORB_SCALE_MIN = 50;
export const ORB_SCALE_MAX = 150;
export const ORB_SCALE_DEFAULT = 100;

export function isOrbScale(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= ORB_SCALE_MIN &&
    value <= ORB_SCALE_MAX
  );
}
