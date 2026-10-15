type ClientLog = {
  event: string;
  stage: string;
  name?: string;
  message?: string;
  interactionId?: string;
};

// Une ouverture de session produit une dizaine de diagnostics d’un coup : ils partent
// groupés pour ne pas épuiser la limite de requêtes du serveur et perdre des mesures.
const flushDelayMs = 1000;
const maxBatch = 50;
const maxPending = 200;
const pending: ClientLog[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Envoie tout de suite les diagnostics en attente (erreur, fermeture de la page, tests). */
export function flushDiagnostics() {
  if (timer) clearTimeout(timer);
  timer = null;
  while (pending.length) {
    const entries = pending.splice(0, maxBatch);
    // Best effort only: failure to log must never interrupt or retry a paid session.
    void fetch('/api/client-logs', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  }
}

function enqueue(entry: ClientLog, immediate = false) {
  pending.push(entry);
  if (pending.length > maxPending) pending.splice(0, pending.length - maxPending);
  if (immediate || pending.length >= maxBatch) flushDiagnostics();
  else timer ??= setTimeout(flushDiagnostics, flushDelayMs);
}

if (typeof window !== 'undefined') window.addEventListener?.('pagehide', flushDiagnostics);

export function reportDiagnostic(
  event: string,
  stage: string,
  error?: unknown,
  interactionId?: string,
) {
  const details: ClientLog = {
    event,
    stage,
    ...(interactionId ? { interactionId } : {}),
    ...(error instanceof Error ? { name: error.name, message: error.message.slice(0, 500) } : {}),
  };
  if (event === 'error') console.error('[Cornelius]', details);
  enqueue(details, event === 'error');
}

export function reportMeasure(name: string, value: number, interactionId?: string) {
  // The diagnostic schema accepts text fields only: the numeric value travels in message.
  enqueue({
    event: 'mesure',
    stage: 'mesure',
    name,
    message: JSON.stringify({ value }),
    ...(interactionId ? { interactionId } : {}),
  });
}
