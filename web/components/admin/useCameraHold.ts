import { useEffect } from 'react';
import { request } from '../../api';

/**
 * Garde la caméra allumée tant qu’une page de réglage (Caméra, Visages) est affichée, quel que
 * soit le mode d’ouverture. Le serveur l’éteint seul une minute au plus après le dernier signal,
 * et un onglet masqué n’en envoie plus.
 */
export function useCameraHold(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const hold = () => {
      if (document.visibilityState === 'hidden') return;
      void request('/api/admin/camera/hold', { method: 'POST' }).catch(() => {});
    };
    hold();
    const timer = window.setInterval(hold, 20_000);
    document.addEventListener('visibilitychange', hold);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hold);
    };
  }, [active]);
}
