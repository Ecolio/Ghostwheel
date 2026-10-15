import {
  AddonCollectError,
  type AddonHttpClient,
  type AddonHttpRequest,
  type AddonHttpResponse,
} from '../../shared/addons.js';

const defaultTimeoutMs = 4000;
const defaultMaxBytes = 256 * 1024;

/** Seules les destinations http(s) sans identifiants embarqués sont utilisables. */
export function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AddonCollectError('invalid_params', 'Adresse invalide.', false);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AddonCollectError(
      'invalid_params',
      'Seules les adresses http(s) sont autorisées.',
      false,
    );
  if (url.username || url.password)
    throw new AddonCollectError('invalid_params', 'Adresse avec identifiants refusée.', false);
  return url;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    chunks.push(value);
    if (size >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const buffer = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, buffer.byteLength - offset));
    buffer.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= buffer.byteLength) break;
  }
  return new TextDecoder().decode(buffer);
}

// Échecs de connexion : la requête n'a jamais quitté le serveur.
const connectFailures = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

/** Raison d'une requête refusée avant tout envoi (en-tête mal formé, corps interdit…). */
function invalidRequest(message: string): string {
  const header = /"([^"]*)" is an invalid header name/u.exec(message);
  if (header) return `Requête invalide : nom d’en-tête « ${header[1]} » refusé.`;
  if (/invalid header value/u.test(message))
    return 'Requête invalide : valeur d’en-tête refusée (retour à la ligne ou caractère interdit).';
  if (/cannot have body/u.test(message))
    return 'Requête invalide : une requête GET ne peut pas avoir de corps.';
  return 'Requête invalide : elle a été refusée avant l’envoi.';
}

/**
 * Distingue trois échecs : requête invalide (rien n'est parti), destination injoignable
 * (connexion impossible, rien n'est parti) et connexion coupée en route (résultat incertain).
 */
export function networkFailure(error: unknown): AddonCollectError {
  if (error instanceof TypeError && error.message !== 'fetch failed')
    return new AddonCollectError('invalid_params', invalidRequest(error.message), false);
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (connectFailures.has(code) || code.startsWith('ERR_TLS') || cause?.message === 'bad port')
    return new AddonCollectError('unavailable', 'Source réseau injoignable.', true);
  return new AddonCollectError('upstream', 'Connexion interrompue avant la réponse.', true);
}

/** Client réseau unique du cœur : délai borné, taille bornée, aucune redirection. */
export function createHttpClient(): AddonHttpClient {
  return {
    async fetch(request: AddonHttpRequest): Promise<AddonHttpResponse> {
      if (request.signal?.aborted)
        throw new AddonCollectError('unavailable', 'Collecte annulée.', true);
      const target = safeUrl(request.url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? defaultTimeoutMs);
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(target, {
          method: request.method ?? 'GET',
          headers: request.headers,
          body: request.body,
          redirect: 'error',
          signal: controller.signal,
        });
        const text = await readBounded(response, request.maxBytes ?? defaultMaxBytes);
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          text: () => text,
          json: () => JSON.parse(text) as unknown,
        };
      } catch (error) {
        if (error instanceof AddonCollectError) throw error;
        if ((error as Error).name === 'AbortError') {
          if (request.signal?.aborted)
            throw new AddonCollectError('unavailable', 'Collecte annulée.', true);
          throw new AddonCollectError('timeout', 'La source n’a pas répondu à temps.', true);
        }
        throw networkFailure(error);
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
