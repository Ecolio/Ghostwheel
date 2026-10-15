/**
 * Contrat addon v1 : le cœur possède l'enveloppe (ModuleSnapshot), l'instance,
 * les droits et le cache ; le module ne fournit que la collecte et la présentation.
 * Aucun module ne choisit son propriétaire ni ne prolonge sa propre validité.
 * Contrat gelé : toute évolution incompatible incrémente `apiVersion`.
 */

export type AddonScope = { kind: 'household'; userId: null } | { kind: 'user'; userId: string };

export interface AddonInstance {
  id: string;
  addonId: string;
  profileId: string | null;
  ref: string | null;
  label: string;
  enabled: boolean;
  /** Affichage permanent choisi par l'administrateur, désactivé par défaut. */
  displayEnabled: boolean;
  config: Record<string, unknown>;
  configVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface AddonSource {
  provider: string;
  sourceId: string;
}

export interface ModuleSnapshot<TData extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 1;
  snapshotId: string;
  cacheKey: string;
  revision: number;
  moduleId: string;
  dataVersion: number;
  scope: AddonScope;
  source: AddonSource | null;
  fetchedAt: string | null;
  observedAt: string | null;
  validUntil: string | null;
  status: 'ready' | 'empty' | 'stale' | 'error';
  data: TData | null;
}

/** Carte spécialisée remplie par le serveur depuis un snapshot valide. */
export interface ModuleCard {
  schemaVersion: 1;
  cardType: 'module';
  addonId: string;
  instanceRef: string | null;
  title: string;
  primaryValue: string | null;
  subtitle: string | null;
  description: string | null;
  items: { label: string; value: string }[];
  sources: string[];
  snapshotId: string;
  stale: boolean;
}

export interface AddonHttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface AddonHttpResponse {
  status: number;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
}

/** Fourni par le cœur. Un module ne crée jamais son propre client réseau. */
export interface AddonHttpClient {
  fetch(request: AddonHttpRequest): Promise<AddonHttpResponse>;
}

