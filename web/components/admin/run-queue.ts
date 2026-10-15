import type { RunAction, RunOptions } from './types';

/**
 * File des enregistrements de l’administration.
 *
 * - Les demandes passent une par une, dans l’ordre ; la première part tout de suite, dans le
 *   geste de l’utilisateur (prepareAudio en dépend).
 * - Une demande identique à celle d’un même réglage déjà en cours est ignorée : un double clic
 *   ne supprime pas deux fois.
 * - Une demande différente du même réglage attend la fin de celle en cours ; si plusieurs
 *   attendent, seule la dernière part. Deux choix rapides d’ouverture sont ainsi enregistrés
 *   tous les deux, au lieu de perdre le second derrière un message « enregistrée ».
 */
export interface RunQueueHandlers {
  /** Une demande commence : le message précédent n’a plus cours. */
  start(): void;
  succeeded(label: string): void;
  failed(error: unknown): void;
  /** Vrai dès qu’une demande est en cours ou en attente, faux quand la file est vide. */
  busy(value: boolean): void;
}

/** Ce qui distingue deux demandes d’un même réglage : un contrôle et une valeur. */
export type Charge = readonly [control: object | null, value: string];

interface Task {
  key: string;
  charge: Charge;
  label: string;
  action: () => Promise<unknown>;
  onError?: (error: unknown) => void;
  settle: ((ok: boolean) => void)[];
}

const sameCharge = (a: Charge, b: Charge) => a[0] === b[0] && a[1] === b[1];

/**
 * Contrôle à l’origine de l’événement en cours de traitement, avec sa valeur : deux boutons
 * radio différents donnent deux charges, deux clics sur un même bouton une seule.
 */
export function triggeringControl(): Charge {
  if (typeof window === 'undefined' || typeof Element === 'undefined') return [null, ''];
  // window.event est l’événement natif que React est en train de distribuer.
  const target = window.event?.target;
  if (!(target instanceof Element)) return [null, ''];
  const control =
    target.closest('input, select, textarea, button, a, [role], form, label') ?? target;
  if (control instanceof HTMLInputElement)
    return [
      control,
      control.type === 'checkbox' || control.type === 'radio'
        ? control.value + ':' + control.checked
        : control.value,
    ];
  if (control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
    return [control, control.value];
  return [
    control,
    control.getAttribute('aria-checked') ?? control.getAttribute('aria-pressed') ?? '',
  ];
}

export function chargeOf(
  options: RunOptions | undefined,
  control: () => Charge = triggeringControl,
): Charge {
  if (options?.payload !== undefined) return [null, 'charge:' + JSON.stringify(options.payload)];
  return control();
}

export function createRunQueue(
  handlers: RunQueueHandlers,
  control: () => Charge = triggeringControl,
): RunAction {
  let running: Task | null = null;
  const waiting: Task[] = [];

  const next = () => {
    running = waiting.shift() ?? null;
    if (!running) {
      handlers.busy(false);
      return;
    }
    void execute(running);
  };

  const execute = async (task: Task) => {
    handlers.start();
    let ok = false;
    try {
      await task.action();
      handlers.succeeded(task.label);
      ok = true;
    } catch (failure) {
      if (task.onError) task.onError(failure);
      else handlers.failed(failure);
    }
    for (const settle of task.settle) settle(ok);
    next();
  };

  return (label, action, options) => {
    const key = options?.key ?? label;
    const charge = chargeOf(options, control);
    const queued = waiting.find((task) => task.key === key);
    if (queued) {
      if (sameCharge(queued.charge, charge)) return Promise.resolve(false);
      // Seule la dernière demande d’un réglage part : elle prend la place de la précédente,
      // dont l’appelant reçoit le résultat final.
      Object.assign(queued, { label, action, charge, onError: options?.onError });
      return new Promise<boolean>((resolve) => queued.settle.push(resolve));
    }
    if (running?.key === key && sameCharge(running.charge, charge)) return Promise.resolve(false);
    const task: Task = { key, charge, label, action, onError: options?.onError, settle: [] };
    const result = new Promise<boolean>((resolve) => task.settle.push(resolve));
    waiting.push(task);
    if (!running) {
      handlers.busy(true);
      next();
    }
    return result;
  };
}
