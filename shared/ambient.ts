import type { MirrorState } from './types.js';

/** undefined : ne rien afficher ; null : sources du foyer uniquement. */
export function ambientProfile(state: MirrorState): string | null | undefined {
  if (
    !state.browserConnected ||
    state.presence.health !== 'ok' ||
    state.presence.state === 'absent' ||
    state.presence.peopleCount === 0 ||
    (state.privacyMode && state.presence.peopleCount > 1)
  )
    return undefined;
  const profileId = state.activeProfile?.id;
  return profileId && state.presence.people.some((person) => person.profileId === profileId)
    ? profileId
    : null;
}
