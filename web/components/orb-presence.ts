export type PresencePose = 'sleeping' | 'aware' | 'recognized';

export interface PresenceMotionInput {
  pose: PresencePose;
  recognitionKey: string | null;
  timestamp: number;
  reducedMotion: boolean;
  voiceActive: boolean;
}

/** One greeting per recognition, independent of the repeating server snapshots. */
const GREETING_DELAY_MS = 240;
const GREETING_MS = 1_100;

export function createPresenceMotion() {
  let previousPose: PresencePose = 'sleeping';
  let previousKey: string | null = null;
  let greetingAt: number | null = null;

  return ({ pose, recognitionKey, timestamp, reducedMotion, voiceActive }: PresenceMotionInput) => {
    const key = pose === 'recognized' ? recognitionKey : null;
    if (key && key !== previousKey) {
      // Let the sleeping dot unfold before greeting a familiar face.
      greetingAt = timestamp + (previousPose === 'sleeping' ? GREETING_DELAY_MS : 0);
    }
    if (!key || reducedMotion || voiceActive) greetingAt = null;
    previousPose = pose;
    previousKey = key;

    const u = greetingAt === null ? -1 : (timestamp - greetingAt) / GREETING_MS;
    const result = { lift: 0, twist: 0, flow: 0, stretchX: 1, stretchY: 1, greeting: false };
    if (u < 0 || u >= 1) {
      if (u >= 1) greetingAt = null;
      return result;
    }
    result.greeting = true;
    if (u < 0.14) {
      const crouch = Math.sin((u / 0.14) * Math.PI);
      result.stretchX += crouch * 0.18;
      result.stretchY -= crouch * 0.15;
      result.lift = crouch * 8;
    } else if (u < 0.68) {
      const flight = (u - 0.14) / 0.54;
      result.lift = -Math.sin(flight * Math.PI) * 42;
      result.twist = Math.sin(Math.PI * flight) ** 2;
      result.flow = Math.PI * 2 * flight;
      result.stretchX -= Math.sin(flight * Math.PI * 2) * 0.1;
      result.stretchY += Math.sin(flight * Math.PI * 2) * 0.12;
    } else {
      const landing = (u - 0.68) / 0.32;
      const wobble = Math.sin(landing * Math.PI * 3) * (1 - landing);
      result.stretchX += wobble * 0.19;
      result.stretchY -= wobble * 0.16;
      result.lift = wobble * 8;
      result.twist = Math.sin(landing * Math.PI * 2) * (1 - landing) * 0.2;
    }
    return result;
  };
}
