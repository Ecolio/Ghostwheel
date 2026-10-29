import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { DevicesStatus, MirrorState } from '../../../shared/types';
import {
  cameraWatchesInStandby,
  currentOpening,
  type Opening,
  type OpeningAudience,
  type OpeningTrigger,
} from '../../../shared/opening';
import { api } from '../../api';
import type { RunAction } from './types';
import { ChoiceGroup } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

const triggers: { value: OpeningTrigger; label: string; description: string }[] = [
  {
    value: 'presence',
    label: 'La présence',
    description: 'Dès qu’une personne s’arrête devant le miroir.',
  },
  {
    value: 'gaze',
    label: 'Le regard',
    description: 'Quand une personne regarde franchement le miroir. Le plus discret.',
  },
  {
    value: 'voice',
    label: '« Ghostwheel »',
    description:
      'Seulement quand on dit « Ghostwheel », entendu sur cet ordinateur. Le dire relance aussi une conversation arrêtée depuis l’administration.',
  },
];

const audiences: { value: OpeningAudience; label: string; camera: string; voice: string }[] = [
  {
    value: 'everyone',
    label: 'Tout le monde',
    camera: 'Membre du foyer ou visiteur.',
    voice: 'Toute personne qui dit « Ghostwheel ».',
  },
  {
    value: 'members',
    label: 'Les membres du foyer',
    camera: 'Seulement une personne reconnue par la caméra.',
    voice: 'Il faut être reconnu devant le miroir en disant « Ghostwheel ».',
  },
];

function summary(opening: Opening): string {
  const members = opening.audience === 'members';
  if (opening.trigger === 'presence')
    return members
      ? 'Cornelius attend de reconnaître un membre du foyer devant le miroir.'
      : 'Cornelius parle à toute personne qui s’arrête devant le miroir.';
  if (opening.trigger === 'gaze')
    return members
      ? 'Cornelius répond quand un membre du foyer reconnu regarde le miroir.'
      : 'Cornelius répond quand quelqu’un regarde le miroir.';
  if (members)
    return '« Ghostwheel » ouvre la conversation seulement si un membre du foyer est reconnu devant le miroir.';
  return opening.recognizeVoice
    ? '« Ghostwheel » ouvre la conversation pour tout le monde ; la caméra reconnaît ensuite la personne.'
    : '« Ghostwheel » ouvre la conversation pour tout le monde, sans caméra.';
}

function cameraLine(opening: Opening): string {
  if (cameraWatchesInStandby(opening))
    return opening.trigger === 'voice'
      ? 'Caméra en veille : allumée, pour savoir qui dit « Ghostwheel ».'
      : 'Caméra en veille : allumée.';
  return 'Caméra en veille : éteinte, et pendant la conversation seulement pour la vision locale.';
}

export interface OpeningWarning {
  text: string;
  /** Rubrique où agir, dans l’adresse de l’administration. */
  link: { href: string; label: string };
}

/**
 * Ce qui empêche l’ouverture choisie de fonctionner aujourd’hui. `perception` : le service
 * caméra est connecté (inconnu sur un ancien serveur) ; `enrolledFaces` : null tant que le
 * nombre de visages mémorisés n’est pas connu.
 */
export function openingWarnings(
  opening: Opening,
  context: {
    perception: boolean | undefined;
    wakeWordReady: boolean;
    enrolledFaces: number | null;
  },
): OpeningWarning[] {
  const warnings: OpeningWarning[] = [];
  const start = { href: '#start', label: 'Voir la mise en route' };
  const voice = opening.trigger === 'voice';
  if (context.perception === false)
    warnings.push({
      text: voice
        ? 'Le service caméra n’est pas lancé : c’est lui qui entend « Ghostwheel », ce choix ne peut donc pas fonctionner pour l’instant.'
        : 'Le service caméra n’est pas lancé : ce choix ne peut pas fonctionner pour l’instant.',
      link: start,
    });
  else if (voice && !context.wakeWordReady)
    warnings.push({
      text: 'Le mot « Ghostwheel » n’est pas encore prêt sur cet ordinateur : ce choix ne peut pas fonctionner pour l’instant.',
      link: start,
    });
  if (opening.audience === 'members' && context.enrolledFaces === 0)
    warnings.push({
      text: 'Aucun visage n’est encore mémorisé : personne ne pourra ouvrir la conversation.',
      link: { href: '#profiles', label: 'Enregistrer un visage' },
    });
  return warnings;
}

