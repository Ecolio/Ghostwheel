import { refFromText } from '../../../shared/addons';
import type { MirrorState, Profile } from '../../../shared/types';
import type { AddonInstanceView } from './types';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export function isSessionActive(state: Pick<MirrorState, 'session'>): boolean {
  return ['connecting', 'ready', 'closing'].includes(state.session.phase);
}

/** « d’Alice », « de Bob » : l’élision devant une voyelle. */
export function ofName(name: string): string {
  return /^[aeiouyàâäéèêëîïôöùûüÿœæ]/iu.test(name.trim()) ? 'd’' + name : 'de ' + name;
}

/**
 * Nombre saisi à la française : « 1,5 » comme « 1.5 », espaces ignorés. NaN si la saisie n’est
 * pas un nombre (vide, lettres, deux séparateurs).
 */
export function parseDecimal(text: string): number {
  const compact = text.replace(/\s/gu, '');
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/u.test(compact)) return Number.NaN;
  return Number(compact.replace(',', '.'));
}

/** 1.5 s’affiche « 1,5 » dans un champ : le séparateur décimal français. */
export function decimalText(value: number): string {
  return String(value).replace('.', ',');
}

/** « 1 source », « 3 sources » : en français, 0 et 1 restent au singulier. */
export function plural(count: number, singular: string, pluralForm = singular + 's'): string {
  return `${count.toLocaleString('fr-FR')} ${Math.abs(count) >= 2 ? pluralForm : singular}`;
}

/**
 * Identifiant complet, appliqué à la perte de focus et à l’envoi : accents retirés, signes
 * remplacés par des tirets, sans tiret au début ni à la fin (« Entrée » devient « entree »).
 */
export function slug(value: string): string {
  return refFromText(value);
}

/**
 * Identifiant pendant la saisie : minuscules et espaces en tirets, rien de plus. Le tiret
 * final reste pour pouvoir taper « porte-garage » ; slug() termine le travail ensuite.
 */
export function typingSlug(value: string): string {
  return value.toLocaleLowerCase('fr-FR').replace(/\s/gu, '-').slice(0, 64);
}

/** Identifiant déjà pris dans la même portée (même propriétaire) : le serveur le refuserait. */
export function duplicateRef<
  T extends { id: string; ref: string | null; profileId: string | null },
>(ref: string, profileId: string | null, entries: readonly T[], selfId: string | null): T | null {
  const wanted = slug(ref);
  if (!wanted) return null;
  return (
    entries.find(
      (entry) => entry.id !== selfId && entry.ref === wanted && entry.profileId === profileId,
    ) ?? null
  );
}

// Phrase qui désigne une source à la voix, propre à chaque module. Le mot du module répété
// dans l’identifiant (« meteo-a-la-maison ») est retiré : on dit « la météo de maison ».
const spokenForms: Record<string, { head: string; repeats: readonly string[] }> = {
  weather: { head: 'la météo', repeats: ['meteo', 'temps', 'previsions'] },
  transit: {
    head: 'les prochains passages',
    repeats: [
      'bus',
      'transport',
      'transports',
      'train',
      'trains',
      'rer',
      'metro',
      'tram',
      'passages',
    ],
  },
  clock: { head: 'l’heure', repeats: ['heure', 'horloge'] },
  ragator: { head: 'les vidéos', repeats: ['videos', 'video', 'ragator'] },
};

const linkWords = new Set([
  'a',
  'au',
  'aux',
  'de',
  'des',
  'du',
  'd',
  'la',
  'le',
  'les',
  'l',
  'pour',
  'chez',
  'en',
]);

/**
 * Mots de l’identifiant, écrits comme dans le nom affiché quand ils y correspondent : avec
 * « Heure de Paris » et « heure-de-paris », on lit « Heure », « de », « Paris ». Dès qu’un mot
 * diffère (identifiant choisi à la main, suffixe « -2 »), la suite reprend l’identifiant.
 */
