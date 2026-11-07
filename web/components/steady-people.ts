import type { MirrorState } from '../../shared/types';

export type PresencePerson = MirrorState['presence']['people'][number];

/** Garde d’une personne après sa disparition : une détection manquée ne la retire pas. */
export const PERSON_HOLD_MS = 3_000;
/**
 * Une personne inconnue ne s’affiche qu’après 1,5 s de présence : un visage mal vu ou pris un
 * instant pour un inconnu ne fait pas clignoter le bas du miroir.
 */
export const UNKNOWN_DELAY_MS = 1_500;

/** `goneAt` vaut null tant que la personne est dans la dernière observation. */
export interface PeopleMemory {
  /** Personnes reconnues, par profil. */
  known: Map<string, { person: PresencePerson; goneAt: number | null }>;
  /** Inconnus : un épisode continue tant que leurs absences restent plus courtes que la garde. */
  unknown: { since: number; goneAt: number | null; people: PresencePerson[] } | null;
}

const expired = (goneAt: number | null, at: number) =>
  goneAt !== null && at - goneAt >= PERSON_HOLD_MS;

/** Mémoire mise à jour par une nouvelle liste de personnes détectées. */
export function rememberPeople(
  memory: PeopleMemory,
  people: readonly PresencePerson[],
  at: number,
): PeopleMemory {
  const known = new Map<string, { person: PresencePerson; goneAt: number | null }>();
  for (const [profileId, entry] of memory.known)
    if (!expired(entry.goneAt, at)) known.set(profileId, { ...entry, goneAt: entry.goneAt ?? at });
  for (const person of people)
    if (person.profileId) known.set(person.profileId, { person, goneAt: null });
  const strangers = people.filter((person) => !person.profileId);
  let unknown = memory.unknown && expired(memory.unknown.goneAt, at) ? null : memory.unknown;
  if (strangers.length > 0)
    unknown = { since: unknown?.since ?? at, goneAt: null, people: strangers };
  else if (unknown) unknown = { ...unknown, goneAt: unknown.goneAt ?? at };
  return { known, unknown };
}

/** Personnes à afficher à l’instant `at`, et le moment où cette liste changera d’elle-même. */
export function steadyPeople(
  memory: PeopleMemory,
  at: number,
): { people: PresencePerson[]; nextChangeAt: number | null } {
  const people: PresencePerson[] = [];
  const changes: number[] = [];
  for (const { person, goneAt } of memory.known.values()) {
    if (expired(goneAt, at)) continue;
    people.push(person);
    if (goneAt !== null) changes.push(goneAt + PERSON_HOLD_MS);
  }
  const unknown = memory.unknown;
  if (unknown && !expired(unknown.goneAt, at)) {
    const shownAt = unknown.since + UNKNOWN_DELAY_MS;
    if (unknown.goneAt === null) {
      if (at >= shownAt) people.push(...unknown.people);
      else changes.push(shownAt);
    } else if (unknown.goneAt >= shownAt) {
      // Parti après s’être affiché : il reste le temps de la garde.
      people.push(...unknown.people);
      changes.push(unknown.goneAt + PERSON_HOLD_MS);
    }
  }
  return { people, nextChangeAt: changes.length ? Math.min(...changes) : null };
}
