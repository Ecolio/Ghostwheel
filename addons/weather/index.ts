import {
  AddonCollectError,
  type AddonDefinition,
  type AddonPresentContext,
  type AddonPresentation,
  type ModuleSnapshot,
} from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type WeatherConfig = {
  insee: string | null;
  lat: number | null;
  lon: number | null;
  days: number;
};

type WeatherDay = {
  date: string;
  tmin: number;
  tmax: number;
  summary: string;
  rainProbability: number;
  windKmh: number;
};

type WeatherData = { city: string; days: WeatherDay[] };

const baseUrl = 'https://api.meteo-concept.com/api';

const skyLabels = [
  'Soleil',
  'Peu nuageux',
  'Ciel voilé',
  'Nuageux',
  'Très nuageux',
  'Couvert',
  'Brouillard',
  'Brouillard givrant',
];

/** Table officielle des codes « temps sensible » (annexe Météo Concept, codes 0 à 235). */
export function weatherLabel(code: unknown): string {
  const value = typeof code === 'number' ? code : Number.NaN;
  if (!Number.isFinite(value)) return 'Conditions variables';
  if (Number.isInteger(value) && value >= 0 && value <= 7) return skyLabels[value]!;
  if (value >= 10 && value <= 12) return 'Pluie';
  if (value >= 13 && value <= 15) return 'Pluie verglaçante';
  if (value === 16) return 'Bruine';
  if (value >= 20 && value <= 22) return 'Neige';
  if (value >= 30 && value <= 32) return 'Pluie et neige mêlées';
  if (value >= 40 && value <= 48) return 'Averses de pluie';
  if (value >= 60 && value <= 68) return 'Averses de neige';
  if (value >= 70 && value <= 78) return 'Averses de pluie et neige mêlées';
  if (value >= 100 && value <= 108) return 'Orages';
  if (value >= 120 && value <= 128) return 'Orages de neige ou grésil';
  if (value >= 130 && value <= 138) return 'Orages de pluie et neige mêlées';
  if (value === 140 || value === 141) return 'Pluies orageuses';
  if (value === 142) return 'Neige orageuse';
  if (value >= 210 && value <= 212) return 'Pluie intermittente';
  if (value >= 220 && value <= 222) return 'Neige intermittente';
  if (value >= 230 && value <= 232) return 'Pluie et neige mêlées';
  if (value === 235) return 'Averses de grêle';
  return 'Conditions variables';
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new AddonCollectError('malformed', 'Prévision Météo Concept incomplète.', false);
  return Math.round(value);
}

function asDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(value);
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

