import { existsSync, readFileSync } from 'node:fs';

interface LogEntry {
  time?: string;
  source?: string;
  event?: string;
  details?: Record<string, unknown>;
}

interface Sample {
  name: string;
  value: number;
  at: number;
  reason?: string;
}

const file = process.argv[2] ?? 'data/logs/cornelius.log';

function entriesFrom(path: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const candidate of [path + '.3', path + '.2', path + '.1', path]) {
    if (!existsSync(candidate)) continue;
    for (const raw of readFileSync(candidate, 'utf8').split('\n')) {
      const line = raw.replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        /* Ignore a line torn by rotation. */
      }
    }
  }
  return entries;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function collect(entries: LogEntry[]): Sample[] {
  const samples: Sample[] = [];
  for (const entry of entries) {
    const details = entry.details ?? {};
    const at = Date.parse(String(entry.time ?? '')) || 0;
    if (entry.source === 'mesure' && typeof entry.event === 'string') {
      const value = finite(details.durationMs) ?? finite(details.seconds);
      const reason = typeof details.reason === 'string' ? details.reason : undefined;
      if (value !== null) samples.push({ name: entry.event, value, at, reason });
      continue;
    }
    if (details.event !== 'mesure' || typeof details.name !== 'string') continue;
    let value: number | null = null;
    if (typeof details.message === 'string') {
      try {
        value = finite((JSON.parse(details.message) as { value?: unknown }).value);
      } catch {
        value = null;
      }
    }
    if (value !== null) samples.push({ name: details.name, value, at });
  }
  return samples.sort((a, b) => a.at - b.at);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
}

function summary(values: number[]) {
  return {
    count: values.length,
    median: Math.round(percentile(values, 50)),
    mean: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    p95: Math.round(percentile(values, 95)),
    worst: values.length ? Math.round(Math.max(...values)) : 0,
  };
}

function share(values: number[], limit: number): number {
  if (values.length === 0) return 0;
  return Math.round((values.filter((value) => value < limit).length / values.length) * 100);
}

function verdict(pass: boolean): string {
  return pass ? 'OK' : 'À revoir';
}

const entries = entriesFrom(file);
if (entries.length === 0) {
  console.error(`Aucune entrée lisible dans ${file}. Lancez une conversation réelle.`);
  process.exit(1);
}
const samples = collect(entries);
const of = (name: string) => samples.filter((sample) => sample.name === name);
const values = (name: string) => of(name).map((sample) => sample.value);

const reaction = summary(values('reponse_latence'));
const reactionShare = share(values('reponse_latence'), 2000);
const interruption = summary(values('interruption'));
const interruptionShare = share(values('interruption'), 500);
const readiness = summary(values('engagement_pret'));
const openings = entries.filter(
  (entry) => entry.source === 'mesure' && entry.event === 'ouverture',
);
const closures = of('cloture');
const images = summary(values('images'));
const timeouts = closures.filter((sample) =>
  (sample.reason ?? '').includes('Connexion trop longue'),
);
const recognizedOpenings = openings.filter((entry) => Number(entry.details?.recognized) > 0).length;

console.log(`Mesures lues dans ${file} — ${samples.length} échantillons\n`);
console.log('| Domaine | Seuil | Résultat | État |');
console.log('|---|---|---|---|');
console.log('| Compréhension | ≥ 49/50 | à compter manuellement pendant la recette | manuel |');
console.log(
  `| Réactivité | < 2 s dans ≥ 95 % | p95 ${reaction.p95} ms, moyenne ${reaction.mean} ms, ${reactionShare} % sous 2 s (n=${reaction.count}) | ${verdict(reaction.count >= 20 && reactionShare >= 95)} |`,
);
console.log(
  `| Interruption | < 500 ms sur ≥ 19/20 | p95 ${interruption.p95} ms, ${interruptionShare} % sous 500 ms (n=${interruption.count}) | ${verdict(interruption.count >= 20 && interruptionShare >= 95)} |`,
);
console.log(
  `| Engagement → prêt | suivi | moyenne ${readiness.mean} ms, p95 ${readiness.p95} ms (n=${readiness.count}) | informatif |`,
);
for (const [name, label] of [
  ['detection_admission', 'Première détection → admission'],
  ['admission_pret', 'Admission → tunnel prêt'],
  ['detection_pret', 'Première détection → tunnel prêt'],
  ['wake_pret', 'Mot d’appel détecté → tunnel prêt'],
  ['audio_microphone', 'Attente microphone après admission'],
  ['audio_preparation_locale', 'Préparation locale après admission'],
  ['audio_reponse_serveur', 'Requête média → réponse serveur'],
  ['audio_webrtc_connecte', 'Démarrage navigateur → WebRTC connecté'],
  ['audio_openai', 'Requête média → session.started'],
  ['audio_demarrage', 'Démarrage navigateur → session.started'],
] as const) {
  const result = summary(values(name));
  const detail = result.count
    ? `médiane ${result.median} ms, p95 ${result.p95} ms (n=${result.count})`
    : 'aucun échantillon';
  console.log(`| ${label} | suivi | ${detail} | informatif |`);
}
for (const [name, label] of [
  ['vision_scene', 'Vision : analyse d’ouverture'],
  ['vision_tool', 'Vision : question visuelle'],
] as const) {
  const result = summary(values(name));
  const detail = result.count
    ? `médiane ${result.median} ms, p95 ${result.p95} ms, pire ${result.worst} ms (n=${result.count})`
    : 'aucun échantillon';
  console.log(`| ${label} | suivi | ${detail} | informatif |`);
}
const visionFailures = of('vision_echec');
const failureReasons = new Map<string, number>();
for (const sample of visionFailures) {
  const reason = sample.reason ?? 'raison inconnue';
  failureReasons.set(reason, (failureReasons.get(reason) ?? 0) + 1);
}
console.log(
  `| Vision : échecs | suivi | ${visionFailures.length} échecs${
    failureReasons.size
      ? ' — ' +
        [...failureReasons]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason, count]) => `${reason} (${count})`)
          .join(' ; ')
      : ''
  } | informatif |`,
);
const reused = values('audio_preparation_reutilisee');
console.log(
  `| Préparation locale réutilisée | suivi | ${reused.filter((value) => value === 1).length}/${reused.length} démarrages | informatif |`,
);
console.log(
  `| Présence | ≥ 19/20 engagements ; ≤ 1/50 ouverture injustifiée | ${openings.length} ouvertures, ${recognizedOpenings} avec profil reconnu | à compter manuellement |`,
);
console.log(
  `| Affichage | ≥ 30 images/s | moyenne ${images.mean} i/s, minimum ${images.worst} (n=${images.count}) | ${verdict(images.count > 0 && images.mean >= 30)} |`,
);
console.log(
  `| Fermetures | suivi | ${closures.length} fermetures, dont ${timeouts.length} connexions trop longues | informatif |`,
);
console.log('\nDétail :');
for (const closure of closures)
  console.log(
    `- ${closure.at ? new Date(closure.at).toISOString() : '?'} — ${closure.reason ?? 'raison inconnue'} (${closure.value} s)`,
  );
