import { api } from '../../api';
import { openMirrorWindow } from '../../mirror-window';
import type { RunAction } from './types';

/**
 * « Activer et ouvrir le miroir » : un seul geste, un seul libellé, depuis le panneau de session
 * comme depuis la mise en route. Il ouvre le miroir dans sa fenêtre (dans le geste même, sinon
 * le navigateur la bloque), lève le blocage d’OpenAI s’il y en a un et réactive le démarrage.
 * Le micro et le son se préparent dans la fenêtre du miroir, qui les garde.
 */
export function activateMirrorLabel(openaiBlocked: boolean): string {
  return openaiBlocked ? 'Autoriser OpenAI et ouvrir le miroir' : 'Activer et ouvrir le miroir';
}

export function activateMirror({
  openaiBlocked,
  run,
}: {
  openaiBlocked: boolean;
  run: RunAction;
}): void {
  openMirrorWindow();
  void run('Miroir ouvert dans sa fenêtre.', async () => {
    if (openaiBlocked) await api.blockOpenAI(false);
    await api.command({ type: 'start' });
  });
}
