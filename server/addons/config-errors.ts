import type { ErrorObject } from 'ajv';

/** Erreur de réglage rattachée à un champ : `path` vaut le nom du champ, ou "" pour l'ensemble. */
export interface ConfigFieldError {
  path: string;
  message: string;
}

interface SchemaLike {
  properties?: Record<string, { title?: string } | undefined>;
}

function fieldOf(instancePath: string): string {
  // « /insee » devient « insee » ; un champ imbriqué garde son chemin « a/b ».
  return instancePath.replace(/^\//u, '').replace(/~1/gu, '/').replace(/~0/gu, '~');
}

function titleOf(schema: SchemaLike, field: string): string {
  return schema.properties?.[field]?.title ?? field;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function valueAt(config: unknown, field: string): unknown {
  if (!field) return config;
  let current: unknown = config;
  for (const part of field.split('/')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function typeMessage(expected: unknown): string {
  const types = (Array.isArray(expected) ? expected : String(expected).split(',')).filter(
    (type) => type !== 'null',
  );
  if (types.includes('integer')) return 'Nombre entier attendu.';
  if (types.includes('number')) return 'Nombre attendu.';
  if (types.includes('boolean')) return 'Choisissez oui ou non.';
  return 'Texte attendu.';
}

function describe(error: ErrorObject, config: unknown): string {
  const params = error.params as Record<string, unknown>;
  const value = valueAt(config, fieldOf(error.instancePath));
  switch (error.keyword) {
    case 'required':
      return 'Champ obligatoire.';
    case 'type':
      return isEmpty(value) ? 'Champ obligatoire.' : typeMessage(params.type);
    case 'minLength':
      return Number(params.limit) <= 1
        ? 'Champ obligatoire.'
        : `Au moins ${String(params.limit)} caractères.`;
    case 'maxLength':
      return `${String(params.limit)} caractères au plus.`;
    case 'minimum':
    case 'exclusiveMinimum':
      return `Valeur trop petite : au moins ${String(params.limit)}.`;
    case 'maximum':
    case 'exclusiveMaximum':
      return `Valeur trop grande : au plus ${String(params.limit)}.`;
    case 'pattern':
    case 'format':
      return 'Format invalide.';
    case 'enum':
    case 'const':
      return 'Choix non proposé.';
    case 'additionalProperties':
      return 'Champ inconnu de ce module.';
    default:
      return 'Valeur invalide.';
  }
}

/**
 * Traduit les erreurs Ajv d'une configuration en erreurs par champ, en français. Une
 * alternative « anyOf » non satisfaite (code INSEE ou coordonnées) devient un seul message
 * qui nomme les possibilités, rattaché au premier champ de la première.
 */
export function configFieldErrors(
  schema: SchemaLike,
  errors: readonly ErrorObject[] | null | undefined,
  config: unknown,
): ConfigFieldError[] {
  const list = errors ?? [];
  const alternatives = list.filter((error) => error.keyword === 'anyOf');
  const branchOf = (error: ErrorObject) =>
    alternatives.find((group) => error.schemaPath.startsWith(group.schemaPath + '/'));
  const result: ConfigFieldError[] = [];
  const seen = new Set<string>();
  const push = (path: string, message: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    result.push({ path, message });
  };
  for (const error of list) {
    if (error.keyword === 'anyOf') {
      const branches = new Map<number, string[]>();
      for (const inner of list) {
        if (!inner.schemaPath.startsWith(error.schemaPath + '/')) continue;
        const index = Number(inner.schemaPath.slice(error.schemaPath.length + 1).split('/')[0]);
        const field =
          inner.keyword === 'required'
            ? fieldOf(`${inner.instancePath}/${String(inner.params.missingProperty)}`)
            : fieldOf(inner.instancePath);
        if (!field || !Number.isInteger(index)) continue;
        const fields = branches.get(index) ?? [];
        if (!fields.includes(field)) fields.push(field);
        branches.set(index, fields);
      }
      const ordered = [...branches.entries()].sort(([a], [b]) => a - b).map(([, f]) => f);
      if (ordered.length === 0) {
        push(fieldOf(error.instancePath), 'Valeur invalide.');
        continue;
      }
      const names = ordered.map((fields) =>
        fields.map((field) => `« ${titleOf(schema, field)} »`).join(' et '),
      );
      push(ordered[0]![0]!, `Renseignez ${names.join(', ou ')}.`);
      continue;
    }
    if (branchOf(error)) continue;
    const path =
      error.keyword === 'required'
        ? fieldOf(`${error.instancePath}/${String(error.params.missingProperty)}`)
        : error.keyword === 'additionalProperties'
          ? fieldOf(`${error.instancePath}/${String(error.params.additionalProperty)}`)
          : fieldOf(error.instancePath);
    push(path, describe(error, config));
  }
  return result;
}
