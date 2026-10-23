import { DEFAULT_SCREENSAVER } from '../../shared/screensaver';
import type { MirrorState, SessionPhase } from '../../shared/types';

/**
 * Vrai quand l’orbe doit revenir devant l’écran de veille.
 *
 * - « presence » : dès qu’une personne passe devant le miroir.
 * - « opening » : au moment où Cornelius s’éveillerait, selon ce qui ouvre la conversation —
 *   la présence, le regard vers le miroir, ou le mot « Cornelius » (la conversation qui s’ouvre).
 *   Réservée aux membres du foyer, l’ouverture ne compte que les personnes reconnues. Le
 *   regard ou la présence suffisent même quand la conversation ne peut pas s’ouvrir (clé
 *   absente, OpenAI bloqué) : la personne voit alors la ligne d’état.
 *
 * Une conversation ouverte (ou en cours d’ouverture) réveille toujours l’orbe.
 */
export function screensaverWoken(state: MirrorState, phase: SessionPhase): boolean {
  if (phase !== 'idle') return true;
  const presence = state.presence;
  if (presence.health !== 'ok') return false;
  if ((state.screensaver?.wake ?? DEFAULT_SCREENSAVER.wake) === 'presence')
    return presence.state !== 'absent';
  const opening = state.opening;
  if (!opening || opening.trigger === 'voice') return false;
  const people = presence.people.filter(
    (person) => opening.audience === 'everyone' || person.profileId !== null,
  );
  return opening.trigger === 'presence'
    ? people.length > 0
    : people.some((person) => person.engaged);
}
