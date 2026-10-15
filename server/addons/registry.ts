import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddonDefinition, AddonSecretRequirement } from '../../shared/addons.js';
import type { DiagnosticLog } from '../logs.js';
import { compile } from '../../shared/validation.js';

/**
 * Découverte dynamique des modules : un dossier `addons/<id>/` portant un `index.ts`
 * devient un module sans que le cœur soit modifié. La garantie de type perdue au
 * chargement est reprise ici par une validation runtime du contrat v1 : un module
 * invalide est signalé puis ignoré, jamais la cause d'un échec du serveur.
 * Les fixtures et schémas restent la propriété du module, le registre ne connaît
 * que la définition qu'il exporte par défaut.
 */

export interface AddonLoadReport {
  /** Modules acceptés, ordonnés par identifiant pour un catalogue déterministe. */
  addons: AddonDefinition[];
  /** Dossiers refusés : nom du dossier et raison courte, affichés au diagnostic. */
  rejected: { name: string; reason: string }[];
}

const entryFile = 'index.ts';
/** Un identifiant devient un nom d'outil (`<id>__<tool>`) : alphabet strict exigé. */
const idPattern = /^[a-z][a-z0-9_]{0,31}$/;
/** Racine `addons/` déduite de ce fichier : le registre suit le dépôt, pas le cwd. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'addons');

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Erreur inconnue.';
}

const secretNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;
const secretEnvPattern = /^[A-Z][A-Z0-9_]{0,99}$/u;

/** Jetons déclarés (champ facultatif) : noms stricts, page d'inscription en http(s). */
function validateSecrets(secrets: unknown): string | null {
  if (secrets === undefined) return null;
  if (!Array.isArray(secrets)) return 'liste de jetons invalide.';
  const names = new Set<string>();
  for (const secret of secrets as Partial<AddonSecretRequirement>[]) {
    if (
      !secret ||
      typeof secret !== 'object' ||
      typeof secret.name !== 'string' ||
      !secretNamePattern.test(secret.name) ||
      typeof secret.env !== 'string' ||
      !secretEnvPattern.test(secret.env) ||
      typeof secret.label !== 'string' ||
      !secret.label.trim() ||
      secret.label.length > 80 ||
      (secret.note !== undefined && (typeof secret.note !== 'string' || secret.note.length > 40))
    )
      return 'jeton déclaré invalide.';
    if (secret.url !== undefined) {
      let url: URL | null = null;
      try {
        url = typeof secret.url === 'string' ? new URL(secret.url) : null;
      } catch {
        url = null;
      }
      if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
        return `page d’inscription du jeton « ${secret.name} » invalide.`;
    }
    if (names.has(secret.name)) return 'jeton déclaré deux fois.';
    names.add(secret.name);
  }
  return null;
}

/**
 * Contrôle de forme du contrat gelé `apiVersion: 1`. Les schémas sont compilés dès
 * le chargement pour isoler les modules invalides avant tout appel du modèle.
 */
