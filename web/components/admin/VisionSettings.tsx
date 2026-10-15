import { useState, type ReactNode } from 'react';
import { CheckCircle2, Download, Eye, RefreshCw } from 'lucide-react';
import type {
  DevicesStatus,
  ModelDownload,
  VisionDevice,
  VisionMode,
  VisionModel,
} from '../../../shared/types';
import {
  VISION_DEVICE_DEFAULT,
  VISION_DEVICES,
  VISION_MODEL_DEFAULT,
  VISION_MODELS,
  VISION_MODES,
} from '../../../shared/types';
import { api } from '../../api';
import type { RunAction } from './types';
import { formatWhen } from './format';
import {
  InstallConfirm,
  InstallFailure,
  InstallProgress,
  ModelChoices,
  SetupStep,
  SetupSteps,
  TechnicalDetails,
  downloadDuration,
  gigabytes,
  isInstalled,
  isInstalling,
  megabytes,
  type ModelOption,
} from './ModelInstall';
import { ModulePanel } from './shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Label } from '../ui/label';

const modes: Record<VisionMode, { label: string; detail: string }> = {
  off: {
    label: 'Jamais',
    detail:
      'Cornelius ne décrit pas ce qu’il voit. La reconnaissance des personnes continue de fonctionner.',
  },
  scene: {
    label: 'Au début de la conversation, puis sur demande',
    detail:
      'Cornelius regarde une seconde après le début de la conversation, puis à nouveau à chaque question sur ce qu’il voit, même si vous ne regardez plus le miroir.',
  },
  tool: {
    label: 'Uniquement sur demande',
    detail: 'Cornelius ne regarde que lorsque vous lui posez une question sur ce qu’il voit.',
  },
};
/** Estimations par version : graphes q4 pour le processeur, fp16 pour la carte graphique. */
const sizes: Record<VisionModel, Record<'cpu' | 'gpu', { memoryGb: number; diskGb: number }>> = {
  '450m': { cpu: { memoryGb: 1, diskGb: 0.5 }, gpu: { memoryGb: 1.5, diskGb: 1 } },
  '1.6b': { cpu: { memoryGb: 2.5, diskGb: 1.8 }, gpu: { memoryGb: 4, diskGb: 3.5 } },
  '3b': { cpu: { memoryGb: 4, diskGb: 3.4 }, gpu: { memoryGb: 7, diskGb: 6.5 } },
};
const choices: Record<VisionModel, { tier: string; name: string; summary: string }> = {
  '450m': {
    tier: 'Léger',
    name: 'LFM2.5-VL 450M',
    summary: 'Réponse rapide, description simple.',
  },
  '1.6b': {
    tier: 'Équilibré',
    name: 'LFM2.5-VL 1,6B',
    summary: 'Plus de détails, encore rapide.',
  },
  '3b': {
    tier: 'Précis',
    name: 'LFM2.5-VL 3B',
    summary: 'Les descriptions les plus fines, plus lent.',
  },
};
const deviceLabels: Record<VisionDevice, string> = {
  auto: 'Automatique, carte graphique si disponible',
  gpu: 'Carte graphique (graphes fp16)',
  cpu: 'Processeur (graphes q4)',
};
const deviceDetails: Record<VisionDevice, string> = {
  auto: 'Détecte les fournisseurs ONNX disponibles et installe la version GPU fp16 lorsqu’un GPU compatible est présent ; sinon la version CPU q4.',
  gpu: 'Impose la version GPU fp16. Le chargement échoue clairement si aucun fournisseur GPU ONNX n’est disponible.',
  cpu: 'Impose la version CPU q4, même lorsqu’un GPU est disponible.',
};

function progressOf(download: ModelDownload) {
  const percent = download.total
    ? Math.min(100, Math.round((100 * download.received) / download.total))
    : null;
  return {
    step:
      download.state === 'checking'
        ? 'Vérification des fichiers déjà présents…'
        : 'Fichier ' + Math.min(download.completed + 1, download.files) + ' sur ' + download.files,
    percent,
    detail: download.total
      ? megabytes(download.received) + ' sur ' + megabytes(download.total)
      : null,
  };
}

