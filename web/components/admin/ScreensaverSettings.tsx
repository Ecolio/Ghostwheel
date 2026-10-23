import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Trash2 } from 'lucide-react';
import {
  DEFAULT_SCREENSAVER,
  SCREENSAVER_IMAGE_MAX_BYTES,
  SCREENSAVER_IMAGE_TYPES,
  SCREENSAVER_INTERVALS_MS,
  SCREENSAVER_RETURN_DELAYS_MS,
  SCREENSAVER_DURATIONS_MS,
  type ScreensaverImage,
  type ScreensaverSettings as Settings,
  type ScreensaverTransition,
  type ScreensaverWake,
} from '../../../shared/screensaver';
import { currentOpening, type Opening } from '../../../shared/opening';
import type { MirrorState } from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { plural } from './format';
import { ConfirmAction, ResourceState } from './shared';
import { useAdminResource } from './useAdminResource';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { ChoiceGroup, type ChoiceOption } from '../ui/choice-card';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** « 5 s », « 1 min », « 1 h ». */
export function durationLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + ' s';
  if (seconds < 3600) return Math.round(seconds / 60) + ' min';
  return Math.round(seconds / 3600) + ' h';
}

/** « 0,5 s », « 1 s », « 1,5 s ». */
export function secondsLabel(ms: number): string {
  return (ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' s';
}

function durationOptions(presets: number[], saved: number): ChoiceOption<string>[] {
  return [
    ...presets.map((ms) => ({ value: String(ms), label: durationLabel(ms) })),
    ...(presets.includes(saved) ? [] : [{ value: String(saved), label: durationLabel(saved) }]),
  ];
}

export const transitionOptions: ChoiceOption<ScreensaverTransition>[] = [
  {
    value: 'vortex',
    label: 'Aspiration',
    description: 'L’image se grise, s’enroule et s’effondre dans l’orbe.',
  },
  {
    value: 'embers',
    label: 'Cendres',
    description: 'L’image se consume depuis l’orbe, un liseré de braise en tête.',
  },
  {
    value: 'ripple',
    label: 'Onde',
    description: 'Une onde partie de l’orbe traverse l’image et l’emporte.',
  },
  {
    value: 'mosaic',
    label: 'Mosaïque',
    description: 'L’image se défait en carreaux qui tournent et fondent, de l’orbe vers les bords.',
  },
  {
    value: 'curtain',
    label: 'Rideau',
    description: 'L’image s’ouvre en deux derrière l’orbe, chaque moitié glisse vers son bord.',
  },
  {
    value: 'fade',
    label: 'Fondu',
    description: 'L’image s’éteint doucement vers le noir, sans se griser.',
  },
  {
    value: 'random',
    label: 'Au hasard',
    description: 'Un des cinq effets animés, différent à chaque fois.',
  },
  { value: 'none', label: 'Sans transition', description: 'L’image disparaît d’un coup.' },
];

/** Ce qui réveille Cornelius (« Quand il écoute »), dit pour l’écran de veille. */
function openingWake(opening: Opening): string {
  const who = opening.audience === 'members' ? ' reconnue' : '';
  return opening.trigger === 'voice'
    ? 'Réglé sur le mot « Cornelius » : l’image reste jusqu’à ce qu’on l’appelle.'
    : opening.trigger === 'gaze'
      ? `Réglé sur le regard : l’image reste jusqu’à ce qu’une personne${who} regarde le miroir.`
      : `Réglé sur la présence : l’image part dès qu’une personne${who} se présente.`;
}

/** Écran de veille : activation et rythme, puis les images proposées au miroir. */
export function ScreensaverSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const saved: Settings = state.screensaver
    ? {
        enabled: state.screensaver.enabled,
        intervalMs: state.screensaver.intervalMs,
        returnDelayMs: state.screensaver.returnDelayMs,
        transition: state.screensaver.transition,
        wake: state.screensaver.wake,
        durationMs: state.screensaver.durationMs,
      }
    : DEFAULT_SCREENSAVER;
  const wakeOptions: ChoiceOption<ScreensaverWake>[] = [
    {
      value: 'presence',
      label: 'Au moindre mouvement',
      description: 'Dès qu’une personne passe devant le miroir, même sans s’arrêter.',
    },
    {
      value: 'opening',
      label: 'Selon le réveil de Cornelius',
      description: openingWake(currentOpening(state)),
    },
  ];
  const save = (label: string, changes: Partial<Settings>) => {
    const next = { ...saved, ...changes };
    return run(label, () => api.screensaverSettings(next), { key: 'screensaver', payload: next });
  };
  const imageCount = state.screensaver?.imageCount ?? 0;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Écran de veille</CardTitle>
          <CardDescription>
            Plutôt qu’un écran noir, le miroir affiche des peintures et vos photos quand personne
            n’est devant lui. Au retour d’une personne, l’orbe réapparaît devant l’image et
            l’efface.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="screensaver-enabled">Afficher des images au repos</Label>
              <p className="text-xs text-muted-foreground">
                {imageCount
                  ? plural(imageCount, 'image prête', 'images prêtes') + '.'
                  : 'Ajoutez d’abord des images, ci-dessous : sans elles, l’écran reste noir.'}
              </p>
            </div>
            <Switch
              id="screensaver-enabled"
              checked={saved.enabled}
              onCheckedChange={(enabled) =>
                void save(enabled ? 'Écran de veille activé.' : 'Écran de veille désactivé.', {
                  enabled,
                })
              }
            />
          </div>
          <ChoiceGroup
            legend="L’orbe revient"
            disabled={!saved.enabled}
            value={saved.wake}
            options={wakeOptions}
            describedBy="screensaver-wake-help"
            onValueChange={(wake) =>
              save(
                wake === 'presence'
                  ? 'L’orbe revient au moindre mouvement.'
                  : 'L’orbe revient selon le réveil de Cornelius.',
                { wake },
              )
            }
          />
          <p id="screensaver-wake-help" className="text-xs leading-relaxed text-muted-foreground">
            « Selon le réveil de Cornelius » suit « Quand il écoute » : présence, regard ou mot «
            Cornelius », et seulement les personnes reconnues si l’ouverture leur est réservée.
            Changer ce réglage-là change aussi l’écran de veille. Une conversation qui s’ouvre fait
            toujours revenir l’orbe.
          </p>
          <ChoiceGroup
            legend="Transition"
            disabled={!saved.enabled}
            value={saved.transition}
            options={transitionOptions}
            describedBy="screensaver-transition-help"
            onValueChange={(transition) =>
              save(
                `Transition : ${transitionOptions.find((option) => option.value === transition)?.label}.`,
                { transition },
              )
            }
          />
          <p
            id="screensaver-transition-help"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            La même transition, jouée à l’envers, fait revenir les images. Si l’ordinateur demande
            de réduire les animations, c’est toujours un simple fondu.
          </p>
          <ChoiceGroup
            legend="Durée de l’effet"
            compact
            disabled={!saved.enabled || saved.transition === 'none'}
            value={String(saved.durationMs)}
            options={[
              ...SCREENSAVER_DURATIONS_MS,
              ...(SCREENSAVER_DURATIONS_MS.includes(saved.durationMs) ? [] : [saved.durationMs]),
            ].map((ms) => ({ value: String(ms), label: secondsLabel(ms) }))}
            describedBy="screensaver-duration-help"
            onValueChange={(value) =>
              save(`Durée de l’effet : ${secondsLabel(Number(value))}.`, {
                durationMs: Number(value),
              })
            }
          />
          <p
            id="screensaver-duration-help"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            Temps que met l’image à disparaître quand l’orbe revient. Son retour prend un peu plus
            longtemps, pour s’installer sans hâte.
          </p>
          <ChoiceGroup
            legend="Changer d’image toutes les"
            compact
            disabled={!saved.enabled}
            value={String(saved.intervalMs)}
            options={durationOptions(SCREENSAVER_INTERVALS_MS, saved.intervalMs)}
            onValueChange={(value) =>
              save(`Une image toutes les ${durationLabel(Number(value))}.`, {
                intervalMs: Number(value),
              })
            }
          />
          <ChoiceGroup
            legend="Revenir aux images après"
            compact
            disabled={!saved.enabled}
            value={String(saved.returnDelayMs)}
            options={durationOptions(SCREENSAVER_RETURN_DELAYS_MS, saved.returnDelayMs)}
            describedBy="screensaver-return-help"
            onValueChange={(value) =>
              save(`Retour aux images après ${durationLabel(Number(value))} sans personne.`, {
                returnDelayMs: Number(value),
              })
            }
          />
          <p id="screensaver-return-help" className="text-xs leading-relaxed text-muted-foreground">
            {saved.wake === 'presence'
              ? 'Temps sans personne devant le miroir, sans conversation ni carte affichée.'
              : 'Temps sans réveil de Cornelius (personne, regard ou conversation, selon le réglage), sans carte affichée.'}{' '}
            {
              'Avec « Cornelius » pour tout le monde, la caméra reste éteinte : les images restent jusqu’au mot d’appel.'
            }
          </p>
        </CardContent>
      </Card>
      <ScreensaverImages run={run} />
    </div>
  );
}

