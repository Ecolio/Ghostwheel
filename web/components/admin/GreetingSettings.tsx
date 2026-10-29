import { DEFAULT_GREETING_MODE, type GreetingMode } from '../../../shared/conversation';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { ChoiceGroup } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

const modes: { value: GreetingMode; label: string; description: string }[] = [
  {
    value: 'name',
    label: '« Bonjour » et le prénom',
    description: 'Toujours la même phrase, « Bonjour Sacha. », quelle que soit la personnalité.',
  },
  {
    value: 'free',
    label: 'Accueil libre',
    description:
      'Une courte salutation dans le ton choisi dans « Personnaliser Cornelius » : tutoiement, humour, formule de votre choix.',
  },
  {
    value: 'off',
    label: 'Pas d’accueil',
    description: 'Cornelius attend en silence que la personne parle la première.',
  },
];

/** Accueil parlé d’une personne reconnue : la phrase vient du serveur, pas de la personnalité. */
export function GreetingSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const current = state.greeting ?? DEFAULT_GREETING_MODE;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accueil à l’ouverture</CardTitle>
        <CardDescription>
          Ce que Cornelius dit en premier quand il reconnaît la personne devant le miroir. Sans
          personne reconnue, il ne salue jamais. Quand la conversation s’ouvre avec « Ghostwheel »,
          la personne a déjà formulé sa demande : reconnue, elle est appelée par son prénom, sans
          salutation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChoiceGroup
          legend="Accueil à l’ouverture"
          hideLegend
          value={current}
          options={modes}
          onValueChange={(mode) =>
            run('Accueil enregistré.', () => api.greeting(mode), { payload: mode })
          }
        />
      </CardContent>
    </Card>
  );
}