function displayWords(ref: string, label: string | null | undefined): string[] {
  const words = ref.split(/[-_]+/u).filter(Boolean);
  const written = (label ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let same = 0;
  while (same < words.length && same < written.length && slug(written[same]!) === words[same])
    same++;
  return [...written.slice(0, same), ...words.slice(same)];
}

/**
 * « la météo de Lyon », « l’heure d’atelier » : la phrase qui désigne une source à la voix. Elle
 * suit l’identifiant, avec les majuscules et les accents du nom affiché quand ils correspondent.
 */
export function spokenPhrase(
  addonId: string,
  ref: string | null | undefined,
  label?: string | null,
): string | null {
  const words = displayWords(ref ?? '', label);
  if (words.length === 0) return null;
  const key = (word: string) => slug(word);
  const form = spokenForms[addonId];
  let rest = words;
  // « L’heure de Paris » : l’article devant le mot du module ne compte pas.
  while (rest.length > 1 && linkWords.has(key(rest[0]!)) && form?.repeats.includes(key(rest[1]!)))
    rest = rest.slice(1);
  if (form && form.repeats.includes(key(rest[0]!))) {
    rest = rest.slice(1);
    while (rest.length > 1 && linkWords.has(key(rest[0]!))) rest = rest.slice(1);
    if (rest.length === 0) rest = words;
  }
  const name = rest.join(' ');
  return `${form?.head ?? 'la source'} ${/^[aeiouyhéèêàâîô]/iu.test(name) ? 'd’' : 'de '}${name}`;
}

const regionLabels: Record<string, string> = {
  Europe: 'Europe',
  Africa: 'Afrique',
  America: 'Amériques',
  Antarctica: 'Antarctique',
  Arctic: 'Arctique',
  Asia: 'Asie',
  Atlantic: 'Atlantique',
  Australia: 'Australie',
  Indian: 'Océan Indien',
  Pacific: 'Pacifique',
};

/** Fuseaux connus du navigateur, rangés par région (Europe d’abord), valeur IANA conservée. */
export function timeZoneGroups(
  current: string,
): { label: string; zones: { value: string; label: string }[] }[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Europe/Paris'];
  }
  const all = new Set([...zones, 'UTC', ...(current ? [current] : [])]);
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const zone of [...all].sort()) {
    const [region, ...rest] = zone.split('/');
    const label = regionLabels[region!] && rest.length ? regionLabels[region!]! : 'Autres';
    const name =
      zone === 'UTC'
        ? 'UTC (temps universel)'
        : (label === 'Autres' ? zone : rest.join(' / ')).replace(/_/gu, ' ');
    const list = groups.get(label) ?? [];
    list.push({ value: zone, label: name });
    groups.set(label, list);
  }
  const order = [...Object.values(regionLabels), 'Autres'];
  return [...groups.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([label, list]) => ({ label, zones: list }));
}

/** Texte comparable : sans accents ni majuscules, apostrophes et tirets en espaces. */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * Recherche mot par mot, sans accents : chaque mot tapé doit se retrouver dans l’un des
 * textes (nom, description, mots-clés, sources). « meteo maison » trouve la météo « Maison ».
 */
export function matchesSearch(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = ' ' + normalizeSearch(texts.filter(Boolean).join(' ')) + ' ';
  return words.every((word) => haystack.includes(' ' + word));
}