export function SessionMode({
  state,
  status,
  run,
}: {
  state: MirrorState;
  /** État des périphériques (null tant qu’il n’est pas reçu), pour les visages mémorisés. */
  status: DevicesStatus | null;
  run: RunAction;
}) {
  const saved = currentOpening(state);
  // Dernière ouverture demandée, affichée tant que le serveur ne l’a pas confirmée : un second
  // choix rapide part de celle-ci, pas de l’état encore en retard d’un choix.
  const [requested, setRequested] = useState<Opening | null>(null);
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setRequested((value) => (value && JSON.stringify(value) === savedKey ? null : value));
  }, [savedKey]);
  const opening = requested ?? saved;
  const voice = opening.trigger === 'voice';
  const warnings = openingWarnings(opening, {
    perception: status?.perception.connected ?? state.setup?.perception,
    wakeWordReady: state.wakeWord.ready,
    enrolledFaces: typeof status?.enrolledFaces === 'number' ? status.enrolledFaces : null,
  });
  const save = async (next: Partial<Opening>) => {
    const value = { ...opening, ...next };
    setRequested(value);
    const ok = await run('Ouverture enregistrée.', () => api.opening(value), { payload: value });
    if (!ok) setRequested((current) => (current === value ? null : current));
    return ok;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ouverture de la conversation</CardTitle>
        <CardDescription>
          Deux questions indépendantes : ce qui ouvre la conversation, puis qui peut l’ouvrir.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ChoiceGroup
          legend="Ce qui l’ouvre"
          value={opening.trigger}
          options={triggers}
          onValueChange={(trigger) => save({ trigger })}
        />
        <ChoiceGroup
          legend="Qui peut l’ouvrir"
          value={opening.audience}
          options={audiences.map((entry) => ({
            value: entry.value,
            label: entry.label,
            description: voice ? entry.voice : entry.camera,
          }))}
          onValueChange={(audience) => save({ audience })}
        />
        {voice && opening.audience === 'everyone' && (
          <label className="admin-mode-option admin-wake-option">
            <input
              type="checkbox"
              aria-label="Reconnaître la personne pendant la conversation"
              aria-describedby="opening-recognize-detail"
              checked={opening.recognizeVoice}
              onChange={(event) => void save({ recognizeVoice: event.target.checked })}
            />
            <span className="admin-mode-card">
              <span className="admin-mode-top">
                <strong>Reconnaître la personne pendant la conversation</strong>
                <span className="admin-checkbox" aria-hidden="true" />
              </span>
              <span className="admin-mode-detail" id="opening-recognize-detail">
                La caméra reste allumée en veille (les images ne quittent pas cet ordinateur) et
                reconnaît la personne dès « Ghostwheel ». Si une seule personne enregistrée est face
                à elle dans les 8 secondes, ses sources, sa mémoire, ses agents et Home Assistant
                réservé rejoignent la conversation, sans la rouvrir. Sinon, la conversation reste
                celle du foyer.
              </span>
            </span>
          </label>
        )}
        <div className="admin-opening-summary" role="status">
          <strong>{summary(opening)}</strong>
          <span>{cameraLine(opening)}</span>
          {voice && state.wakeWord.ready && <span>Mot « Ghostwheel » prêt sur cet ordinateur.</span>}
        </div>
        {warnings.length > 0 && (
          <ul className="space-y-2" aria-label="Ce qui empêche cette ouverture">
            {warnings.map((warning) => (
              <li
                key={warning.text}
                className="flex items-start gap-2.5 rounded-lg border border-[#e8bc8866] bg-[#2a2519] px-3.5 py-3 text-sm text-[#f3d7b0]"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {warning.text}{' '}
                  <a className="font-medium underline underline-offset-2" href={warning.link.href}>
                    {warning.link.label}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