export class AddonCollectError extends Error {
  constructor(
    readonly code:
      | 'config_invalid'
      | 'auth'
      | 'quota'
      | 'timeout'
      | 'upstream'
      | 'malformed'
      | 'unavailable'
      | 'forbidden'
      | 'not_found'
      | 'invalid_params',
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export interface AddonCollectContext<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> {
  instance: AddonInstance;
  config: TConfig;
  http: AddonHttpClient;
  now(): number;
  signal: AbortSignal;
  /** Secret nommé, résolu côté serveur et jamais journalisé. */
  secret(name: string): string | undefined;
}

export interface AddonCollection<TData extends Record<string, unknown> = Record<string, unknown>> {
  data: TData;
  /** Vrai quand la source a répondu correctement sans donnée utile. */
  empty?: boolean;
  observedAt?: number | null;
  source?: AddonSource | null;
  /** Fraîcheur propre au module, bornée par le cœur. */
  freshMs?: number;
  cacheKey?: string;
}

export interface AddonPresentContext {
  instance: AddonInstance;
  now(): number;
}

export interface AddonPresentation {
  title: string;
  primaryValue: string | null;
  subtitle: string | null;
  description: string | null;
  items: { label: string; value: string }[];
  /** Faits courts destinés à l'oral. */
  summary: string;
  sources?: string[];
}

/** Présentation permanente distincte des cartes de conversation. Texte uniquement. */
export interface AddonAmbientPresentation {
  /** Masquer la date de collecte pour un calcul local, sauf données périmées. Vrai par défaut. */
  showCollectedAt?: boolean;
  layout: 'metric' | 'list';
  title: string;
  value: string | null;
  subtitle: string | null;
  items: { label: string; value: string }[];
}

export interface AmbientDisplay {
  instanceId: string;
  profileId: string | null;
  addonId: string;
  label: string;
  status: 'loading' | 'ready' | 'empty' | 'stale' | 'error';
  fetchedAt: string | null;
  validUntil: string | null;
  content: AddonAmbientPresentation | null;
}

export interface AddonToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Champ de recherche assistée : l'admin propose des choix, l'utilisateur ne saisit pas d'identifiant. */
export interface AddonSearchField {
  kind: string;
  label: string;
  /** Champ de configuration qui reçoit l'identifiant choisi. */
  target: string;
  /** Champ de configuration qui reçoit le libellé lisible du choix. */
  labelTarget?: string;
  /** Champ de configuration qui doit être renseigné avant de chercher. */
  dependsOn?: string;
  placeholder?: string;
}

export interface AddonSearchInput {
  kind: string;
  query?: string;
  values: Record<string, unknown>;
}

export interface AddonSearchResult {
  id: string;
  label: string;
  detail?: string;
}

export interface AddonSearchContext {
  http: AddonHttpClient;
  signal: AbortSignal;
  secret(name: string): string | undefined;
}

export interface AddonSearchCapability {
  fields: AddonSearchField[];
  find(input: AddonSearchInput, context: AddonSearchContext): Promise<AddonSearchResult[]>;
}

/**
 * Jeton à renseigner dans le fichier .env. Le module le lit par `context.secret(name)` ;
 * l'administration sait seulement s'il est présent, jamais sa valeur.
 */
export interface AddonSecretRequirement {
  /** Nom passé à `context.secret()`, par exemple `meteoConceptToken`. */
  name: string;
  /** Variable du fichier .env, par exemple `CORNELIUS_METEO_CONCEPT_TOKEN`. */
  env: string;
  /** Jeton précédé de « un » ou « une », repris dans « Ce module a besoin d’un jeton… ». */
  label: string;
  /** Page d'inscription où obtenir le jeton. */
  url?: string;
  /** Précision courte affichée entre parenthèses, par exemple « gratuit ». */
  note?: string;
}

export interface AddonDefinition<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  apiVersion: 1;
  version: string;
  /** Libellé public de la source, affiché sur les cartes. */
  sourceLabel: string;
  /** Jetons requis, facultatif et compatible v1 : l'administration signale ceux qui manquent. */
  secrets?: AddonSecretRequirement[];
  configVersion: number;
  configSchema: Record<string, unknown>;
  configDefaults: TConfig;
  configMigrate?(fromVersion: number, config: unknown): TConfig;
  dataSchema: Record<string, unknown>;
  dataVersion: number;
  /** Durée de fraîcheur d'une collecte réussie. */
  freshMs: number;
  tools: AddonToolDefinition[];
  /** Recherche assistée optionnelle (arrêts, directions) pour l'administration. */
  search?: AddonSearchCapability;
  /** Extension optionnelle compatible v1 ; affichage sans voix, réseau ni effets dans present. */
  ambient?: {
    present(
      snapshot: ModuleSnapshot<TData>,
      context: AddonPresentContext,
    ): AddonAmbientPresentation;
  };
  collect(context: AddonCollectContext<TConfig>): Promise<AddonCollection<TData>>;
  present(snapshot: ModuleSnapshot<TData>, context: AddonPresentContext): AddonPresentation;
}

export interface ToolResult {
  schemaVersion: 1;
  status:
    'succeeded' | 'empty' | 'stale' | 'failed' | 'pending_confirmation' | 'unknown' | 'cancelled';
  result: Record<string, unknown> | null;
  snapshotId: string | null;
  actionRunId: string | null;
  summary: string;
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface HttpActionDefinition {
  id: string;
  ref: string;
  label: string;
  /** Explication courte montrée au modèle pour choisir la commande. */
  description: string;
  method: 'GET' | 'POST';
  url: string;
  profileId: string | null;
  headers: Record<string, string>;
  body: string | null;
  confirmation: 'required' | 'none';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ActionRun {
  id: string;
  actionId: string;
  profileId: string | null;
  interactionId: string | null;
  idempotencyKey: string;
  status: 'succeeded' | 'failed' | 'unknown' | 'pending_confirmation' | 'cancelled';
  requestSummary: string | null;
  responseStatus: number | null;
  responseSummary: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: number;
  finishedAt: number | null;
}

/** Identifiant d'une source ou d'une commande, tel que la voix le désigne. */
export const REF_PATTERN = '^[a-z0-9][a-z0-9_-]{0,63}$';

/** Nom d'en-tête HTTP (RFC 9110, « token ») : lettres, chiffres et quelques signes, sans espace. */
export const HEADER_NAME_PATTERN = "^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$";

const ligatures: Record<string, string> = { œ: 'oe', æ: 'ae', ø: 'o', ß: 'ss', đ: 'd', ł: 'l' };

/**
 * Identifiant complet tiré d'un texte libre : accents retirés, minuscules, tout autre signe
 * remplacé par un tiret. « Entrée principale » devient « entree-principale ».
 */
export function refFromText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[œæøßđł]/gu, (letter) => ligatures[letter] ?? '-')
    .replace(/[^a-z0-9_-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-_]+/u, '')
    .slice(0, 64)
    .replace(/[-_]+$/u, '');
}

/**
 * Identifiant libre déduit d'un nom : « maison », puis « maison-2 », « maison-3 »… La base
 * garde la place d'un suffixe ; un nom sans lettre ni chiffre donne « source ».
 */
export function refFromLabel(label: string, taken: ReadonlySet<string>): string {
  const base =
    refFromText(label)
      .slice(0, 60)
      .replace(/[-_]+$/u, '') || 'source';
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function addonScope(instance: AddonInstance): AddonScope {
  return instance.profileId
    ? { kind: 'user', userId: instance.profileId }
    : { kind: 'household', userId: null };
}
