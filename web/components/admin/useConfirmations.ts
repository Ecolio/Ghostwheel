import { useSyncExternalStore } from 'react';
import { api, errorMessage } from '../../api';
import type { ActionConfirmationView } from './types';

/** Relecture des commandes à valider, comme les tâches des agents. */
const pollMs = 3000;

interface ConfirmationsSnapshot {
  /** null tant que la première lecture n’a pas abouti. */
  list: ActionConfirmationView[] | null;
  error: string | null;
}

let snapshot: ConfirmationsSnapshot = { list: null, error: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let pending: Promise<void> | null = null;

function publish(next: ConfirmationsSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Lecture immédiate, partagée : deux appels simultanés n’envoient qu’une requête. */
export function refreshConfirmations(): Promise<void> {
  pending ??= api
    .actionConfirmations()
    .then(
      (list) => publish({ list, error: null }),
      (failure: unknown) => publish({ list: snapshot.list, error: errorMessage(failure) }),
    )
    .finally(() => {
      pending = null;
    });
  return pending;
}

function onVisibility() {
  if (!document.hidden) void refreshConfirmations();
}

// Une seule relecture pour tous les abonnés (onglet et page Commandes), suspendue quand la
// page est cachée et reprise dès qu’elle redevient visible.
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshConfirmations();
    timer = setInterval(() => {
      if (!document.hidden) void refreshConfirmations();
    }, pollMs);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export function useConfirmations(): ConfirmationsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Demandes encore à valider (une demande validée attend seulement que Cornelius l’exécute). */
export function waitingConfirmations(
  list: readonly ActionConfirmationView[] | null,
): ActionConfirmationView[] {
  return (list ?? []).filter((confirmation) => confirmation.approvedAt === null);
}
