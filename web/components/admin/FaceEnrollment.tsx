import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleAlert,
  Plus,
  RotateCcw,
  ScanFace,
  SlidersHorizontal,
  Trash2,
  Users,
} from 'lucide-react';
import type { DevicesStatus, EnrollmentMode, MirrorState, Profile } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { formatWhen, plural } from './format';
import { ConfirmAction } from './shared';
import { RecognitionTester } from './RecognitionTester';
import { useCameraHold } from './useCameraHold';
import { useCameraPreview } from './useCameraPreview';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

const STEPS = [
  { title: 'De face', detail: 'Regardez la caméra, visage bien éclairé.' },
  { title: 'Un côté', detail: 'Tournez légèrement la tête, sans quitter le cadre.' },
  { title: 'L’autre côté', detail: 'Tournez légèrement la tête de l’autre côté.' },
  { title: 'Vers le haut', detail: 'Levez légèrement le menton, en regardant la caméra.' },
  { title: 'Vers le bas', detail: 'Baissez légèrement le menton, en regardant la caméra.' },
];
const PROMPTS = new Set([
  'Regardez la caméra de face.',
  'Tournez légèrement la tête vers un côté.',
  'Tournez légèrement la tête vers l’autre côté.',
  'Levez légèrement le menton.',
  'Baissez légèrement le menton.',
]);

const START_EVENT = 'cornelius:face-enrollment';
const FACE_HASH = /^#profiles\/visage-(.+)$/u;

/** Lien vers la ligne du visage d’une personne, depuis une autre rubrique. */
export function faceHref(profileId: string): string {
  return '#profiles/visage-' + encodeURIComponent(profileId);
}

/**
 * Demande, depuis la même rubrique, de mémoriser le visage d’une personne tout de suite :
 * l’enregistrement démarre s’il est possible, sinon la ligne de la personne est montrée.
 */
export function requestFaceEnrollment(profileId: string): void {
  window.dispatchEvent(new CustomEvent<string>(START_EVENT, { detail: profileId }));
}

/** Ce qui empêche de mémoriser un visage maintenant ; null si rien, ou état encore inconnu. */
export type FaceBlocker = 'perception';
export function faceEnrollmentBlocker(
  _state: MirrorState,
  status: DevicesStatus | null,
): FaceBlocker | null {
  const perception = status?.perception;
  if (!perception) return null;
  // Quel que soit le mode d’ouverture, la page garde la caméra allumée pendant l’enregistrement.
  if (!perception.connected) return 'perception';
  return null;
}

