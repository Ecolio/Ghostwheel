import { Volume2 } from 'lucide-react';
import {
  ADMISSION_SOUNDS,
  ADMISSION_SOUND_LABELS,
  DEFAULT_ADMISSION_SOUND,
  type AdmissionSound,
  type AdmissionSoundId,
} from '../../../shared/admission-sound';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import { previewAdmissionSound } from '../../audio/admission-sound';
import type { RunAction } from './types';
import { Button } from '../ui/button';
import { ChoiceGroup, type ChoiceOption } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

type Choice = AdmissionSoundId | 'none';

const choices: ChoiceOption<Choice>[] = [
  {
    value: 'none',
    label: 'Aucun son',
    description: 'La conversation s’ouvre en silence.',
  },
  ...ADMISSION_SOUNDS.map((sound) => ({
    value: sound,
    label: ADMISSION_SOUND_LABELS[sound].label,
    description: ADMISSION_SOUND_LABELS[sound].detail,
  })),
];

/** Un seul choix : aucun son, ou l’un des sons, écouté dès qu’il est choisi. */
export function AdmissionSoundSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const settings = state.admissionSound ?? DEFAULT_ADMISSION_SOUND;
  const current: Choice = settings.enabled ? settings.sound : 'none';
  const save = (choice: Choice) => {
    // « Aucun son » garde le dernier son choisi, retrouvé si le son est réactivé ailleurs.
    const next: AdmissionSound =
      choice === 'none' ? { ...settings, enabled: false } : { enabled: true, sound: choice };
    const label =
      choice === 'none'
        ? 'Son d’ouverture désactivé.'
        : 'Son « ' + ADMISSION_SOUND_LABELS[choice].label + ' » choisi.';
    return run(label, () => api.admissionSound(next), { key: 'admission-sound', payload: next });
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Son d’ouverture</CardTitle>
        <CardDescription>
          Un son court, joué par le miroir dès qu’une conversation s’ouvre, avant même que Cornelius
          soit prêt à écouter. Chaque son choisi est joué une fois sur cet appareil.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChoiceGroup
          legend="Son joué à l’ouverture"
          hideLegend
          value={current}
          options={choices}
          onChoose={(choice) => {
            if (choice !== 'none') void previewAdmissionSound(choice);
          }}
          onValueChange={save}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Le miroir joue le son seulement après l’activation de la voix.
          </p>
          {current !== 'none' && (
            <Button
              variant="outline"
              size="sm"
              aria-label={'Écouter le son ' + ADMISSION_SOUND_LABELS[current].label}
              onClick={() => void previewAdmissionSound(current)}
            >
              <Volume2 />
              Écouter
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
