import {
  AddonCollectError,
  type AddonDefinition,
  type AddonPresentContext,
  type ModuleSnapshot,
} from '#cornelius/addons';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type ClockConfig = { timeZone: string; showDate: boolean; showSeconds: boolean };
type ClockData = ClockConfig;

function formatClock(snapshot: ModuleSnapshot<ClockData>, context: AddonPresentContext) {
  const data = snapshot.data;
  if (!data) throw new Error('Aucune configuration d’horloge à présenter.');
  // Les paramètres sont mis en cache ; l'heure avance même sans nouvelle collecte.
  const now = context.now();
  const time = new Intl.DateTimeFormat('fr-FR', {
    timeZone: data.timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    ...(data.showSeconds ? { second: '2-digit' as const } : {}),
  }).format(now);
  const date = new Intl.DateTimeFormat('fr-FR', {
    timeZone: data.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return { time, date, data };
}

const addon: AddonDefinition<ClockConfig, ClockData> = {
  id: 'clock',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Horloge locale',
  display: {
    name: 'Heure',
    description: 'Heure locale et date, avec le fuseau horaire de votre choix.',
    icon: 'clock',
    keywords: ['heure', 'horloge', 'date', 'fuseau horaire'],
    example: { label: 'Heure de Paris', ref: 'paris' },
    spoken: { head: 'l’heure', repeats: ['heure', 'horloge'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: { timeZone: 'Europe/Paris', showDate: true, showSeconds: false },
  dataVersion: 1,
  dataSchema,
  freshMs: 3_600_000,
  tools: [
    {
      name: 'read',
      description:
        'Lire l’heure actuelle et la date du jour dans le fuseau de la source configurée, et afficher la carte horloge. ' +
        'Utiliser pour « quelle heure est-il ? », « quelle est la date aujourd’hui ? », « affiche l’heure ».',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef'],
        properties: { instanceRef: { type: ['string', 'null'] } },
      },
    },
  ],
  async collect(context) {
    const timeZone = context.config.timeZone.trim();
    try {
      new Intl.DateTimeFormat('fr-FR', { timeZone }).format(context.now());
    } catch {
      throw new AddonCollectError(
        'config_invalid',
        'Fuseau horaire inconnu. Utilisez par exemple Europe/Paris ou UTC.',
      );
    }
    return {
      data: { ...context.config, timeZone },
      source: { provider: 'local-clock', sourceId: timeZone },
    };
  },
  present(snapshot, context) {
    const { time, date, data } = formatClock(snapshot, context);
    return {
      title: 'Heure',
      primaryValue: time,
      subtitle: (data.showDate ? `${date} · ${data.timeZone}` : data.timeZone).slice(0, 120),
      description: 'Heure du serveur Cornelius.',
      items: [],
      // La date reste disponible pour une question vocale même si elle est masquée à l'écran.
      summary: `Il est ${time}, ${date}, dans le fuseau ${data.timeZone}.`,
      sources: ['clock'],
    };
  },
  ambient: {
    present(snapshot, context) {
      const { time, date, data } = formatClock(snapshot, context);
      return {
        layout: 'metric',
        title: 'Heure',
        value: time,
        subtitle: data.showDate ? date : null,
        items: [],
        showCollectedAt: false,
      };
    },
  },
};

export default addon;
