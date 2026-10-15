/**
 * Liens d’une rubrique à l’autre pour une personne donnée (#memory/personne-<id>). L’adresse
 * porte la rubrique, que l’administration suit à chaque changement d’ancre ; la rubrique
 * ouverte lit ensuite la personne dans l’ancre, y compris après un rechargement.
 */
export type PersonSection = 'memory' | 'personality';

export function personHref(section: PersonSection, profileId: string): string {
  return `#${section}/personne-${encodeURIComponent(profileId)}`;
}

/** Personne désignée par l’ancre actuelle pour cette rubrique, sinon null. */
export function personFromHash(section: PersonSection): string | null {
  const prefix = `#${section}/personne-`;
  if (!location.hash.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(location.hash.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}
