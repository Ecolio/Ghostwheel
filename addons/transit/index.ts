import {
  AddonCollectError,
  type AddonDefinition,
  type AddonHttpClient,
  type AddonPresentation,
  type ModuleSnapshot,
} from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type TransitConfig = {
  stopAreaId: string;
  stopAreaLabel: string;
  routeId: string | null;
  routeLabel: string | null;
};

type Departure = {
  id: string;
  scheduledAt: string | null;
  expectedAt: string | null;
  realtime: boolean;
  cancelled: boolean;
  lineLabel?: string;
  direction?: string;
};

type TransitData = {
  stopId: string;
  lineLabel: string;
  direction: string;
  departures: Departure[];
};

/** Référentiel et horaires temps réel Île-de-France Mobilités (Navitia hébergé par PRIM). */
const baseUrl = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
const segment = (value: string): string => encodeURIComponent(value).replace(/%3A/giu, ':');
/**
 * Navitia joint d’ordinaire le tracé de chaque ligne : sans lui (disable_geojson), une réponse
 * tient en quelques dizaines de kilo-octets. La marge couvre les gros pôles d’échange.
 */
const maxBytes = 4 * 1024 * 1024;

async function navitia(
  http: AddonHttpClient,
  token: string,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await http.fetch({
    url,
    headers: { apikey: token },
    signal,
    timeoutMs: 5000,
    maxBytes,
  });
  if (response.status === 401) throw new AddonCollectError('auth', 'Jeton PRIM refusé.', false);
  if (response.status === 403)
    throw new AddonCollectError('forbidden', 'Accès PRIM refusé pour cette API.', false);
  if (response.status === 404)
    throw new AddonCollectError('not_found', 'Arrêt ou ligne introuvable chez PRIM.', false);
  if (response.status === 429) throw new AddonCollectError('quota', 'Quota PRIM dépassé.', true);
  if (response.status === 400)
    throw new AddonCollectError('invalid_params', 'PRIM a refusé la requête.', false);
  if (response.status >= 500)
    throw new AddonCollectError('unavailable', 'PRIM est indisponible.', true);
  if (response.status !== 200)
    throw new AddonCollectError('upstream', `PRIM a répondu ${response.status}.`, false);
  try {
    return response.json();
  } catch {
    const body = response.text();
    // Une réponse coupée à la taille maximale n’est pas du JSON valide : le dire tel quel.
    if (Buffer.byteLength(body) >= maxBytes - 4)
      throw new AddonCollectError('malformed', 'Réponse PRIM trop volumineuse.', false);
    if (body.trimStart().startsWith('<'))
      throw new AddonCollectError(
        'malformed',
        'Réponse PRIM illisible : une page web au lieu des données.',
        true,
      );
    throw new AddonCollectError('malformed', 'Réponse PRIM illisible.', false);
  }
}

const parisDateTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Horodatage local Navitia : vérifie les composantes et l'offset, y compris aux changements d'heure. */
function parisToIso(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u.exec(value);
  if (!match) return null;
  const wanted = match.slice(1).map(Number);
  const target = Date.UTC(
    wanted[0]!,
    wanted[1]! - 1,
    wanted[2]!,
    wanted[3]!,
    wanted[4]!,
    wanted[5]!,
  );
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = parisDateTime.formatToParts(new Date(guess));
    const local = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((type) =>
      Number(parts.find((entry) => entry.type === type)?.value),
    );
    if (local.every((part, index) => part === wanted[index])) return new Date(guess).toISOString();
    const localTime = Date.UTC(
      local[0]!,
      local[1]! - 1,
      local[2]!,
      local[3]!,
      local[4]!,
      local[5]!,
    );
    guess += target - localTime;
  }
  return null;
}

