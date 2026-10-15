/**
 * Lettres accentuées et ligatures courantes, en minuscules et majuscules : SQLite ne sait pas
 * retirer un accent, ni passer « É » en minuscule sans extension ICU.
 */
const letters: readonly (readonly [string, string])[] = [
  ...[...'àáâãäåāÀÁÂÃÄÅĀ'].map((letter) => [letter, 'a'] as const),
  ...[...'çćčÇĆČ'].map((letter) => [letter, 'c'] as const),
  ...[...'èéêëēėęÈÉÊËĒĖĘ'].map((letter) => [letter, 'e'] as const),
  ...[...'ìíîïīÌÍÎÏĪ'].map((letter) => [letter, 'i'] as const),
  ...[...'ñńÑŃ'].map((letter) => [letter, 'n'] as const),
  ...[...'òóôõöōøÒÓÔÕÖŌØ'].map((letter) => [letter, 'o'] as const),
  ...[...'ùúûüūÙÚÛÜŪ'].map((letter) => [letter, 'u'] as const),
  ...[...'ýÿÝŸ'].map((letter) => [letter, 'y'] as const),
  ['œ', 'oe'],
  ['Œ', 'oe'],
  ['æ', 'ae'],
  ['Æ', 'ae'],
  ['ß', 'ss'],
  ['đ', 'd'],
  ['ł', 'l'],
];

const letterRows = letters.map(([from, to]) => `('${from}', '${to}')`).join(', ');

/** Tirets répétés ramenés à un seul (80 caractères au plus : sept passes suffisent). */
function collapse(expression: string): string {
  let result = expression;
  for (let pass = 0; pass < 7; pass++) result = `replace(${result}, '--', '-')`;
  return result;
}

/**
 * Une passe : chaque source sans identifiant reçoit celui de son nom, comme refFromLabel()
 * (« Entrée principale » donne « entree-principale »), suivi de « -2 », « -3 »… quand un autre
 * identifiant du même module le porte déjà. Le plan est calculé avant l'écriture, puis appliqué
 * sans jamais écraser un identifiant existant.
 */
const pass = `
  CREATE TEMP TABLE IF NOT EXISTS addon_ref_plan (id TEXT PRIMARY KEY, ref TEXT NOT NULL);
  DELETE FROM addon_ref_plan;
  WITH RECURSIVE
    letters(source, target) AS (VALUES ${letterRows}),
    pending AS (
      SELECT id, addon_id, label, created_at FROM addon_instances WHERE ref IS NULL
    ),
    walk(id, position, text) AS (
      SELECT id, 1, '' FROM pending
      UNION ALL
      SELECT walk.id, walk.position + 1, walk.text || CASE
          WHEN lower(substr(pending.label, walk.position, 1)) GLOB '[a-z0-9_]'
            THEN lower(substr(pending.label, walk.position, 1))
          ELSE coalesce(
            (SELECT target FROM letters WHERE source = substr(pending.label, walk.position, 1)),
            '-'
          )
        END
      FROM walk JOIN pending ON pending.id = walk.id
      WHERE walk.position <= length(pending.label)
    ),
    trimmed AS (
      SELECT pending.id, pending.addon_id, pending.created_at,
        rtrim(substr(ltrim(${collapse('walk.text')}, '-_'), 1, 60), '-_') AS base
      FROM walk JOIN pending ON pending.id = walk.id
      WHERE walk.position = length(pending.label) + 1
    ),
    based AS (
      SELECT id, addon_id, created_at, CASE WHEN base = '' THEN 'source' ELSE base END AS base
      FROM trimmed
    ),
    ranked AS (
      SELECT based.*, row_number() OVER (
        PARTITION BY addon_id, base ORDER BY created_at, id
      ) AS rank
      FROM based
    ),
    counter(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 500)
  INSERT INTO addon_ref_plan (id, ref)
  SELECT ranked.id, (
    SELECT candidate FROM (
      SELECT candidate, row_number() OVER (ORDER BY value) AS slot FROM (
        SELECT value,
          CASE WHEN value = 1 THEN ranked.base ELSE ranked.base || '-' || value END AS candidate
        FROM counter
      )
      WHERE candidate NOT IN (
        SELECT ref FROM addon_instances
        WHERE addon_id = ranked.addon_id AND ref IS NOT NULL
      )
    )
    WHERE slot = ranked.rank
  )
  FROM ranked;
  UPDATE OR IGNORE addon_instances
    SET ref = (SELECT ref FROM addon_ref_plan WHERE addon_ref_plan.id = addon_instances.id)
    WHERE ref IS NULL
      AND id IN (SELECT id FROM addon_ref_plan WHERE ref IS NOT NULL);
  DROP TABLE addon_ref_plan;`;

/**
 * Les sources créées sans identifiant en reçoivent un, tiré de leur nom : avec deux sources
 * sans identifiant, la voix ne pouvait pas choisir. Rejouable : seules les sources encore sans
 * identifiant sont touchées. La seconde passe départage un nom qui ressemble à un identifiant
 * attribué par la première (« Maison 2 » après deux « Maison »).
 */
export const addonRefsMigration = pass + pass;
