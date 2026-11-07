import { useEffect, useState } from 'react';
import type { DevicesStatus } from '../../../shared/types';
import {
  DEFAULT_PRESENCE_TIMINGS,
  PRESENCE_TIMING_MAX,
  PRESENCE_TIMING_MIN,
  isPresenceTimings,
  type PresenceTimings,
} from '../../../shared/presence-timings';
import { request } from '../../api';
import type { RunAction } from './types';
import { decimalText, parseDecimal } from './format';
import { FineTuning } from './FineTuning';
import { DecimalInput, Field, SaveBar } from './shared';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

const fields: { key: keyof PresenceTimings; label: string; help: string }[] = [
  {
    key: 'absenceMs',
    label: 'Confirmer un départ (s)',
    help: 'Temps sans personne détectée avant de confirmer le départ, hors conversation ; pendant une conversation, le délai de fin ci-dessous s’applique s’il est plus long. C’est aussi le temps laissé à la reconnaissance pour retrouver une personne dont le visage a été perdu puis suivi à nouveau. Un retour avant ce délai annule le départ. De 0 à 30 s.',
  },
  {
    key: 'disengagementMs',
    label: 'Terminer après la perte du regard (s)',
    help: 'Pendant une conversation, temps toléré sans visage détecté dans tous les modes caméra, et sans regard vers le miroir quand c’est le regard qui ouvre la conversation. Une réponse de Cornelius en cours repousse la fin ; la parole de la personne ne la repousse pas. Une ouverture par la présence ne se termine pas sur la perte du regard. De 0 à 60 s.',
  },
  {
    key: 'identityHoldMs',
    label: 'Garder l’identité sans nouvelle preuve (s)',
    help: 'Temps pendant lequel une personne reconnue garde son profil quand son visage reste suivi mais n’est plus identifiable : tête tournée, trop loin, flou ou ressemblance ambiguë avec un proche. Une autre personne reconnue, ou un visage qui ne correspond plus du tout, retire le profil immédiatement. De 0 à 60 s.',
  },
  {
    key: 'presenceMs',
    label: 'Confirmer une présence (s)',
    help: 'Durée de détection continue avant de considérer une personne présente. Évite les réactions aux passages très courts. De 0 à 5 s.',
  },
  {
    key: 'engagementMs',
    label: 'Confirmer le regard (s)',
    help: 'Durée du regard vers le miroir avant de considérer que la personne le regarde, une fois la présence établie. De 0 à 5 s.',
  },
];
function seconds(settings: Readonly<PresenceTimings>): Record<keyof PresenceTimings, string> {
  const entries = fields.map(({ key }) => [key, decimalText(settings[key] / 1000)]);
  return Object.fromEntries(entries) as Record<keyof PresenceTimings, string>;
}

export function PresenceTimingSettings({
  status,
  run,
}: {
  status: DevicesStatus | null;
  run: RunAction;
}) {
  const saved = status?.presenceTimings;
  const [draft, setDraft] = useState(() => seconds(saved ?? DEFAULT_PRESENCE_TIMINGS));
  const savedKey = saved ? JSON.stringify(saved) : '';
  useEffect(() => {
    if (saved) setDraft(seconds(saved));
  }, [savedKey]);
  const settings = Object.fromEntries(
    fields.map(({ key }) => [key, Math.round(parseDecimal(draft[key]) * 1000)]),
  ) as unknown as PresenceTimings;
  const outOfRange = (key: keyof PresenceTimings) =>
    !Number.isFinite(settings[key]) ||
    settings[key] < PRESENCE_TIMING_MIN[key] ||
    settings[key] > PRESENCE_TIMING_MAX[key];
  const invalid = fields.some(({ key }) => outOfRange(key)) || !isPresenceTimings(settings);
  const changed = !!saved && fields.some(({ key }) => settings[key] !== saved[key]);
  // Une saisie équivalente (« 8,0 » pour 8 s) n’est pas une modification ; une saisie vide en est une.
  const edited = !!saved && fields.some(({ key }) => draft[key] !== decimalText(saved[key] / 1000));
  const dirty = edited && (invalid || changed);
  // Champs à enregistrer : valeur changée, ou saisie vide.
  const count = dirty
    ? Math.max(
        1,
        fields.filter(({ key }) => outOfRange(key) || settings[key] !== saved![key]).length,
      )
    : 0;
  const format = (ms: number) => (ms / 1000).toLocaleString('fr-FR') + ' s';

  return (
    <Card>
      <CardHeader>
        {/* Rangée dans « Réglages avancés », dont le résumé porte le h3. */}
        <CardTitle as="h4">Délais de présence</CardTitle>
        <CardDescription>
          Ajustez la réactivité de Cornelius. Un délai de départ plus long évite les coupures
          lorsque la caméra perd brièvement votre visage. Pour les délais de présence, 0 signifie
          sans attente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FineTuning
          hint={
            saved
              ? 'Départ : ' +
                format(saved.absenceMs) +
                ' · Perte du regard : ' +
                format(saved.disengagementMs) +
                ' · Identité : ' +
                format(saved.identityHoldMs)
              : 'Lecture des délais de présence…'
          }
        >
          <div className="grid gap-5 md:grid-cols-2">
            {fields.map(({ key, label, help }) => (
              <Field key={key} id={'presence-timing-' + key} label={label} help={help}>
                <DecimalInput
                  id={'presence-timing-' + key}
                  disabled={!saved}
                  aria-invalid={outOfRange(key) || undefined}
                  value={draft[key]}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, [key]: event.target.value }))
                  }
                />
              </Field>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!saved}
            onClick={() => setDraft(seconds(DEFAULT_PRESENCE_TIMINGS))}
          >
            Valeurs par défaut
          </Button>
        </FineTuning>
        <SaveBar
          label="Délais de présence"
          count={count}
          error={
            invalid
              ? 'Une valeur est vide ou hors limites : chaque délai indique sa plage sous le champ.'
              : null
          }
          onSave={() => {
            void run(
              'Délais de présence enregistrés.',
              () =>
                request('/api/admin/presence-timings', {
                  method: 'PATCH',
                  body: JSON.stringify(settings),
                }),
              { payload: settings },
            );
          }}
          onCancel={() => saved && setDraft(seconds(saved))}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          La fin sur silence se règle dans « Fin de parole ». Une panne caméra de plus d’une
          seconde, ou une deuxième personne en mode vie privée, coupe toujours les conversations
          ouvertes par la caméra.
        </p>
      </CardContent>
    </Card>
  );
}
