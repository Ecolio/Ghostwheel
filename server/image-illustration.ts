import type { DisplayCard } from '../shared/types.js';

/** Les cartes purement chiffrées et les cartes périmées ne donnent pas de sujet visuel fiable. */
export function illustrationPrompt(card: Pick<DisplayCard, 'content' | 'stale'>): string | null {
  const content = card.content;
  if (
    content.cardType === 'image' ||
    card.stale ||
    (content.cardType === 'module' && content.stale)
  )
    return null;

  const details = [
    content.subtitle,
    content.description,
    ...content.items.map((item) => `${item.label}: ${item.value}`),
    content.primaryValue,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('; ');
  if ((details.match(/\p{L}/gu) ?? []).length < 12) return null;

  const subject = [content.title, details]
    .join('; ')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 700);
  return (
    'Square editorial illustration, clear visual composition, no writing, no letters, no numbers, ' +
    'no logos, no recognizable real person. Illustrate the subject of this French information ' +
    `card faithfully without inventing specific facts: ${subject}`
  );
}