/** Jour civil du foyer, au format AAAA-MM-JJ. */
function localDate(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Prévisions d'aujourd'hui et des jours suivants : un relevé de la veille perd son premier jour. */
function currentDays(data: WeatherData, context: AddonPresentContext): WeatherDay[] {
  const today = localDate(context.now(), context.timeZone);
  const days = data.days.filter((day) => day.date >= today);
  return days.length ? days : data.days.slice(-1);
}

/** Minuit suivant dans le fuseau du foyer : la carte permanente change alors de jour. */
function nextMidnight(context: AddonPresentContext): string {
  const today = localDate(context.now(), context.timeZone);
  for (let hours = 1; hours <= 26; hours += 1) {
    const candidate = Math.floor(context.now() / 3_600_000 + hours) * 3_600_000;
    if (localDate(candidate, context.timeZone) !== today) return new Date(candidate).toISOString();
  }
  return new Date(context.now() + 86_400_000).toISOString();
}

function present(
  snapshot: ModuleSnapshot<WeatherData>,
  context: AddonPresentContext,
): AddonPresentation {
  const data = snapshot.data!;
  const days = currentDays(data, context);
  const today = days[0];
  if (!today) throw new Error('Aucune prévision à présenter.');
  const items = days.slice(1, 6).map((day) => ({
    label: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(day.date + 'T12:00:00Z'),
    ),
    value: `${day.tmin} / ${day.tmax} °C · ${day.summary}`,
  }));
  const summary = [
    `Météo à ${data.city} : ${today.tmin} / ${today.tmax} °C, ${today.summary.toLowerCase()}.`,
    today.rainProbability >= 40 ? `Risque de pluie ${today.rainProbability} %.` : null,
    items[0] ? `Demain ${items[0].value}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    title: 'Météo',
    primaryValue: `${today.tmin} / ${today.tmax} °C`,
    subtitle: `${data.city} · ${today.summary}`,
    description: snapshot.status === 'stale' ? 'Dernier relevé connu.' : null,
    items,
    summary,
    sources: ['weather'],
  };
}

const addon: AddonDefinition<WeatherConfig, WeatherData> = {
  id: 'weather',
  apiVersion: 1,
  version: '1.1.0',
  sourceLabel: 'Météo Concept',
  display: {
    name: 'Météo',
    description: 'Prévisions pour les lieux qui comptent pour vous.',
    icon: 'cloud-sun',
    keywords: ['météo', 'temps', 'prévisions', 'pluie', 'soleil', 'température'],
    example: { label: 'Météo à la maison', ref: 'maison' },
    spoken: { head: 'la météo', repeats: ['meteo', 'temps', 'previsions'] },
  },
  secrets: [
    {
      name: 'meteoConceptToken',
      env: 'CORNELIUS_METEO_CONCEPT_TOKEN',
      label: 'un jeton Météo Concept',
      url: 'https://api.meteo-concept.com/',
      note: 'gratuit',
    },
  ],
  configVersion: 1,
  configSchema,
  configDefaults: { insee: null, lat: null, lon: null, days: 3 },
  dataSchema,
  dataVersion: 1,
  freshMs: 30 * 60_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire les prévisions météo quotidiennes enregistrées pour ce foyer ou ce profil, et afficher la carte météo. Utiliser pour « la météo », « quel temps fait-il », « et demain ? ».',
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
    const config = context.config;
    const token = context.secret('meteoConceptToken');
    if (!token)
      throw new AddonCollectError('config_invalid', 'Jeton Météo Concept non configuré.', false);
    const params = new URLSearchParams();
    const hasInsee = typeof config.insee === 'string' && config.insee.length > 0;
    const hasCoordinates = typeof config.lat === 'number' && typeof config.lon === 'number';
    if (hasInsee) params.set('insee', config.insee!);
    else if (hasCoordinates) params.set('latlng', `${config.lat},${config.lon}`);
    else
      throw new AddonCollectError(
        'config_invalid',
        'Renseignez un code INSEE ou des coordonnées pour cette instance météo.',
        false,
      );
    const response = await context.http.fetch({
      url: `${baseUrl}/forecast/daily?${params.toString()}`,
      headers: { Authorization: 'Bearer ' + token },
      signal: context.signal,
      timeoutMs: 4000,
    });
    if (response.status === 401 || response.status === 403)
      throw new AddonCollectError('auth', 'Jeton Météo Concept refusé.', false);
    if (response.status === 400)
      throw new AddonCollectError(
        'quota',
        'Quota Météo Concept dépassé ou requête refusée.',
        false,
      );
    if (response.status === 503)
      throw new AddonCollectError('unavailable', 'Météo Concept est indisponible.', true);
    if (response.status !== 200)
      throw new AddonCollectError(
        'upstream',
        `Météo Concept a répondu ${response.status}.`,
        response.status >= 500,
      );
    let payload: { city?: { name?: unknown }; forecast?: unknown[] };
    try {
      payload = response.json() as typeof payload;
    } catch {
      throw new AddonCollectError('malformed', 'Réponse Météo Concept illisible.', false);
    }
    if (!payload || !Array.isArray(payload.forecast))
      throw new AddonCollectError('malformed', 'Réponse Météo Concept sans prévisions.', false);
    const days: WeatherDay[] = [];
    for (const entry of payload.forecast) {
      const row = (entry ?? {}) as Record<string, unknown>;
      const date = asDate(row.datetime);
      if (!date)
        throw new AddonCollectError(
          'malformed',
          'Date de prévision Météo Concept invalide.',
          false,
        );
      days.push({
        date,
        tmin: asNumber(row.tmin),
        tmax: asNumber(row.tmax),
        summary: weatherLabel(row.weather),
        rainProbability: asNumber(row.probarain),
        windKmh: asNumber(row.wind10m),
      });
    }
    const city =
      typeof payload.city?.name === 'string' && payload.city.name.trim()
        ? payload.city.name.trim().slice(0, 80)
        : 'votre commune';
    // L'API renvoie toujours 14 jours : on ne conserve que ce qui est configuré.
    const kept = days.slice(0, Math.min(7, Math.max(1, config.days)));
    if (kept.length === 0)
      return {
        data: { city, days: [] },
        empty: true,
        source: { provider: 'meteo-concept', sourceId: city },
      };
    return { data: { city, days: kept }, source: { provider: 'meteo-concept', sourceId: city } };
  },
  ambient: {
    present(snapshot, context) {
      const card = present(snapshot, context);
      return {
        layout: 'metric',
        title: 'Météo',
        value: card.primaryValue,
        subtitle: card.subtitle?.slice(0, 120) ?? null,
        items: [],
        // À minuit, la prévision du jour devient celle de la veille : la carte passe au lendemain.
        refreshAt: nextMidnight(context),
      };
    },
  },
  present,
};

export default addon;
