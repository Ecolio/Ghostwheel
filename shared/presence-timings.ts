export interface PresenceTimings {
  presenceMs: number;
  absenceMs: number;
  engagementMs: number;
  disengagementMs: number;
  /** Durée d’une identité confirmée sans nouvelle preuve, tant que le même visage est suivi. */
  identityHoldMs: number;
}

export const DEFAULT_PRESENCE_TIMINGS: Readonly<PresenceTimings> = {
  presenceMs: 400,
  absenceMs: 1500,
  engagementMs: 350,
  disengagementMs: 8000,
  identityHoldMs: 8000,
};

export const PRESENCE_TIMING_MAX: Readonly<PresenceTimings> = {
  presenceMs: 5000,
  absenceMs: 30000,
  engagementMs: 5000,
  disengagementMs: 60000,
  identityHoldMs: 60000,
};

export const PRESENCE_TIMING_MIN: Readonly<PresenceTimings> = {
  presenceMs: 0,
  absenceMs: 0,
  engagementMs: 0,
  disengagementMs: 0,
  identityHoldMs: 0,
};

export function isPresenceTimings(value: unknown): value is PresenceTimings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_PRESENCE_TIMINGS) as (keyof PresenceTimings)[];
  return (
    Object.keys(settings).length === keys.length &&
    keys.every((key) => {
      const duration = settings[key];
      return (
        typeof duration === 'number' &&
        Number.isInteger(duration) &&
        duration >= PRESENCE_TIMING_MIN[key] &&
        duration <= PRESENCE_TIMING_MAX[key]
      );
    })
  );
}
