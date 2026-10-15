export interface AudioPreferences {
  microphone: string;
  speaker: string;
}
const key = 'cornelius.audio';
export function audioPreferences(): AudioPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return {
      microphone: typeof value.microphone === 'string' ? value.microphone : '',
      speaker: typeof value.speaker === 'string' ? value.speaker : '',
    };
  } catch {
    return { microphone: '', speaker: '' };
  }
}
export function saveAudioPreferences(value: AudioPreferences) {
  localStorage.setItem(key, JSON.stringify(value));
}