export function FaceEnrollment({
  state,
  status,
  run,
  onOpenCamera,
}: {
  state: MirrorState;
  status: DevicesStatus | null;
  run: RunAction;
  onOpenCamera: () => void;
}) {
  const perception = status?.perception;
  useCameraHold(!!perception?.connected);
  const enrolling = perception?.enrollingProfileId ?? null;
  const [testing, setTesting] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const name = (id: string) => state.profiles.find((profile) => profile.id === id)?.name ?? '';
  const enrolledIds = perception?.enrolledProfileIds ?? [];
  // Seul le serveur sait comment l’enregistrement s’est terminé : une annulation ou un délai
  // dépassé ne doit jamais s’afficher comme un visage mémorisé.
  const result = perception?.enrollmentResult ?? null;
  const resultProfile = result
    ? state.profiles.find((profile) => profile.id === result.profileId)
    : undefined;
  const ended = !enrolling && resultProfile ? result : null;
  const blocker = faceEnrollmentBlocker(state, status);
  const unavailable =
    blocker === 'perception'
      ? 'Le service caméra (perception) n’est pas lancé : relancez Cornelius avec scripts/start.sh (scripts/start.ps1 sous Windows) pour mémoriser un visage.'
      : null;
  const blocked = !perception || !!unavailable || !!enrolling;
  const enroll = (profile: Profile, mode: EnrollmentMode) =>
    void run(
      mode === 'add' ? 'Complément du visage lancé.' : 'Enregistrement du visage lancé.',
      () => api.enrollFace(profile.id, mode),
    );

  // Les demandes venues d’ailleurs (« Mémoriser le visage de Camille maintenant », lien depuis
  // Personnaliser) lisent l’état le plus récent, sans réabonner les écouteurs à chaque rendu.
  const latest = useRef({ blocked, enroll, profiles: state.profiles, enrolledIds });
  latest.current = { blocked, enroll, profiles: state.profiles, enrolledIds };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (profileId: string, start: boolean) => {
      const current = latest.current;
      const profile = current.profiles.find((entry) => entry.id === profileId);
      if (!profile) return;
      if (start && !current.blocked && !current.enrolledIds.includes(profileId)) {
        current.enroll(profile, 'replace');
        document.getElementById('face-enrollment')?.scrollIntoView({ block: 'start' });
        return;
      }
      const row = document.getElementById('face-' + profileId);
      // Enregistrement impossible : le haut de la carte en donne la raison.
      if (start) document.getElementById('face-enrollment')?.scrollIntoView({ block: 'start' });
      else row?.scrollIntoView({ block: 'center' });
      row
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
      setHighlighted(profileId);
      clearTimeout(timer);
      timer = setTimeout(() => setHighlighted(null), 4000);
    };
    const started = (event: Event) => show((event as CustomEvent<string>).detail, true);
    const linked = () => {
      const match = FACE_HASH.exec(location.hash);
      if (match) show(decodeURIComponent(match[1]!), false);
    };
    linked();
    window.addEventListener(START_EVENT, started);
    window.addEventListener('hashchange', linked);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(START_EVENT, started);
      window.removeEventListener('hashchange', linked);
    };
  }, []);

  return (
    <Card id="face-enrollment" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Reconnaissance des visages</CardTitle>
        <CardDescription>
          Chaque personne mémorise son visage en cinq positions, seule devant le miroir. Aucune
          photo n’est conservée : seulement des signatures numériques, sur cet ordinateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {unavailable && (
          <Alert role="status">
            <AlertDescription className="gap-3">
              <p>{unavailable}</p>
            </AlertDescription>
          </Alert>
        )}

        {enrolling && perception && (
          <EnrollmentGuide
            name={name(enrolling)}
            mode={perception.enrollmentMode ?? 'replace'}
            progress={perception.enrollmentProgress ?? null}
            onCancel={() => void run('Enregistrement annulé.', () => api.cancelEnrollment())}
          />
        )}

        {ended?.outcome === 'saved' && (
          <Alert role="status">
            <AlertDescription className="gap-3">
              <p>
                <Check className="mr-1.5 inline size-4 text-primary" aria-hidden="true" />
                Visage de {resultProfile!.name} mémorisé. Vérifiez qu’il est bien reconnu, et pas
                confondu avec quelqu’un d’autre.
              </p>
              <Button size="sm" variant="outline" onClick={() => setTesting(true)}>
                <ScanFace />
                Tester la reconnaissance
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {(ended?.outcome === 'expired' || ended?.outcome === 'rejected') && (
          <Alert role="status">
            <AlertDescription className="gap-3">
              <p className="flex items-start gap-2 font-medium text-foreground">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                Visage de {resultProfile!.name} non enregistré
              </p>
              <p>
                {ended.message}
                {enrolledIds.includes(ended.profileId) && ' Le visage déjà mémorisé reste actif.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={blocked}
                onClick={() =>
                  enroll(
                    resultProfile!,
                    enrolledIds.includes(ended.profileId) ? ended.mode : 'replace',
                  )
                }
              >
                <RotateCcw />
                Réessayer
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {(perception?.lookalikes ?? []).map((pair) => (
          // Un conseil durable, pas une alerte : rien à annoncer à l’affichage de la page.
          <Alert key={pair.profileIds.join(':')} role="note">
            <AlertDescription className="gap-1.5">
              <p className="flex items-center gap-2 font-medium text-foreground">
                <Users className="size-4 shrink-0 text-warning" aria-hidden="true" />
                {name(pair.profileIds[0])} et {name(pair.profileIds[1])} se ressemblent pour la
                caméra
              </p>
              <p>
                Cornelius exige un écart de score plus net entre eux. Si l’un est encore pris pour
                l’autre, complétez les deux visages dans un autre éclairage (soir, lunettes…), puis
                passez d’un cran vers « Stricte ».
              </p>
              <div>
                <Button size="sm" variant="outline" onClick={onOpenCamera}>
                  <SlidersHorizontal />
                  Régler l’exigence
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ))}

        {state.profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ajoutez d’abord une personne ci-dessus, dans «&nbsp;Une nouvelle personne&nbsp;».
          </p>
        ) : (
          <ul className="admin-faces">
            {state.profiles.map((profile) => {
              const face = perception?.faces?.find((entry) => entry.profileId === profile.id);
              const enrolled = enrolledIds.includes(profile.id);
              return (
                <li
                  key={profile.id}
                  id={'face-' + profile.id}
                  className="scroll-mt-24 transition-shadow data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-primary/60"
                  data-highlighted={highlighted === profile.id}
                >
                  <div className="admin-faces-row">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{profile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {enrolling === profile.id
                          ? 'Enregistrement en cours…'
                          : enrolled
                            ? 'Visage mémorisé' +
                              (face
                                ? ' · ' +
                                  plural(face.views, 'vue') +
                                  ' · ' +
                                  formatWhen(face.enrolledAt)
                                : '')
                            : 'Aucun visage mémorisé'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {enrolled ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={blocked}
                            aria-label={'Compléter le visage de ' + profile.name}
                            title="Ajoute des vues prises dans un autre éclairage ou avec des lunettes."
                            onClick={() => enroll(profile, 'add')}
                          >
                            <Plus />
                            Compléter
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={blocked}
                            aria-label={'Refaire le visage de ' + profile.name}
                            title="Remplace toutes les vues par un nouvel enregistrement."
                            onClick={() => enroll(profile, 'replace')}
                          >
                            <RotateCcw />
                            Refaire
                          </Button>
                          <Button
                            size="sm"
                            variant="danger-outline"
                            disabled={enrolling === profile.id}
                            aria-label={'Oublier le visage de ' + profile.name}
                            onClick={() => setForgetting(profile.id)}
                          >
                            <Trash2 />
                            Oublier
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={blocked}
                          aria-label={'Mémoriser le visage de ' + profile.name}
                          onClick={() => enroll(profile, 'replace')}
                        >
                          <ScanFace />
                          Mémoriser ce visage
                        </Button>
                      )}
                    </div>
                  </div>
                  {forgetting === profile.id && (
                    <ConfirmAction
                      message={`Oublier le visage de ${profile.name} ? Cornelius ne le reconnaîtra plus avant un nouvel enregistrement.`}
                      confirmLabel="Oublier le visage"
                      onCancel={() => setForgetting(null)}
                      onConfirm={() => {
                        void run('Visage oublié.', () => api.forgetFace(profile.id)).then(() =>
                          setForgetting(null),
                        );
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-3 border-t pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Tester la reconnaissance</p>
              <p className="text-xs text-muted-foreground">
                Voyez en direct qui Cornelius reconnaît, avec quel score et quel écart.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={testing}
              disabled={!perception?.connected}
              onClick={() => setTesting((value) => !value)}
            >
              <ScanFace />
              {testing ? 'Arrêter le test' : 'Tester en direct'}
            </Button>
          </div>
          {testing && <RecognitionTester profiles={state.profiles} />}
          <p className="text-xs leading-relaxed text-muted-foreground">
            L’exigence de la reconnaissance se règle dans la rubrique{' '}
            <a
              className="text-primary underline underline-offset-4"
              href="#camera"
              onClick={(event) => {
                event.preventDefault();
                onOpenCamera();
              }}
            >
              Caméra et reconnaissance
            </a>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EnrollmentGuide({
  name,
  mode,
  progress,
  onCancel,
}: {
  name: string;
  mode: 'replace' | 'add';
  progress: NonNullable<DevicesStatus['perception']['enrollmentProgress']> | null;
  onCancel: () => void;
}) {
  const { frame, error } = useCameraPreview(true);
  const step = progress?.step ?? 0;
  const total = progress?.total ?? 6;
  const collected = progress?.collected ?? 0;
  const message = progress?.message ?? 'Regardez la caméra de face.';
  // Un message qui n’est pas la consigne de l’étape signale ce qui bloque.
  const problem = !PROMPTS.has(message);
  // Haut et bas se font dans l’ordre choisi : si la tête a d’abord été baissée, la
  // dernière étape devient « Vers le haut ».
  const steps =
    step === 4 && message === 'Levez légèrement le menton.'
      ? [STEPS[0]!, STEPS[1]!, STEPS[2]!, STEPS[4]!, STEPS[3]!]
      : STEPS;
  return (
    <section className="admin-enroll" aria-label={'Enregistrement du visage de ' + name}>
      <div className="admin-enroll-preview">
        {frame ? (
          <img src={frame} alt="Aperçu en direct de la caméra du miroir" />
        ) : (
          <p role="status">{error ?? 'Connexion à la caméra…'}</p>
        )}
        <span className="admin-enroll-oval" aria-hidden="true" />
      </div>
      <div className="admin-enroll-steps">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">
            {mode === 'add' ? 'Complément' : 'Enregistrement'} du visage de {name}
          </p>
          <Badge variant="outline">
            Étape {Math.min(step + 1, STEPS.length)} sur {STEPS.length}
          </Badge>
        </div>
        <ol>
          {steps.map((entry, index) => (
            <li
              key={entry.title}
              data-state={index < step ? 'done' : index === step ? 'current' : 'todo'}
            >
              <span className="admin-enroll-marker" aria-hidden="true">
                {index < step ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span>
                <strong>{entry.title}</strong>
                {index === step && <span className="block text-xs">{entry.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <div className="space-y-2">
          <progress
            aria-label="Progression de l’étape"
            className="w-full"
            max={total}
            value={collected}
          />
          <p
            className={
              'flex items-start gap-2 text-sm ' + (problem ? 'text-warning' : 'text-foreground')
            }
            role="status"
          >
            {problem && <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            {message}
          </p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Seul devant le miroir, à votre distance habituelle, lumière de face.
          {mode === 'add'
            ? ' Les vues déjà mémorisées sont conservées.'
            : ' L’ancien visage reste actif jusqu’à la fin des cinq étapes.'}
        </p>
        <div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Annuler l’enregistrement
          </Button>
        </div>
      </div>
    </section>
  );
}
