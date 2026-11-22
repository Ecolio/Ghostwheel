/**
 * voron_status : état en lecture seule d’une imprimante 3D sous Klipper/Moonraker
 * (Voron 0, Voron 2.4, ou toute autre machine exposant l’API Moonraker).
 *
 * Une source = une imprimante (son adresse Moonraker). L’unique requête est
 * `POST /printer/objects/query`, en lecture : aucun G-code, aucune macro, aucune
 * écriture n’est jamais envoyée à l’imprimante.
 */
import {
  AddonCollectError,
  type AddonDefinition,
  type AddonHttpResponse,
  type AddonPresentContext,
  type AddonPresentation,
  type ModuleSnapshot,
} from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type VoronConfig = { baseUrl: string };

type VoronData = {
  klipperState: string;
  klipperMessage: string | null;
  printState: string | null;
  filename: string | null;
  progress: number | null;
  printDurationS: number | null;
  filamentUsedM: number | null;
  homedAxes: string | null;
  nozzleTemp: number | null;
  nozzleTarget: number | null;
  bedTemp: number | null;
  bedTarget: number | null;
};

/** Requête de statut unique : les objets usuels de Klipper, en lecture seule. */
const statusQuery = JSON.stringify({
  objects: {
    webhooks: null,
    print_stats: null,
    virtual_sdcard: null,
    toolhead: ['homed_axes'],
    extruder: ['temperature', 'target'],
    heater_bed: ['temperature', 'target'],
  },
});

const requestTimeoutMs = 4000;
const maxResponseBytes = 32 * 1024;
/** Un état de l’imprimante change vite : la carte de la voix se périme en 15 secondes. */
const freshMs = 15_000;

/** Champ texte borné, ou null s’il est absent : les objets optionnels peuvent manquer. */
function asText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** Champ numérique borné, ou null s’il est absent ou invalide. */
function asNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : null;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Erreur compréhensible selon le statut HTTP de Moonraker ; le corps brut n’est jamais repris. */
function statusError(response: AddonHttpResponse): AddonCollectError {
  if (response.status === 401 || response.status === 403)
    return new AddonCollectError('auth', 'Moonraker refuse la clé API fournie.', false);
  if (response.status === 404)
    return new AddonCollectError('not_found', 'Aucune API Moonraker à cette adresse.', false);
  if (response.status === 400 || response.status === 405)
    return new AddonCollectError(
      'invalid_params',
      'Moonraker a refusé la requête de statut.',
      false,
    );
  if (response.status >= 500)
    return new AddonCollectError('unavailable', 'Moonraker est indisponible.', true);
  return new AddonCollectError('upstream', `Moonraker a répondu ${response.status}.`, false);
}

const frTemp = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const frPercent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0 });
const frMeters = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const klipperLabels: Record<string, string> = {
  ready: 'Prête',
  startup: 'Démarrage',
  shutdown: 'Arrêt',
  error: 'Erreur',
};

const printLabels: Record<string, string> = {
  printing: 'En impression',
  paused: 'En pause',
  complete: 'Terminée',
  cancelled: 'Annulée',
  error: 'En erreur',
  standby: 'En attente',
};