function timeOf(departure: Departure): number {
  const raw = departure.expectedAt ?? departure.scheduledAt;
  const time = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function minutesOf(departure: Departure, now: number): number {
  const time = timeOf(departure);
  if (!Number.isFinite(time) || time === Number.MAX_SAFE_INTEGER) return 0;
  return Math.max(0, Math.round((time - now) / 60_000));
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

function present(
  snapshot: ModuleSnapshot<TransitData>,
  context: { now(): number },
): AddonPresentation {
  const data = snapshot.data!;
  const now = context.now();
  const upcoming = data.departures
    .filter((departure) => !departure.cancelled && timeOf(departure) >= now)
    .sort((a, b) => timeOf(a) - timeOf(b));
  const next = upcoming[0];
  if (!next)
    return {
      title: 'Mes bus',
      primaryValue: null,
      subtitle: `Ligne ${data.lineLabel} → ${data.direction}`.slice(0, 120),
      description: 'Les derniers horaires connus sont dépassés.',
      items: [],
      summary:
        'Les derniers horaires connus sont dépassés ; aucun prochain passage ne peut être confirmé.',
      sources: ['transit'],
    };
  const lineLabel = next.lineLabel ?? data.lineLabel;
  const direction = next.direction ?? data.direction;
  const items = upcoming.slice(0, 3).map((departure, index) => ({
    label: index === 0 ? 'Prochain' : index === 1 ? 'Suivant' : 'Puis',
    value: `${minutesOf(departure, now)} min${
      departure.expectedAt ? ` · ${clock(departure.expectedAt)}` : ''
    }${
      (departure.lineLabel ?? data.lineLabel) !== lineLabel ||
      (departure.direction ?? data.direction) !== direction
        ? ` · ${departure.lineLabel ?? data.lineLabel} → ${departure.direction ?? data.direction}`
        : ''
    }`.slice(0, 160),
  }));
  const cancelled = data.departures.filter((departure) => departure.cancelled).length;
  const summary = [
    `Prochain bus ${lineLabel} direction ${direction} dans ${minutesOf(next, now)} minutes${next.realtime ? '' : ' (horaire théorique)'}.`,
    items[1] ? `Ensuite ${items[1].value.replace(' · ', ' à ')}.` : null,
    cancelled > 0
      ? `${cancelled} passage${cancelled > 1 ? 's' : ''} supprimé${cancelled > 1 ? 's' : ''}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: 'Mes bus',
    primaryValue: `${minutesOf(next, now)} min`,
    subtitle: `Ligne ${lineLabel} → ${direction}`.slice(0, 120),
    description: snapshot.status === 'stale' ? 'Dernier horaire connu.' : null,
    items,
    summary,
    sources: ['transit'],
  };
}

const addon: AddonDefinition<TransitConfig, TransitData> = {
  id: 'transit',
  apiVersion: 1,
  version: '2.1.1',
  sourceLabel: 'Île-de-France Mobilités',
  secrets: [
    {
      name: 'primApiKey',
      env: 'CORNELIUS_PRIM_API_KEY',
      label: 'un jeton PRIM d’Île-de-France Mobilités',
      url: 'https://prim.iledefrance-mobilites.fr/',
      note: 'gratuit',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: { stopAreaId: '', stopAreaLabel: '', routeId: null, routeLabel: null },
  dataSchema,
  dataVersion: 1,
  freshMs: 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prochains passages de bus enregistrés et afficher la carte des bus. Utiliser pour « mon bus », « affiche mes bus », « prochain passage ».',
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
  search: {
    fields: [
      {
        kind: 'place',
        label: 'Arrêt',
        target: 'stopAreaId',
        labelTarget: 'stopAreaLabel',
        placeholder: 'Nom de l’arrêt ou de la rue',
      },
      {
        kind: 'route',
        label: 'Direction',
        target: 'routeId',
        labelTarget: 'routeLabel',
        dependsOn: 'stopAreaId',
        placeholder: 'Ligne ou destination',
      },
    ],
    async find(input, context) {
      const token = context.secret('primApiKey');
      if (!token) throw new AddonCollectError('config_invalid', 'Jeton PRIM non configuré.', false);
      if (input.kind === 'place') {
        const query = (input.query ?? '').trim();
        if (query.length < 3) return [];
        const body = record(
          await navitia(
            context.http,
            token,
            `${baseUrl}/places?q=${encodeURIComponent(query)}&type[]=stop_area&count=8&disable_geojson=true`,
            context.signal,
          ),
        );
        return asArray(body.places)
          .filter((entry) => record(entry).embedded_type === 'stop_area')
          .map((entry) => {
            const place = record(entry);
            const embedded = record(place[String(place.embedded_type ?? 'stop_area')]);
            const region = record(asArray(place.administrative_regions)[0]);
            const label = text(embedded.label) ?? text(place.name) ?? text(place.id) ?? '';
            const detail = [text(region.name), text(region.insee)].filter(Boolean).join(' · ');
            return { id: String(place.id ?? ''), label, detail: detail || undefined };
          })
          .filter((place) => place.id)
          .slice(0, 8);
      }
      if (input.kind === 'route') {
        const stopAreaId = String(input.values.stopAreaId ?? '').trim();
        if (!stopAreaId) return [];
        const query = (input.query ?? '').trim().toLowerCase();
        const body = record(
          await navitia(
            context.http,
            token,
            `${baseUrl}/stop_areas/${segment(stopAreaId)}/routes?count=50&disable_geojson=true`,
            context.signal,
          ),
        );
        return asArray(body.routes)
          .map((entry) => {
            const route = record(entry);
            const line = record(route.line);
            const direction = record(route.direction);
            const lineLabel = text(line.code) ?? text(line.name) ?? 'ligne';
            const directionLabel =
              text(direction.name) ?? text(direction.label) ?? 'direction inconnue';
            return { id: String(route.id ?? ''), label: `${lineLabel} → ${directionLabel}` };
          })
          .filter((route) => route.id && (!query || route.label.toLowerCase().includes(query)))
          .slice(0, 50);
      }
      return [];
    },
  },
  async collect(context) {
    const config = context.config;
    const token = context.secret('primApiKey');
    if (!token) throw new AddonCollectError('config_invalid', 'Jeton PRIM non configuré.', false);
    const stopAreaId = config.stopAreaId.trim();
    if (!stopAreaId)
      throw new AddonCollectError(
        'config_invalid',
        'Choisissez un arrêt dans la recherche assistée.',
        false,
      );
    const routeFilter = config.routeId?.trim() || null;
    const routePath = routeFilter ? `/routes/${segment(routeFilter)}` : '';
    const body = record(
      await navitia(
        context.http,
        token,
        `${baseUrl}/stop_areas/${segment(stopAreaId)}${routePath}/departures?data_freshness=realtime&count=16&disable_geojson=true`,
        context.signal,
      ),
    );
    if (!Array.isArray(body.departures))
      throw new AddonCollectError('malformed', 'Réponse PRIM sans liste de passages.', false);
    let lineLabel = routeFilter ? ((config.routeLabel ?? '').split(' → ')[0] ?? '') : '';
    let direction = routeFilter ? ((config.routeLabel ?? '').split(' → ')[1] ?? '') : '';
    let firstLine: string | null = null;
    let firstDirection: string | null = null;
    const departures: Departure[] = [];
    for (const entry of asArray(body.departures)) {
      const item = record(entry);
      const route = record(item.route);
      const routeId = text(route.id);
      if (routeFilter && routeId !== routeFilter) continue;
      const display = record(item.display_informations);
      const stopDate = record(item.stop_date_time);
      const info = [
        ...asArray(item.additional_informations),
        ...asArray(stopDate.additional_informations),
      ].map((value) => String(value).toLowerCase());
      const expectedRaw = text(stopDate.departure_date_time);
      const scheduledAt = parisToIso(text(stopDate.base_departure_date_time));
      const expectedAt = parisToIso(expectedRaw);
      if (expectedRaw && !expectedAt)
        throw new AddonCollectError('malformed', 'Date de passage PRIM invalide.', false);
      const cancelled =
        !expectedRaw || info.some((value) => value.includes('cancel') || value.includes('delet'));
      firstLine ??= text(display.label) ?? text(display.code);
      firstDirection ??= text(display.direction) ?? text(record(route.direction).name);
      const stopPoint = text(record(item.stop_point).id) ?? '';
      departures.push({
        id: `${routeId ?? 'route'}:${stopPoint}:${expectedRaw ?? scheduledAt ?? departures.length}`.slice(
          0,
          128,
        ),
        scheduledAt,
        expectedAt,
        realtime: text(stopDate.data_freshness) === 'realtime',
        cancelled,
        lineLabel: (text(display.label) ?? text(display.code) ?? 'ligne').slice(0, 80),
        direction: (
          text(display.direction) ??
          text(record(route.direction).name) ??
          'direction inconnue'
        ).slice(0, 120),
      });
    }
    if (!lineLabel) lineLabel = firstLine ?? 'ligne';
    if (!direction) direction = firstDirection ?? 'direction inconnue';
    const data: TransitData = {
      stopId: stopAreaId.slice(0, 128),
      lineLabel: lineLabel.slice(0, 80),
      direction: direction.slice(0, 120),
      departures: departures
        .sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || timeOf(a) - timeOf(b))
        .slice(0, 6),
    };
    return {
      data,
      empty: data.departures.filter((departure) => !departure.cancelled).length === 0,
      source: { provider: 'prim-idfm', sourceId: data.stopId },
    };
  },
  ambient: {
    present(snapshot, context) {
      const card = present(snapshot, context);
      return {
        layout: 'list',
        title: 'Prochains bus',
        value: null,
        subtitle: card.subtitle,
        items: card.items.slice(0, 3),
      };
    },
  },
  present,
};

export default addon;