export function formatWhen(value: number | string | null): string {
  if (value === null) return 'jamais';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return 'inconnu';
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function ownerLabel(profileId: string | null, profiles: Profile[]): string {
  if (!profileId) return 'Le foyer';
  return profiles.find((profile) => profile.id === profileId)?.name ?? 'Profil inconnu';
}

export function snapshotStatusLabel(status: string): string {
  if (status === 'ready') return 'À jour';
  if (status === 'empty') return 'Aucune donnée';
  if (status === 'stale') return 'Dernier relevé';
  if (status === 'pending') return 'En attente';
  return 'Erreur';
}

export function snapshotVariant(status: string): BadgeVariant {
  if (status === 'ready') return 'secondary';
  if (status === 'error') return 'destructive';
  return 'outline';
}

/**
 * Table unique des codes d’erreur des modules et commandes, en mots simples. Modules,
 * Commandes et Diagnostic l’utilisent pour qu’un même code se lise partout de la même façon.
 */
export const ERROR_CODE_LABELS: Readonly<Record<string, string>> = {
  config_invalid: 'Réglage incomplet',
  auth: 'Identifiants refusés',
  forbidden: 'Accès refusé',
  quota: 'Limite d’utilisation atteinte',
  timeout: 'Le service a mis trop de temps à répondre',
  upstream: 'Le service ne répond pas',
  unavailable: 'Le service ne répond pas',
  malformed: 'Réponse illisible',
  not_found: 'Introuvable',
  invalid_params: 'Requête invalide',
};

export function errorCodeLabel(code: string | null | undefined): string {
  return (code && ERROR_CODE_LABELS[code]) || 'Erreur inattendue';
}

/** « Adresse introuvable (404) » plutôt qu’un code HTTP nu. */
export function httpStatusLabel(status: number): string {
  if (status >= 200 && status < 300) return `Réussi (${status})`;
  if (status === 400) return 'Requête refusée (400)';
  if (status === 401) return 'Identifiants refusés (401)';
  if (status === 403) return 'Accès refusé (403)';
  if (status === 404) return 'Adresse introuvable (404)';
  if (status === 405) return 'Méthode refusée (405)';
  if (status === 408 || status === 504) return `Délai dépassé (${status})`;
  if (status === 429) return 'Trop de demandes (429)';
  if (status >= 500) return `Le service ne répond pas (${status})`;
  return `Réponse inattendue (${status})`;
}

/** « Réglage incomplet : Jeton Météo Concept non configuré. » */
export function describeError(error: { code: string; message?: string | null }): string {
  const label = errorCodeLabel(error.code);
  const detail = error.message?.trim();
  return detail && detail !== label ? `${label} : ${detail}` : `${label}.`;
}

/** Dernière collecte en échec sur une source active : à corriger, même si un ancien relevé reste. */
export function sourceNeedsFix(instance: AddonInstanceView): boolean {
  return instance.enabled && instance.error !== null;
}

/** Badge d’état homogène d’un module : Prêt, À configurer, À corriger, Désactivé. */
export function moduleStatus(
  instances: AddonInstanceView[],
  missingSecrets = 0,
): { label: string; variant: BadgeVariant } {
  if (missingSecrets > 0) return { label: 'Jeton manquant', variant: 'destructive' };
  if (instances.length === 0) return { label: 'À configurer', variant: 'outline' };
  const enabled = instances.filter((instance) => instance.enabled);
  if (enabled.length === 0) return { label: 'Désactivé', variant: 'outline' };
  const failing = enabled.filter(sourceNeedsFix).length;
  if (failing > 0)
    return { label: `${plural(failing, 'source')} · à corriger`, variant: 'destructive' };
  return { label: 'Prêt', variant: 'secondary' };
}

/** Badge des commandes HTTP, sur le même modèle que celui des modules. */
export function commandsStatus(
  commands: readonly { enabled: boolean; missingSecrets?: string[] }[],
  waiting = 0,
): { label: string; variant: BadgeVariant } {
  if (waiting > 0)
    return { label: `${waiting.toLocaleString('fr-FR')} à valider`, variant: 'default' };
  if (commands.length === 0) return { label: 'À configurer', variant: 'outline' };
  const enabled = commands.filter((command) => command.enabled);
  if (enabled.length === 0) return { label: 'Désactivé', variant: 'outline' };
  if (enabled.some((command) => (command.missingSecrets ?? []).length > 0))
    return { label: 'À corriger', variant: 'destructive' };
  return { label: 'Prêt', variant: 'secondary' };
}

/** État d’une source sur une ligne : jamais « Erreur · jamais » pour une source neuve. */
export function sourceStatusLine(instance: AddonInstanceView, detail: string | null): string {
  const snapshot = instance.snapshot;
  const parts: string[] = [];
  if (!snapshot || !snapshot.data || snapshot.status === 'error')
    parts.push('Pas encore de données');
  else if (snapshot.status === 'empty')
    parts.push(`Aucune donnée utile · relevé ${formatWhen(snapshot.fetchedAt)}`);
  else
    parts.push(
      `${snapshot.status === 'stale' ? 'Dernier relevé' : 'À jour'} · ${formatWhen(snapshot.fetchedAt)}`,
    );
  if (detail && snapshot?.data && snapshot.status !== 'error') parts.push(detail);
  if (instance.error) parts.push(describeError(instance.error));
  return parts.join(' · ');
}

export function runStatusLabel(status: string): string {
  if (status === 'succeeded') return 'réussie';
  if (status === 'failed') return 'échouée';
  if (status === 'unknown') return 'incertaine';
  if (status === 'pending_confirmation') return 'en attente';
  if (status === 'cancelled') return 'annulée';
  return status;
}

export function runStatusVariant(status: string): BadgeVariant {
  if (status === 'succeeded') return 'secondary';
  if (status === 'failed' || status === 'unknown') return 'destructive';
  return 'outline';
}

export function freshnessLabel(instance: AddonInstanceView, now: number): string {
  const snapshot = instance.snapshot;
  if (!snapshot || snapshot.status === 'error') return 'jamais collecté';
  if (!snapshot.validUntil)
    return snapshot.status === 'empty' ? 'aucune donnée' : 'fraîcheur inconnue';
  const validUntil = Date.parse(snapshot.validUntil);
  if (!Number.isFinite(validUntil)) return 'fraîcheur inconnue';
  if (validUntil <= now) return `périmé depuis ${formatWhen(validUntil)}`;
  return `valide jusqu’à ${formatWhen(validUntil)}`;
}
