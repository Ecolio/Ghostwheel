import { useId, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { ModelDownload } from '../../../shared/types';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Fold } from './shared';

/**
 * Installation d’un modèle local en trois étapes, commune à la vision et à la génération
 * d’image : choisir (sans effet), installer (après confirmation), puis activer.
 */
export interface ModelOption<T extends string> {
  id: T;
  /** Ce que l’on choisit : Léger, Équilibré, Précis… */
  tier: string;
  /** Nom du modèle, gardé en texte secondaire. */
  name: string;
  summary: string;
  /** Mémoire occupée une fois le modèle chargé, en Go. */
  memoryGb: number;
  /** Place occupée sur le disque, en Go. */
  diskGb: number;
  /** Quantité téléchargée, en Go, quand elle diffère de la place occupée. */
  downloadGb?: number;
}

export const isInstalled = (download?: ModelDownload | null) =>
  download?.state === 'present' || download?.state === 'ready';
export const isInstalling = (download?: ModelDownload | null) =>
  download?.state === 'checking' || download?.state === 'downloading';

export function gigabytes(value: number): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Go';
}

export function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
}

function minutes(value: number): string {
  const rounded = value < 10 ? Math.max(1, Math.round(value)) : Math.round(value / 5) * 5;
  if (rounded < 60) return rounded + ' min';
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours + ' h' + (rest ? ' ' + String(rest).padStart(2, '0') : '');
}

/** Durée d’un téléchargement, entre une fibre (25 Mo/s) et une connexion à 50 Mbit/s. */
export function downloadDuration(gb: number): string {
  const fast = minutes((gb * 1000) / 25 / 60);
  const slow = minutes((gb * 1000) / 6 / 60);
  return fast === slow ? 'environ ' + fast : 'de ' + fast + ' à ' + slow;
}

export function SetupSteps({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ol aria-label={label} className="space-y-3">
      {children}
    </ol>
  );
}

export function SetupStep({
  number,
  title,
  done = false,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="space-y-3 rounded-lg border p-4">
      {/* h4 : l’étape est rangée dans un ModulePanel, dont le résumé porte le h3. */}
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full border text-xs',
            done ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {number}
        </span>
        <span>
          <span className="sr-only">Étape {number} : </span>
          {title}
          {done && <span className="sr-only"> (fait)</span>}
        </span>
        {done && <Check className="size-4 text-primary" aria-hidden="true" />}
      </h4>
      {children}
    </li>
  );
}

export function ModelChoices<T extends string>({
  legend,
  name,
  options,
  value,
  current,
  installed,
  memoryLabel,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly ModelOption<T>[];
  value: T;
  current: T;
  installed: (id: T) => boolean;
  memoryLabel: string;
  disabled?: boolean;
  onChange: (id: T) => void;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      <div className={cn('grid gap-2 sm:grid-cols-2', options.length === 3 && 'lg:grid-cols-3')}>
        {options.map((option) => {
          const labelId = id + option.id + '-label';
          const detailId = id + option.id + '-detail';
          return (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={value === option.id}
                aria-labelledby={labelId}
                aria-describedby={detailId}
                className="mt-1 size-4 shrink-0 accent-primary"
                onChange={() => onChange(option.id)}
              />
              <span className="min-w-0 space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span id={labelId} className="text-sm font-medium">
                    {option.tier}
                  </span>
                  {option.id === current ? (
                    // « Utilisé » seulement s’il est installé : sinon, c’est le choix en attente.
                    <Badge variant={installed(option.id) ? 'secondary' : 'outline'}>
                      {installed(option.id) ? 'Utilisé' : 'Actuel'}
                    </Badge>
                  ) : (
                    installed(option.id) && <Badge variant="outline">Installé</Badge>
                  )}
                </span>
                <span id={detailId} className="block space-y-1">
                  <span className="block text-sm text-muted-foreground">{option.summary}</span>
                  <span className="block text-xs text-muted-foreground">
                    {memoryLabel} : environ {gigabytes(option.memoryGb)} · Disque : environ{' '}
                    {gigabytes(option.diskGb)}
                  </span>
                  <span className="block text-xs text-muted-foreground/80">{option.name}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Demande de confirmation avant un long téléchargement : taille, durée et conséquences. */
export function InstallConfirm({
  title,
  children,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={id}
      className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
    >
      <p id={id} className="text-sm font-medium">
        {title}
      </p>
      <div className="space-y-1 text-sm text-muted-foreground">{children}</div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" autoFocus onClick={onConfirm}>
          Installer
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  );
}

export function InstallProgress({
  title,
  step,
  percent,
  detail,
}: {
  title: string;
  step: string;
  /** Avancement connu, de 0 à 100 ; null pendant une étape dont la durée est inconnue. */
  percent: number | null;
  detail?: string | null;
}) {
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{step}</p>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        {/* Durée inconnue : une barre pleine et pâle, qu’on ne lit pas comme un pourcentage. */}
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-[width]',
            percent === null && 'w-full animate-pulse bg-primary/40 motion-reduce:animate-none',
          )}
          style={percent === null ? undefined : { width: percent + '%' }}
        />
      </div>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** Échec lisible : une phrase, une action, et la sortie technique repliée. */
export function InstallFailure({
  title,
  hint,
  output,
  action,
}: {
  title: string;
  hint: string;
  output: string | null;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {action}
        {output && (
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Masquer les détails' : 'Voir les détails'}
          </Button>
        )}
      </div>
      {output && (
        <pre
          id={id}
          hidden={!open}
          className="max-h-48 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground"
        >
          {output}
        </pre>
      )}
    </div>
  );
}

/** Repli « Détails techniques » : noms de modèles, calcul et état interne. */
export function TechnicalDetails({ children }: { children: ReactNode }) {
  // Même repli que « Réglage fin » : titre à gauche, chevron à droite.
  return <Fold summary="Détails techniques">{children}</Fold>;
}