export function validateAddonDefinition(addon: unknown): string | null {
  if (!addon || typeof addon !== 'object') return 'aucune définition exportée.';
  const candidate = addon as Partial<AddonDefinition>;
  if (candidate.apiVersion !== 1) return `apiVersion non supportée (attendu : 1).`;
  if (typeof candidate.id !== 'string' || !idPattern.test(candidate.id))
    return 'identifiant invalide.';
  if (typeof candidate.version !== 'string') return 'version absente.';
  if (typeof candidate.sourceLabel !== 'string') return 'libellé de source absent.';
  if (!Number.isInteger(candidate.configVersion) || candidate.configVersion! < 1)
    return 'version de configuration absente.';
  if (!!candidate.configSchema && typeof candidate.configSchema !== 'object')
    return 'schéma de configuration invalide.';
  if (!candidate.configSchema) return 'schéma de configuration absent.';
  if (!candidate.configDefaults || typeof candidate.configDefaults !== 'object')
    return 'valeurs par défaut absentes.';
  if (!Number.isInteger(candidate.dataVersion) || candidate.dataVersion! < 1)
    return 'version de données absente.';
  if (!candidate.dataSchema || typeof candidate.dataSchema !== 'object')
    return 'schéma de données absent.';
  if (!Number.isInteger(candidate.freshMs) || candidate.freshMs! <= 0) return 'fraîcheur absente.';
  if (!Array.isArray(candidate.tools)) return 'liste d’outils absente.';
  const toolNames = new Set<string>();
  for (const tool of candidate.tools) {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/u.test(tool.name) ||
      `${candidate.id}__${tool.name}`.length > 64 ||
      typeof tool.description !== 'string' ||
      !tool.parameters ||
      typeof tool.parameters !== 'object'
    )
      return 'définition d’outil invalide.';
    if (toolNames.has(tool.name)) return 'nom d’outil dupliqué.';
    toolNames.add(tool.name);
  }
  if (
    candidate.ambient !== undefined &&
    (!candidate.ambient || typeof candidate.ambient.present !== 'function')
  )
    return 'présentation permanente invalide.';
  const secretsInvalid = validateSecrets(candidate.secrets);
  if (secretsInvalid) return secretsInvalid;
  if (typeof candidate.collect !== 'function') return 'collecte absente.';
  if (typeof candidate.present !== 'function') return 'présentation absente.';
  if (
    candidate.search &&
    (typeof candidate.search.find !== 'function' ||
      !Array.isArray(candidate.search.fields) ||
      !candidate.search.fields.every(
        (field) =>
          field &&
          typeof field.kind === 'string' &&
          typeof field.label === 'string' &&
          typeof field.target === 'string',
      ))
  )
    return 'recherche assistée invalide.';
  const schemas: [string, unknown][] = [
    ['schéma de configuration', candidate.configSchema],
    ['schéma de données', candidate.dataSchema],
    ...candidate.tools.map((tool): [string, unknown] => [
      `paramètres de l’outil « ${tool.name} »`,
      tool.parameters,
    ]),
  ];
  for (const [label, schema] of schemas) {
    try {
      compile(schema as object);
    } catch (error) {
      return `${label} invalide : ${firstSchemaError(error)}`;
    }
  }
  return null;
}

/** Premier message d'Ajv, assez court pour la page Modules (« must be object »…). */
function firstSchemaError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const first = message.replace(/^schema is invalid: /u, '').split(/, (?=data)/u)[0] ?? message;
  const text = first.length > 160 ? first.slice(0, 159) + '…' : first;
  return text.endsWith('.') || text.endsWith('…') ? text : text + '.';
}

/**
 * Parcourt `addons/` et charge chaque module isolément : un dossier cassé est
 * journalisé et n'empêche jamais les autres de charger.
 */
export async function loadAddons(options: { logs?: DiagnosticLog } = {}): Promise<AddonLoadReport> {
  const addons: AddonDefinition[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let entries: string[] = [];
  try {
    entries = existsSync(root) ? readdirSync(root) : [];
  } catch (error) {
    options.logs?.write('warn', 'addon', 'Dossier des modules illisible', { error });
    return { addons, rejected };
  }
  for (const name of entries.sort()) {
    if (!idPattern.test(name)) continue;
    const directory = resolve(root, name);
    try {
      if (!statSync(directory).isDirectory()) continue;
    } catch {
      continue;
    }
    const entry = resolve(directory, entryFile);
    if (!existsSync(entry)) {
      rejected.push({ name, reason: `point d’entrée « ${entryFile} » absent.` });
      continue;
    }
    try {
      const module = (await import(pathToFileURL(entry).href)) as { default?: unknown };
      const invalid = validateAddonDefinition(module.default);
      if (invalid) {
        rejected.push({ name, reason: invalid });
        options.logs?.write('warn', 'addon', 'Module refusé par le contrat v1', {
          addonId: name,
          reason: invalid,
        });
        continue;
      }
      const addon = module.default as AddonDefinition;
      if (addon.id !== name) {
        rejected.push({ name, reason: `identifiant « ${addon.id} » différent du dossier.` });
        options.logs?.write('warn', 'addon', 'Module refusé : identifiant incohérent', {
          addonId: name,
          declaredId: addon.id,
        });
        continue;
      }
      addons.push(addon);
    } catch (error) {
      rejected.push({ name, reason: describe(error) });
      options.logs?.write('warn', 'addon', 'Module non chargé', {
        addonId: name,
        error,
      });
    }
  }
  if (addons.length > 0 || rejected.length > 0)
    options.logs?.write('info', 'addon', 'Registre des modules chargé', {
      loaded: addons.map((addon) => addon.id),
      rejected,
    });
  return { addons, rejected };
}
