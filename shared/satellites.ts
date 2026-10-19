/** Un satellite audio tel que l’administration le voit (jamais son jeton). */
export interface SatelliteView {
  id: string;
  name: string;
  /** Profil rattaché (mémoire personnelle) ; null : satellite anonyme, le cas par défaut. */
  profileId: string | null;
  volume: number;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
  firmware: string | null;
  muted: boolean;
}

export const SATELLITE_NAME_MAX = 40;
