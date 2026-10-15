/** A spoken line of the recipe: an identifier and the sentence to read aloud. */
export interface RecetteStep {
  id: string;
  text: string;
}

/**
 * Fixed protocol of the §3 recipe. Approaches and passages have no spoken text: they are
 * presence scenarios whose only outcome is whether a session opens.
 */
export interface RecetteProtocol {
  version: 1;
  answerWaitMs: number;
  gapMs: number;
  passageSeconds: number;
  approaches: number;
  passages: number;
  questions: RecetteStep[];
  interruptions: RecetteStep[];
}

export interface RecetteLimits {
  questions: number | null;
  interruptions: number | null;
  approaches: number | null;
  passages: number | null;
}

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function stepList(value: unknown, field: string): RecetteStep[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`Protocole invalide : « ${field} » doit être une liste non vide.`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object')
      throw new Error(`Protocole invalide : entrée ${index + 1} de « ${field} ».`);
    const step = entry as { id?: unknown; text?: unknown };
    if (typeof step.id !== 'string' || !idPattern.test(step.id))
      throw new Error(`Protocole invalide : identifiant « ${field}[${index}] ».`);
    if (typeof step.text !== 'string' || !step.text.trim())
      throw new Error(`Protocole invalide : texte manquant pour « ${step.id} ».`);
    return { id: step.id, text: step.text.trim() };
  });
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error(`Protocole invalide : « ${field} » doit être un entier positif.`);
  return value;
}

/** Validates a parsed protocol document; the caller stays responsible for reading the file. */
export function parseProtocol(value: unknown): RecetteProtocol {
  if (!value || typeof value !== 'object') throw new Error('Protocole invalide : objet attendu.');
  const document = value as Record<string, unknown>;
  if (document.version !== 1) throw new Error('Protocole invalide : version 1 attendue.');
  const questions = stepList(document.questions, 'questions');
  const interruptions = stepList(document.interruptions, 'interruptions');
  const answerWaitMs = count(document.answerWaitMs ?? 15_000, 'answerWaitMs');
  const gapMs = count(document.gapMs ?? 900, 'gapMs');
  const passageSeconds = count(document.passageSeconds ?? 6, 'passageSeconds');
  if (answerWaitMs < 1_000) throw new Error('« answerWaitMs » doit valoir au moins 1000 ms.');
  return {
    version: 1,
    answerWaitMs,
    gapMs,
    passageSeconds,
    approaches: count(document.approaches ?? 20, 'approaches'),
    passages: count(document.passages ?? 50, 'passages'),
    questions,
    interruptions,
  };
}

/** Applies the optional per-run limits without ever exceeding the protocol length. */
export function applyLimits(protocol: RecetteProtocol, limits: RecetteLimits): RecetteProtocol {
  const cap = (value: number | null, max: number) =>
    value === null ? max : Math.min(Math.max(0, value), max);
  return {
    ...protocol,
    questions: protocol.questions.slice(0, cap(limits.questions, protocol.questions.length)),
    interruptions: protocol.interruptions.slice(
      0,
      cap(limits.interruptions, protocol.interruptions.length),
    ),
    approaches: cap(limits.approaches, protocol.approaches),
    passages: cap(limits.passages, protocol.passages),
  };
}

export function parseLimits(argv: string[]): RecetteLimits {
  const read = (flag: string): number | null => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const raw = argv[index + 1];
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} attend un entier positif.`);
    return value;
  };
  return {
    questions: read('--questions'),
    interruptions: read('--interruptions'),
    approaches: read('--approaches'),
    passages: read('--passages'),
  };
}
