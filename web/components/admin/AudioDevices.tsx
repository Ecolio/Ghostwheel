import { useEffect, useState } from 'react';
import { CheckCircle2, Volume2 } from 'lucide-react';
import { errorMessage } from '../../api';
import { previewAdmissionSound } from '../../audio/admission-sound';
import {
  audioPreferences,
  saveAudioPreferences,
  type AudioPreferences,
} from '../../audio/preferences';
import { prepareAudio, releasePreparedMicrophone } from '../../audio/preparation';
import type { RunAction } from './types';
import { Field } from './shared';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Alert, AlertDescription } from '../ui/alert';

const fields = [
  {
    key: 'microphone',
    kind: 'audioinput',
    label: 'Microphone',
    saved: 'Microphone choisi pour ce navigateur.',
  },
  {
    key: 'speaker',
    kind: 'audiooutput',
    label: 'Haut-parleurs',
    saved: 'Haut-parleurs choisis pour ce navigateur.',
  },
] as const;

export function AudioDevices({
  active,
  run,
}: {
  active: boolean;
  /** Confirme le choix dans le message commun de l’administration. */
  run: RunAction;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [preferences, setPreferences] = useState(audioPreferences);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    let mounted = true;
    const update = () => {
      void media
        .enumerateDevices()
        .then((list) => {
          if (mounted) setDevices(list);
        })
        .catch(() => {});
    };
    update();
    media.addEventListener('devicechange', update);
    // Autorisation déjà accordée à ce navigateur : inutile de la redemander pour l’afficher.
    navigator.permissions
      ?.query({ name: 'microphone' as PermissionName })
      .then((permission) => {
        if (mounted && permission.state === 'granted') setAuthorized(true);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      media.removeEventListener('devicechange', update);
    };
  }, []);

  async function authorizeMicrophone() {
    const media = navigator.mediaDevices;
    if (!media) {
      setError('Ce navigateur ne donne pas accès aux périphériques audio.');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await prepareAudio();
      releasePreparedMicrophone();
      setAuthorized(true);
      setDevices(await media.enumerateDevices());
    } catch (failure) {
      setAuthorized(false);
      setError(errorMessage(failure));
    } finally {
      setChecking(false);
    }
  }

  function choose(field: (typeof fields)[number], value: string) {
    const next: AudioPreferences = { ...preferences, [field.key]: value };
    setPreferences(next);
    void run(field.saved, async () => saveAudioPreferences(next), {
      key: 'audio-' + field.key,
      payload: value,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audio de ce navigateur</CardTitle>
        <CardDescription>
          Ce réglage s’applique au miroir ouvert dans ce navigateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={checking || active}
            onClick={() => {
              void authorizeMicrophone();
            }}
          >
            {checking ? 'Vérification…' : 'Autoriser et vérifier le microphone'}
          </Button>
          <span role="status" className="inline-flex items-center gap-1.5 text-sm text-success">
            {authorized && !checking && (
              <>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                Micro autorisé
              </>
            )}
          </span>
        </div>
        {active && (
          <p className="text-xs text-muted-foreground">
            Une conversation utilise le micro : la vérification sera possible à sa fin.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <Field key={field.key} id={field.key} label={field.label}>
              <NativeSelect
                id={field.key}
                wrapperClassName="w-full"
                className="w-full"
                value={preferences[field.key]}
                onChange={(event) => choose(field, event.target.value)}
              >
                <NativeSelectOption value="">Périphérique par défaut</NativeSelectOption>
                {preferences[field.key] &&
                  !devices.some(
                    (device) =>
                      device.kind === field.kind && device.deviceId === preferences[field.key],
                  ) && (
                    <NativeSelectOption value={preferences[field.key]}>
                      Périphérique enregistré (à reconnecter)
                    </NativeSelectOption>
                  )}
                {devices
                  .filter(
                    (device) =>
                      device.kind === field.kind &&
                      device.deviceId &&
                      device.deviceId !== 'default',
                  )
                  .map((device, index) => (
                    <NativeSelectOption key={device.deviceId} value={device.deviceId}>
                      {device.label || field.label + ' ' + (index + 1)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </Field>
          ))}
        </div>
        <div>
          <Button variant="outline" onClick={() => void previewAdmissionSound('carillon')}>
            <Volume2 />
            Tester le haut-parleur
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">
          Le microphone n’est allumé que le temps de la vérification. L’annulation d’écho et la
          réduction du bruit sont demandées au navigateur.
        </p>
      </CardContent>
    </Card>
  );
}