function ScreensaverImages({ run }: { run: RunAction }) {
  const load = useCallback(() => api.screensaver(), []);
  const resource = useAdminResource(load);
  const { data, reload } = resource;
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<ScreensaverImage | null>(null);
  const downloading = data?.collection.downloading === true;
  // Téléchargement en cours : relire l’avancement jusqu’à la fin.
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void reload(), 1500);
    return () => clearInterval(timer);
  }, [downloading, reload]);

  const upload = (files: File[]) => {
    const tooBig = files.find((file) => file.size > SCREENSAVER_IMAGE_MAX_BYTES);
    void run(
      files.length > 1 ? `${files.length} images ajoutées.` : 'Image ajoutée.',
      async () => {
        if (tooBig)
          throw new Error(
            `« ${tooBig.name} » dépasse ${SCREENSAVER_IMAGE_MAX_BYTES / 1024 / 1024} Mo.`,
          );
        for (const file of files) await api.addScreensaverImage(file);
      },
      { key: 'screensaver-upload' },
    ).finally(() => void reload());
  };
  const collection = data?.collection;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Images</CardTitle>
        <CardDescription>
          Vos photos (JPEG, PNG ou WebP, {SCREENSAVER_IMAGE_MAX_BYTES / 1024 / 1024} Mo au plus), et
          une sélection de peintures célèbres du domaine public. Elles restent sur cet ordinateur,
          dans le dossier data/screensaver.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => input.current?.click()}>
            <ImagePlus aria-hidden="true" />
            Ajouter des photos
          </Button>
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-label="Photos à ajouter"
            accept={SCREENSAVER_IMAGE_TYPES.join(',')}
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length) upload(files);
            }}
          />
          {collection && collection.installed < collection.total && (
            <Button
              variant="outline"
              disabled={downloading}
              onClick={() =>
                void run('Téléchargement des peintures lancé.', () =>
                  api.installScreensaverCollection(),
                ).finally(() => void reload())
              }
            >
              <Download aria-hidden="true" />
              {downloading
                ? `Téléchargement… ${collection.installed} / ${collection.total}`
                : collection.installed
                  ? `Compléter les peintures (${collection.total - collection.installed})`
                  : `Télécharger ${collection.total} peintures`}
            </Button>
          )}
        </div>
        {collection && collection.installed < collection.total && !downloading && (
          <p className="text-xs leading-relaxed text-muted-foreground" role="status">
            {collection.error ??
              'Les peintures viennent de Wikimedia Commons : la seule connexion à Internet de cette rubrique, faite quand vous cliquez.'}
          </p>
        )}
        <ResourceState
          resource={resource}
          loadingLabel="Lecture des images…"
          isEmpty={(view) => view.images.length === 0}
          empty={{
            title: 'Aucune image',
            description: 'Ajoutez vos photos, ou téléchargez les peintures proposées.',
          }}
        >
          {(view) => (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {view.images.map((image) => (
                <li key={image.id} className="overflow-hidden rounded-lg border bg-muted/30">
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full bg-black object-contain"
                  />
                  <div className="flex items-start justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm" title={image.title}>
                        {image.title}
                      </p>
                      {image.credit && (
                        <p className="truncate text-xs text-muted-foreground">{image.credit}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Retirer l’image ${image.title}`}
                      title="Retirer cette image"
                      onClick={() => setRemoving(image)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ResourceState>
        {removing && (
          <ConfirmAction
            message={`Retirer « ${removing.title} » de l’écran de veille ? Le fichier est effacé de cet ordinateur.`}
            confirmLabel="Retirer"
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const image = removing;
              void run('Image retirée.', () => api.removeScreensaverImage(image.id)).then(() => {
                setRemoving(null);
                void reload();
              });
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
