import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Micro gardé prêt sur cet ordinateur, pour parler sans attendre l’ouverture. */
export function AdvancedAudioBuffer({ state, run }: { state: MirrorState; run: RunAction }) {
  return (
    <Card>
      <CardHeader>
        {/* Rangée dans « Réglages avancés », dont le résumé porte le h3. */}
        <CardTitle as="h4" className="flex items-center gap-2">
          Micro gardé prêt
          <Badge variant="outline">Bêta</Badge>
        </CardTitle>
        <CardDescription id="advanced-audio-buffer-detail">
          Permet de dire « Cornelius, allume la lumière » d’une traite, ou de parler dès que la
          caméra vous voit. Le micro reste prêt sur cet ordinateur ; le son n’est envoyé à la
          conversation qu’une fois celle-ci ouverte. Fonction expérimentale : la réponse peut
          arriver plus tard qu’en parlant une fois la conversation ouverte.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Un oui ou non : un interrupteur, comme les autres réglages, enregistré au clic. */}
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="advanced-audio-buffer">Garder le micro prêt</Label>
          <Switch
            id="advanced-audio-buffer"
            aria-describedby="advanced-audio-buffer-detail"
            checked={state.advancedAudioBuffer}
            onCheckedChange={(enabled) => {
              void run(
                enabled ? 'Micro gardé prêt : activé.' : 'Micro gardé prêt : désactivé.',
                () => api.advancedAudioBuffer(enabled),
                { key: 'advanced-audio-buffer', payload: enabled },
              );
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
