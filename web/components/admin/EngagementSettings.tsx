import { useEffect, useState } from 'react';
import type { DevicesStatus } from '../../../shared/types';
import type { RunAction } from './types';
import { request } from '../../api';
import { FineTuning } from './FineTuning';
import { Field, SaveBar } from './shared';
import { ChoiceGroup, type ChoiceOption } from '../ui/choice-card';
import { Input } from '../ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Du plus souple au plus strict, comme l’exigence de la reconnaissance. */
export const GAZE_PRESETS = [
  {
    label: 'Souple',
    pose: 45,
    size: 8,
    description: 'Tête un peu tournée ou de plus loin. Peut aussi réagir à un simple passage.',
  },
  { label: 'Équilibrée', pose: 30, size: 14, description: 'Le réglage conseillé.' },
  { label: 'Stricte', pose: 20, size: 18, description: 'Il faut être face au miroir, et proche.' },
] as const;

const valid = (text: string, min: number, max: number) =>
  text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max;

/** Détection du regard : quand Cornelius considère qu’une personne regarde le miroir. */
export function EngagementSettings({
  status,
  run,
}: {
  status: DevicesStatus | null;
  run: RunAction;
}) {
  const saved = status?.perception.engagement;
  const savedPose = saved ? String(Math.round(saved.poseTolerance * 100)) : '';
  const savedSize = saved ? String(Math.round(saved.minFaceRatio * 100)) : '';
  const [pose, setPose] = useState(savedPose);
  const [size, setSize] = useState(savedSize);
  useEffect(() => {
    setPose(savedPose);
    setSize(savedSize);
  }, [savedPose, savedSize]);
  const poseValid = valid(pose, 10, 50);
  const sizeValid = valid(size, 5, 30);
  const dirty =
    !!saved &&
    (pose !== savedPose || size !== savedSize) &&
    !(
      poseValid &&
      sizeValid &&
      Number(pose) === Number(savedPose) &&
      Number(size) === Number(savedSize)
    );
  const preset = saved
    ? (GAZE_PRESETS.find(
        (entry) => String(entry.pose) === savedPose && String(entry.size) === savedSize,
      )?.label ?? 'custom')
    : null;
  const options: ChoiceOption<string>[] = [
    ...GAZE_PRESETS.map((entry) => ({
      value: entry.label,
      label: entry.label,
      description: entry.description,
    })),
    ...(preset === 'custom' ? [{ value: 'custom', label: 'Personnalisée' }] : []),
  ];
  const save = (next: { pose: number; size: number }) => {
    const settings = { poseTolerance: next.pose / 100, minFaceRatio: next.size / 100 };
    return run(
      'Détection du regard enregistrée.',
      () => request('/api/admin/engagement', { method: 'PATCH', body: JSON.stringify(settings) }),
      { key: 'gaze-detection', payload: settings },
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Détection du regard</CardTitle>
        <CardDescription>
          Cornelius estime que vous le regardez d’après l’orientation et la taille de votre visage,
          sans suivre vos yeux. Ce réglage ne change pas la reconnaissance des personnes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChoiceGroup
          legend="Exigence du regard"
          compact
          value={preset}
          options={options}
          disabled={!saved}
          describedBy="gaze-help"
          onValueChange={(label) => {
            const entry = GAZE_PRESETS.find((item) => item.label === label);
            return entry ? save(entry) : false;
          }}
        />
        <p id="gaze-help" className="text-xs leading-relaxed text-muted-foreground">
          Souple réagit plus tôt, même de loin ou la tête un peu tournée. Stricte attend que la
          personne soit face au miroir, et proche.
        </p>
        <FineTuning hint="Orientation et distance" defaultOpen={preset === 'custom'}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              id="engagement-pose"
              label="Orientation de la tête acceptée"
              help="De 10 à 50 : plus haut accepte une tête davantage tournée. C’est un indice de souplesse, pas un angle en degrés."
            >
              <Input
                id="engagement-pose"
                type="number"
                min="10"
                max="50"
                step="1"
                disabled={!saved}
                aria-invalid={!poseValid || undefined}
                value={pose}
                onChange={(event) => setPose(event.target.value)}
              />
            </Field>
            <Field
              id="engagement-size"
              label="Taille minimale du visage (%)"
              help="Part de la largeur de l’image, de 5 à 30 : plus bas permet de parler de plus loin."
            >
              <Input
                id="engagement-size"
                type="number"
                min="5"
                max="30"
                step="1"
                disabled={!saved}
                aria-invalid={!sizeValid || undefined}
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />
            </Field>
          </div>
        </FineTuning>
        <SaveBar
          label="Détection du regard"
          count={dirty ? (pose !== savedPose ? 1 : 0) + (size !== savedSize ? 1 : 0) : 0}
          error={
            poseValid && sizeValid ? null : 'Orientation de 10 à 50, taille du visage de 5 à 30 %.'
          }
          onSave={() => void save({ pose: Number(pose), size: Number(size) })}
          onCancel={() => {
            setPose(savedPose);
            setSize(savedSize);
          }}
        />
      </CardContent>
    </Card>
  );
}
