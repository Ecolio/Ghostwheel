export const PERSONALITY_MAX_LENGTH = 4000;
export const PERSONAL_CONTEXT_MAX_LENGTH = 4000;
export interface PersonalityPreferences {
  household: string;
  personal: string;
  /** Repères personnels explicitement configurés, propres au profil actif. */
  personalContext?: string;
}
export interface PersonalityView extends PersonalityPreferences {
  personalContext: string;
  profileId: string | null;
  prompts: { title: string; content: string }[];
}