export function VisionSettings({
  status,
  run,
  hidden,
  action,
}: {
  status: DevicesStatus | null;
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const vision = status?.perception.vision;
  const downloads = vision?.downloads;
  const current = vision?.modelId ?? VISION_MODEL_DEFAULT;
  const device = vision?.device ?? VISION_DEVICE_DEFAULT;
  const mode = vision?.mode ?? 'scene';
  // Choisir un modèle ne fait rien : l’installation attend une confirmation explicite.
  const [choice, setChoice] = useState<VisionModel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const installing = VISION_MODELS.find((model) => isInstalling(downloads?.[model]));
  const progress = installing ? downloads?.[installing] : undefined;
  // Pendant une installation, le choix affiché est le modèle en cours d’installation.
  const chosen = installing ?? choice ?? current;
  const chosenDownload = downloads?.[chosen];
  const currentDownload = downloads?.[current];
  const currentInstalled = isInstalled(currentDownload);
  // Version qui sera installée : celle déjà vérifiée, sinon la plus lourde par prudence.
  const variant =
    device === 'cpu' ? 'cpu' : device === 'gpu' ? 'gpu' : (currentDownload?.variant ?? 'gpu');
  const options: ModelOption<VisionModel>[] = VISION_MODELS.map((id) => ({
    id,
    ...choices[id],
    ...sizes[id][variant],
  }));
  const chosenOption = options.find((option) => option.id === chosen)!;
  const locked = !vision || !!installing;

  const install = (model: VisionModel, label: string) =>
    run(label, () => api.visionModel(model), {
      key: 'vision-model',
      payload: { model },
    }).then((ok) => {
      if (!ok) return;
      setConfirming(false);
      setChoice(null);
    });

  return (
    <ModulePanel
      id="module-vision"
      icon={Eye}
      title="Vision"
      subtitle={
        currentInstalled || !vision
          ? 'Regarder : ' + modes[mode].label.toLocaleLowerCase('fr')
          : // Le badge dit déjà « À installer » : le sous-titre nomme le modèle, comme pour
            // la génération d’image.
            'Modèle ' + choices[current].tier.toLocaleLowerCase('fr')
      }
      // Un état, comme les autres modules : le modèle vaut pour tout le foyer (voir l’étape 1).
      badge={
        vision && (
          <Badge variant={currentInstalled && mode !== 'off' ? 'secondary' : 'outline'}>
            {installing
              ? 'Installation…'
              : !currentInstalled
                ? 'À installer'
                : mode === 'off'
                  ? 'Désactivée'
                  : 'Activée'}
          </Badge>
        )
      }
      action={action}
      hidden={hidden}
    >
      <p className="text-sm text-muted-foreground">
        Décrire ce qui se trouve devant le miroir. Les images restent sur ce PC ; seule la
        description rejoint la conversation.
      </p>
      <SetupSteps label="Mise en place de la vision">
        <SetupStep number={1} title="Choisir le modèle" done={currentInstalled && !choice}>
          <ModelChoices
            legend="Modèle de description"
            name="vision-model"
            options={options}
            value={chosen}
            current={current}
            installed={(model) => isInstalled(downloads?.[model])}
            memoryLabel="Mémoire"
            disabled={locked}
            onChange={(model) => {
              setChoice(model === current ? null : model);
              setConfirming(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Choisir un modèle ne télécharge rien. Le modèle s’applique à tous les profils.
          </p>
        </SetupStep>
        <SetupStep number={2} title="Installer" done={isInstalled(chosenDownload) && !choice}>
          {installing && progress ? (
            <InstallProgress
              title={'Installation de « ' + choices[installing].tier + ' » en cours…'}
              {...progressOf(progress)}
            />
          ) : chosenDownload?.state === 'failed' ? (
            <InstallFailure
              title="L’installation a échoué"
              hint="Les fichiers déjà vérifiés sont conservés. Vérifiez la connexion à Internet et la place disponible, puis réessayez."
              output={chosenDownload.error}
              action={
                <Button
                  size="sm"
                  disabled={locked}
                  onClick={() =>
                    void install(chosen, 'Installation relancée. La progression s’affiche ici.')
                  }
                >
                  <RefreshCw />
                  Réessayer
                </Button>
              }
            />
          ) : !isInstalled(chosenDownload) ? (
            confirming ? (
              <InstallConfirm
                title={'Installer « ' + chosenOption.tier + ' » sur ce PC ?'}
                onConfirm={() =>
                  void install(
                    chosen,
                    'Installation de « ' +
                      chosenOption.tier +
                      ' » lancée. La progression s’affiche ici.',
                  )
                }
                onCancel={() => setConfirming(false)}
              >
                <p>
                  Environ {gigabytes(chosenOption.diskGb)} à télécharger,{' '}
                  {downloadDuration(chosenOption.diskGb)} selon votre connexion.
                </p>
                <p>Cornelius utilisera ce modèle dès la fin de l’installation.</p>
              </InstallConfirm>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  « {chosenOption.tier} » n’est pas encore installé. Environ{' '}
                  {gigabytes(chosenOption.diskGb)} à télécharger.
                </p>
                <Button size="sm" disabled={locked} onClick={() => setConfirming(true)}>
                  <Download />
                  Installer « {chosenOption.tier} »…
                </Button>
              </div>
            )
          ) : chosen !== current ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                « {chosenOption.tier} » est déjà installé sur ce PC.
              </p>
              <Button
                size="sm"
                disabled={locked}
                onClick={() =>
                  void install(chosen, 'Modèle « ' + chosenOption.tier + ' » utilisé.')
                }
              >
                Utiliser ce modèle
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />«{' '}
                {chosenOption.tier} » est installé sur ce PC.
              </p>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() => void install(current, 'Vérification des fichiers lancée.')}
              >
                Vérifier les fichiers
              </Button>
            </div>
          )}
        </SetupStep>
        <SetupStep number={3} title="Activer" done={currentInstalled && mode !== 'off'}>
          <div className="space-y-2">
            <Label htmlFor="vision-mode">Quand regarder</Label>
            <NativeSelect
              id="vision-mode"
              wrapperClassName="w-full"
              className="w-full"
              value={mode}
              disabled={!vision}
              onChange={(event) => {
                const value = event.target.value as VisionMode;
                void run('Réglage de la vision enregistré.', () => api.visionMode(value));
              }}
            >
              {VISION_MODES.map((value) => (
                <NativeSelectOption
                  key={value}
                  value={value}
                  disabled={value !== 'off' && !currentInstalled}
                >
                  {modes[value].label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">
              {currentInstalled
                ? modes[mode].detail
                : 'Installez d’abord le modèle choisi pour que Cornelius puisse regarder.'}
            </p>
          </div>
          {vision?.lastDescription && (
            <p className="text-sm">
              <span className="text-muted-foreground">
                Dernière description {vision.lastTrigger === 'tool' ? 'sur demande' : 'au début'} (
                {formatWhen(vision.lastAt)}) :{' '}
              </span>
              {vision.lastDescription}
            </p>
          )}
        </SetupStep>
      </SetupSteps>
      <p className="text-xs text-muted-foreground">
        Une description prend quelques secondes, selon le modèle et l’ordinateur.
      </p>
      <TechnicalDetails>
        <div className="space-y-2">
          <Label htmlFor="vision-device">Calcul</Label>
          <NativeSelect
            id="vision-device"
            wrapperClassName="w-full"
            className="w-full"
            value={device}
            disabled={locked}
            onChange={(event) => {
              const value = event.target.value as VisionDevice;
              void run('Calcul de la vision enregistré. La version adaptée est vérifiée.', () =>
                api.visionDevice(value),
              );
            }}
          >
            {VISION_DEVICES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {deviceLabels[value]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            {deviceDetails[device]} Changer de calcul peut télécharger l’autre version du modèle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {vision?.model === 'ready'
              ? 'Modèle prêt'
              : vision?.model === 'loading'
                ? 'Chargement du modèle…'
                : vision?.model === 'unavailable'
                  ? 'Modèle indisponible'
                  : 'Modèle non chargé'}
          </Badge>
          {vision?.provider && <Badge variant="outline">{vision.provider}</Badge>}
          <Badge variant="outline">
            {status?.perception.connected ? 'Service caméra connecté' : 'Service caméra arrêté'}
          </Badge>
          {vision?.pending ? <Badge variant="secondary">Analyse en cours</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Modèle : {choices[current].name}.{' '}
          {currentDownload?.variant
            ? 'Version installée : ' + (currentDownload.variant === 'gpu' ? 'GPU fp16.' : 'CPU q4.')
            : 'La version sera choisie après détection du matériel.'}{' '}
          Les fichiers déjà vérifiés sont conservés en cas de reprise.
        </p>
        {vision?.detail && <p className="text-xs text-muted-foreground">{vision.detail}</p>}
      </TechnicalDetails>
    </ModulePanel>
  );
}
