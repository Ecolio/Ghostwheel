/** Ragator : réponses citées tirées d'un corpus de vidéos YouTube, par son interface web locale. */
import { AddonCollectError, type AddonDefinition, type AddonHttpResponse } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type RagatorConfig = { baseUrl: string; collection: string | null; detailed: boolean };

type RagatorSource = {
  videoId: string;
  title: string;
  startS: number | null;
  publishedAt: string | null;
  link: string;
};

type RagatorData =
  | {
      kind: 'answer';
      question: string;
      answer: string;
      refused: boolean;
      route: string;
      degradedReason: string | null;
      sources: RagatorSource[];
    }
  | { kind: 'status'; videos: number; collections: number; collection: string | null };

/** Réponse de `POST /api/ask` : seuls les champs utilisés sont contrôlés. */
type AskPayload = {
  answer: string;
  refused: boolean;
  route: string;
  degradedReason: string | null;
  sources: {
    videoId: string;
    title: string;
    startS: number | null;
    publishedAt: string | null;
    link: string;
  }[];
};

type CollectionsPayload = { collections: { key: string; name: string; videos: number }[] };

const validateAsk = compile<AskPayload>({
  type: 'object',
  required: ['answer', 'refused', 'route', 'sources'],
  properties: {
    answer: { type: 'string' },
    refused: { type: 'boolean' },
    route: { type: 'string', minLength: 1, maxLength: 32 },
    degradedReason: { type: ['string', 'null'] },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        required: ['videoId', 'title', 'startS', 'publishedAt', 'link'],
        properties: {
          videoId: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$' },
          title: { type: 'string', minLength: 1 },
          startS: { type: ['number', 'null'], minimum: 0 },
          publishedAt: { type: ['string', 'null'] },
          link: { type: 'string', pattern: '^https://' },
        },
      },
    },
  },
});

const validateCollections = compile<CollectionsPayload>({
  type: 'object',
  required: ['collections'],
  properties: {
    collections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'name', 'videos'],
        properties: {
          key: { type: 'string', minLength: 1 },
          name: { type: 'string', minLength: 1 },
          videos: { type: 'integer', minimum: 0 },
        },
      },
    },
  },
});

/** Une question générale peut demander une minute en mode local de Ragator. */
const askTimeoutMs = 60_000;
const maxQuestionChars = 1000;

