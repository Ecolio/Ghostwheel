import type { ReactNode } from 'react';
import { Fold } from './shared';

/**
 * Une seule règle d’enregistrement pour les réglages :
 * - les choix (bouton radio, interrupteur, préréglage) s’enregistrent tout de suite ;
 * - les valeurs chiffrées vivent dans ce repli « Réglage fin », et s’enregistrent avec la barre
 *   commune SaveBar (voir shared.tsx), visible seulement quand une valeur a changé.
 */
export function FineTuning({
  summary = 'Réglage fin',
  hint,
  defaultOpen = false,
  children,
}: {
  summary?: string;
  /** Ce que contient le repli, à droite du titre. */
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Fold summary={summary} hint={hint} defaultOpen={defaultOpen} contentClassName="space-y-4">
      {children}
    </Fold>
  );
}