/** « 1 h 02 min » ou « 12 min ». */
function durationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours > 0 ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${minutes} min`;
}

/** Nom de fichier court pour la carte et l’oral : la dernière partie du chemin. */
function shortName(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.length > 60 ? `${base.slice(0, 59)}…` : base;
}

function tempItem(
  label: string,
  temp: number | null,
  target: number | null,
): { label: string; value: string } | null {
  if (temp === null && target === null) return null;
  const current = temp === null ? '—' : frTemp.format(temp);
  const wanted = target === null || target === 0 ? '' : ` (but ${frTemp.format(target)} °C)`;
  return { label, value: `${current} °C${wanted}` };
}

function tempsSentence(data: VoronData): string | null {
  const parts: string[] = [];
  if (data.nozzleTemp !== null) parts.push(`buse ${frTemp.format(data.nozzleTemp)} °C`);
  if (data.bedTemp !== null) parts.push(`lit ${frTemp.format(data.bedTemp)} °C`);
  return parts.length ? `Températures : ${parts.join(', ')}.` : null;
}

function present(
  snapshot: ModuleSnapshot<VoronData>,
  context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data;
  if (!data) throw new Error('Aucun statut à présenter.');
  const name = asText(context.instance.label, 80) ?? 'Imprimante';
  const stale = snapshot.status === 'stale' ? ' Dernier relevé connu.' : '';
  const description =
    snapshot.status === 'stale'
      ? 'Dernier relevé connu.'
      : data.klipperState !== 'ready'
        ? data.klipperMessage
        : null;

  const items: { label: string; value: string }[] = [];
  const nozzle = tempItem('Buse', data.nozzleTemp, data.nozzleTarget);
  if (nozzle) items.push(nozzle);
  const bed = tempItem('Lit', data.bedTemp, data.bedTarget);
  if (bed) items.push(bed);

  let primaryValue: string | null;
  let subtitle: string | null;
  let summary: string;

  if (data.klipperState !== 'ready') {
    // Moonraker répond, mais Klipper n’est pas prêt : distinct d’une imprimante injoignable.
    primaryValue = klipperLabels[data.klipperState] ?? data.klipperState;
    subtitle = null;
    summary = `${name} : Klipper est en état « ${data.klipperState} ».${stale}`;
  } else if (data.printState === 'printing' || data.printState === 'paused') {
    const pct = data.progress !== null ? frPercent.format(data.progress) : null;
    primaryValue =
      data.printState === 'paused' ? printLabels.paused! : (pct ?? printLabels.printing!);
    subtitle = data.filename ? shortName(data.filename) : null;
    if (data.printState === 'printing' && data.printDurationS !== null)
      items.push({ label: 'Temps écoulé', value: durationLabel(data.printDurationS) });
    if (data.filamentUsedM !== null && data.filamentUsedM > 0)
      items.push({ label: 'Filament', value: `${frMeters.format(data.filamentUsedM)} m` });
    const remaining =
      data.printState === 'printing' &&
      data.progress !== null &&
      data.progress > 0.005 &&
      data.printDurationS !== null
        ? (data.printDurationS * (1 - data.progress)) / data.progress
        : null;
    summary = [
      `${name} ${data.printState === 'paused' ? 'en pause' : 'imprime'}${data.filename ? ` « ${shortName(data.filename)} »` : ''}${pct ? ` à ${pct}` : ''}${data.printDurationS !== null ? ` depuis ${durationLabel(data.printDurationS)}` : ''}.`,
      remaining !== null ? `Encore environ ${durationLabel(remaining)}.` : null,
      tempsSentence(data),
      stale ? 'Dernier relevé connu.' : null,
    ]
      .filter(Boolean)
      .join(' ');
  } else if (data.printState && data.printState !== 'standby') {
    // complete, cancelled, error : le dernier job, pas l’état courant.
    primaryValue = printLabels[data.printState] ?? data.printState;
    subtitle = data.filename ? shortName(data.filename) : null;
    summary = `${name} : impression ${primaryValue.toLowerCase()}${data.filename ? ` « ${shortName(data.filename)} »` : ''}.${stale}`;
  } else {
    // Prête et au repos.
    primaryValue = klipperLabels.ready!;
    subtitle = data.homedAxes ? `Axes ${data.homedAxes}` : null;
    summary = [`${name} est prête.`, tempsSentence(data), stale ? 'Dernier relevé connu.' : null]
      .filter(Boolean)
      .join(' ');
  }

  return {
    title: name,
    primaryValue,
    subtitle,
    description,
    items,
    summary,
    sources: ['voron_status'],
  };
}

const addon: AddonDefinition<VoronConfig, VoronData> = {
  id: 'voron_status',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Imprimante (Moonraker)',
  display: {
    name: 'Imprimante 3D',
    description:
      'État en lecture seule d’une imprimante Klipper/Moonraker : impression en cours, avancement, températures.',
    icon: 'package',
    group: 'home',
    keywords: ['imprimante', '3d', 'voron', 'klipper', 'moonraker', 'filament', 'buse', 'gcode'],
    example: { label: 'Voron 2.4', ref: 'voron-2-4' },
    spoken: { head: 'l’imprimante', repeats: ['voron', 'imprimante', '3d'] },
  },
  secrets: [
    {
      name: 'moonrakerApiKey',
      env: 'CORNELIUS_MOONRAKER_API_KEY',
      label: 'une clé API Moonraker',
      url: 'https://moonraker.readthedocs.io/en/latest/web_api/#authentication',
      note: 'facultatif',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: { baseUrl: 'http://127.0.0.1:7125' },
  dataSchema,
  dataVersion: 1,
  freshMs,
  tools: [
    {
      name: 'read',
      description:
        'Lire l’état d’une imprimante 3D (Klipper/Moonraker) enregistrée comme source : prête, en impression avec avancement, en pause, terminée, températures de la buse et du lit. Affiche la carte de la source et renvoie un résumé à dire. Utiliser pour « que fait la Voron 2.4 ? », « l’impression est-elle terminée ? », « quelles sont les températures ? », « à combien de pourcent en est l’impression ? ». Lecture seule : aucune commande n’est envoyée à l’imprimante.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
        },
      },
    },
  ],
  async collect(context) {
    const baseUrl = context.config.baseUrl.replace(/\/+$/u, '');
    const apiKey = context.secret('moonrakerApiKey');
    const response = await context.http.fetch({
      url: `${baseUrl}/printer/objects/query`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-Api-Key': apiKey } : {}),
      },
      body: statusQuery,
      signal: context.signal,
      timeoutMs: requestTimeoutMs,
      maxBytes: maxResponseBytes,
    });
    if (response.status !== 200) throw statusError(response);
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      throw new AddonCollectError('malformed', 'Réponse de Moonraker illisible.', false);
    }
    const status = objectOf(objectOf(payload).result).status;
    if (!status || typeof status !== 'object')
      throw new AddonCollectError(
        'malformed',
        'Réponse de Moonraker sans état d’imprimante.',
        false,
      );
    const s = status as Record<string, unknown>;
    const webhooks = objectOf(s.webhooks);
    const printStats = objectOf(s.print_stats);
    const sdcard = objectOf(s.virtual_sdcard);
    const toolhead = objectOf(s.toolhead);
    const extruder = objectOf(s.extruder);
    const bed = objectOf(s.heater_bed);
    const klipperState = asText(webhooks.state, 40);
    if (!klipperState)
      throw new AddonCollectError('malformed', 'État de Klipper absent de la réponse.', false);
    const filamentMm = asNumber(printStats.filament_used, 0, 1e8);
    let host = 'moonraker';
    try {
      host = new URL(baseUrl).host;
    } catch {
      // L’adresse est déjà validée par le schéma de configuration.
    }
    return {
      data: {
        klipperState,
        klipperMessage: asText(webhooks.state_message, 300),
        printState: asText(printStats.state, 40),
        filename: asText(printStats.filename, 200),
        progress: asNumber(sdcard.progress, 0, 1),
        printDurationS: asNumber(printStats.print_duration, 0, 604800),
        filamentUsedM: filamentMm === null ? null : Math.round(filamentMm / 10) / 100,
        homedAxes: asText(toolhead.homed_axes, 10),
        nozzleTemp: asNumber(extruder.temperature, -20, 400),
        nozzleTarget: asNumber(extruder.target, 0, 400),
        bedTemp: asNumber(bed.temperature, -20, 200),
        bedTarget: asNumber(bed.target, 0, 200),
      },
      source: { provider: 'moonraker', sourceId: host },
    };
  },
  present,
};

export default addon;