/** Citations `[Gu8bnHQaG5s:t00062 @ 03:45]` : utiles à l'écran de Ragator, pas à l'oral. */
function withoutCitations(text: string): string {
  return text
    .replace(/\s*\[[A-Za-z0-9_:-]{4,40}(?:\s*@\s*[0-9:]+(?:\s*[–-]\s*[0-9:]+)?)?\]/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .trim();
}

/** Coupe au plus près d'une fin de phrase, sinon au dernier mot, avec des points de suspension. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  if (sentence >= max / 2) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return `${(word >= max / 2 ? head.slice(0, word) : head).trimEnd()}…`;
}

function timestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function frenchDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function sourceLine(source: RagatorSource): { label: string; value: string } {
  const parts = [
    source.startS === null ? null : `à ${timestamp(source.startS)}`,
    source.publishedAt ? `vidéo du ${frenchDate(source.publishedAt)}` : null,
  ].filter((part): part is string => part !== null);
  return {
    label: clip(source.title, 80),
    value: parts.length ? parts.join(' · ') : 'Vidéo citée',
  };
}

/** Traduit un statut d'erreur de Ragator ; son message brut n'est jamais repris. */
function statusError(response: AddonHttpResponse, collection: string | null): AddonCollectError {
  if (response.status === 401)
    return new AddonCollectError(
      'auth',
      'Ragator demande un mot de passe (RAGATOR_PASSWORD) : ce module ne le gère pas encore.',
    );
  if (response.status === 403)
    return new AddonCollectError(
      'forbidden',
      'Ragator refuse cette adresse : ajoutez-la à RAGATOR_HOSTS côté Ragator.',
    );
  if (response.status === 429)
    return new AddonCollectError('quota', 'Ragator traite déjà trop de questions.', true);
  if (response.status === 400 && collection) {
    let message = '';
    try {
      message = String((response.json() as { error?: unknown }).error ?? '');
    } catch {
      // Corps illisible : le cas général s'applique.
    }
    if (message.startsWith('collection inconnue'))
      return new AddonCollectError(
        'not_found',
        `Collection « ${collection} » inconnue de Ragator.`,
      );
  }
  if (response.status === 400 || response.status === 413)
    return new AddonCollectError('invalid_params', 'Ragator a refusé la question.');
  if (response.status === 404)
    return new AddonCollectError('not_found', 'Aucune interface Ragator à cette adresse.');
  if (response.status >= 500)
    return new AddonCollectError('unavailable', 'Ragator a rencontré une erreur.', true);
  return new AddonCollectError(
    'upstream',
    `Réponse HTTP ${response.status} inattendue de Ragator.`,
  );
}

function payloadOf(response: AddonHttpResponse): unknown {
  try {
    return response.json();
  } catch {
    throw new AddonCollectError('malformed', 'Réponse de Ragator illisible.');
  }
}

const addon: AddonDefinition<RagatorConfig, RagatorData> = {
  id: 'ragator',
  apiVersion: 1,
  version: '1.0.0',
  sourceLabel: 'Ragator',
  configVersion: 1,
  configSchema,
  configDefaults: { baseUrl: 'http://127.0.0.1:3210', collection: null, detailed: false },
  dataVersion: 1,
  dataSchema,
  // Seul l'état du corpus (Tester) est gardé ; une réponse ne passe jamais par le cache.
  freshMs: 5 * 60_000,
  tools: [
    {
      name: 'ask',
      description:
        'Chercher une réponse dans les vidéos indexées par Ragator et afficher sa carte, avec ' +
        'les vidéos et l’instant qui la prouvent. Utiliser pour « dans quelle vidéo ils parlent ' +
        'de… », « comment ils ont fabriqué… », « la première fois qu’ils utilisent… », « toutes ' +
        'les vidéos sur… ». query : la question complète en français, sans pronom ni sous-entendu ' +
        '(« et dans la glacière ? » devient « à quoi sert le module Peltier de la glacière ? »). ' +
        'La réponse peut prendre une dizaine de secondes : prévenir avant d’appeler. Si Ragator ' +
        'dit ne pas savoir, le dire tel quel, sans compléter.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
          query: { type: 'string' },
        },
      },
      query: { maxLength: maxQuestionChars },
    },
  ],
  async collect(context) {
    const { baseUrl, collection, detailed } = context.config;
    if (context.query === undefined) {
      // Lecture ordinaire (Tester) : vérifier que Ragator répond et que la collection existe.
      const response = await context.http.fetch({
        url: `${baseUrl}/api/collections`,
        method: 'GET',
        signal: context.signal,
        timeoutMs: 8000,
        maxBytes: 64 * 1024,
      });
      if (response.status !== 200) throw statusError(response, null);
      const payload = payloadOf(response);
      if (!validateCollections(payload))
        throw new AddonCollectError('malformed', 'Liste des collections de Ragator invalide.');
      const fold = (value: string) =>
        value
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, '-')
          .replace(/^-|-$/gu, '');
      const chosen = collection
        ? payload.collections.find(
            (item) => item.key === collection || fold(item.name) === fold(collection),
          )
        : null;
      if (collection && !chosen)
        throw new AddonCollectError(
          'not_found',
          `Collection « ${collection} » inconnue de Ragator.`,
        );
      const videos = chosen
        ? chosen.videos
        : payload.collections.reduce((sum, item) => sum + item.videos, 0);
      return {
        data: {
          kind: 'status',
          videos,
          collections: payload.collections.length,
          collection: chosen ? clip(chosen.name, 120) : null,
        },
        empty: videos === 0,
        source: { provider: 'ragator', sourceId: chosen?.key ?? 'corpus' },
      };
    }

    const question = context.query.slice(0, maxQuestionChars);
    const response = await context.http.fetch({
      url: `${baseUrl}/api/ask`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        mode: detailed ? 'détaillé' : 'court',
        ...(collection ? { collection } : {}),
      }),
      signal: context.signal,
      timeoutMs: askTimeoutMs,
      // Les extraits des sources d'une question générale peuvent peser lourd.
      maxBytes: 2 * 1024 * 1024,
    });
    if (response.status !== 200) throw statusError(response, collection);
    const payload = payloadOf(response);
    if (!validateAsk(payload))
      throw new AddonCollectError('malformed', 'Réponse de Ragator incomplète.');
    const answer = clip(withoutCitations(payload.answer), 4000);
    if (!answer) throw new AddonCollectError('malformed', 'Réponse de Ragator vide.');
    // Une vidéo par ligne : la première source citée de chaque vidéo, dans l'ordre de Ragator.
    const seen = new Set<string>();
    const sources: RagatorSource[] = [];
    for (const source of payload.sources) {
      if (seen.has(source.videoId) || sources.length === 5) continue;
      seen.add(source.videoId);
      sources.push({
        videoId: source.videoId,
        title: clip(source.title, 300),
        startS:
          source.startS === null ? null : Math.min(86_400, Math.max(0, Math.floor(source.startS))),
        publishedAt:
          source.publishedAt && /^\d{4}-\d{2}-\d{2}/u.test(source.publishedAt)
            ? source.publishedAt.slice(0, 10)
            : null,
        link: source.link.slice(0, 500),
      });
    }
    return {
      data: {
        kind: 'answer',
        question,
        answer,
        refused: payload.refused,
        route: payload.route,
        degradedReason: payload.degradedReason ? clip(payload.degradedReason, 300) : null,
        sources,
      },
      source: { provider: 'ragator', sourceId: collection ?? 'corpus' },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucune réponse à présenter.');
    if (data.kind === 'status') {
      const scope = data.collection ?? 'tout le corpus';
      return {
        title: 'Ragator',
        primaryValue: `${data.videos} vidéo${data.videos > 1 ? 's' : ''}`,
        subtitle: clip(scope, 120),
        description: null,
        items: [],
        summary: `Ragator répond : ${data.videos} vidéos indexées pour ${scope}.`,
        sources: ['ragator'],
      };
    }
    const description = clip(data.answer, 500);
    const spoken = clip(data.answer, data.degradedReason ? 400 : 500);
    return {
      title: 'Ragator',
      primaryValue: null,
      subtitle: clip(data.question, 120),
      description,
      items: data.refused ? [] : data.sources.map(sourceLine),
      // Le repli de Ragator (recherche sans modèle, par exemple) est signalé à l'oral.
      summary: data.degradedReason ? `${spoken} (Réponse dégradée.)` : spoken,
      sources: ['ragator'],
    };
  },
};

export default addon;
