import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

export function PrivacyMode({ state, run }: { state: MirrorState; run: RunAction }) {
  const enabled = state.privacyMode;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mode vie privée</CardTitle>
        <CardDescription>
          Dès qu’une deuxième personne est détectée, la conversation en cours se ferme immédiatement
          et aucune nouvelle conversation ne s’ouvre tant qu’il y a du monde. Le profil reconnu
          reste affiché.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="privacy-mode">
            {enabled ? 'Mode vie privée activé' : 'Mode vie privée désactivé'}
          </Label>
          <Switch
            id="privacy-mode"
            checked={enabled}
            onCheckedChange={(checked) => {
              void run(checked ? 'Mode vie privée activé.' : 'Mode vie privée désactivé.', () =>
                api.privacy(checked),
              );
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Une personne choisie à la main dans l’administration reste prioritaire.
        </p>
      </CardContent>
    </Card>
  );
}
