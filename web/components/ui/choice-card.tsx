import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Choix exclusifs présentés en cartes (ou en pastilles), enregistrés dès qu’ils sont faits.
 *
 * Un clic, ou la barre d’espace, enregistre tout de suite. Au clavier, chaque flèche coche le
 * choix suivant : enregistrer à chaque flèche enverrait, et appliquerait, tous les choix
 * intermédiaires. Seul le dernier part, KEYBOARD_COMMIT_DELAY_MS après la dernière flèche.
 */
export const KEYBOARD_COMMIT_DELAY_MS = 500;

export type ChoiceSource = 'pointer' | 'keyboard';

export interface ChoiceCommit<T> {
  /** Un choix vient d’être fait : au pointeur il part aussitôt, au clavier après le délai. */
  pick(value: T, source: ChoiceSource): void;
  /** Envoie tout de suite un choix au clavier encore en attente. */
  flush(): void;
  /** Oublie un choix au clavier encore en attente. */
  cancel(): void;
}

/** Regroupe les choix faits aux flèches : seul le dernier est transmis à `commit`. */
export function createChoiceCommit<T>(
  commit: (value: T) => void,
  delay = KEYBOARD_COMMIT_DELAY_MS,
): ChoiceCommit<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { value: T } | null = null;
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = () => {
    stop();
    if (!pending) return;
    const { value } = pending;
    pending = null;
    commit(value);
  };
  return {
    pick(value, source) {
      stop();
      pending = { value };
      if (source === 'pointer') flush();
      else timer = setTimeout(flush, delay);
    },
    flush,
    cancel() {
      stop();
      pending = null;
    },
  };
}

export interface ChoiceOption<T extends string> {
  value: T;
  /** Titre de la carte, et nom accessible du bouton radio. */
  label: ReactNode;
  /** Explication, annoncée après le nom (aria-describedby). */
  description?: ReactNode;
  /** Courte précision entre le titre et l’explication (un modèle, une durée…). */
  meta?: ReactNode;
  disabled?: boolean;
}

/**
 * Résultat de l’enregistrement d’un choix. `false` (échec, confirmation refusée) rend aussitôt
 * l’affichage à la valeur enregistrée ; sinon le choix reste affiché jusqu’à ce que l’état du
 * serveur le confirme.
 */
export type ChoiceResult = Promise<boolean> | boolean | void;

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function ChoiceGroup<T extends string>({
  legend,
  hideLegend = false,
  value,
  options,
  onValueChange,
  onChoose,
  disabled,
  compact = false,
  className,
  describedBy,
}: {
  /** Nom du groupe : légende, visible ou réservée aux lecteurs d’écran. */
  legend: ReactNode;
  hideLegend?: boolean;
  /** Valeur enregistrée ; null quand aucun choix ne la représente (valeur personnalisée). */
  value: T | null;
  options: readonly ChoiceOption<T>[];
  /** Enregistre le choix : au clic tout de suite, aux flèches une fois la sélection posée. */
  onValueChange: (value: T) => ChoiceResult;
  /** Appelé à chaque choix, sans attendre (aperçu d’un son, par exemple). */
  onChoose?: (value: T) => void;
  disabled?: boolean;
  /** Pastilles sur une ligne, pour des choix courts (durées, préréglages). */
  compact?: boolean;
  className?: string;
  /** Explication commune au groupe. */
  describedBy?: string;
}) {
  const name = useId();
  // Choix affiché en attendant l’état du serveur : les flèches le déplacent avant l’envoi.
  const [shown, setShown] = useState<T | null>(null);
  const keyboard = useRef(false);
  const latest = useRef({ value, onValueChange });
  latest.current = { value, onValueChange };
  const [commit] = useState(() =>
    createChoiceCommit<T>((next) => {
      // Revenu au choix enregistré avant la fin du délai : rien à envoyer.
      if (next === latest.current.value) {
        setShown(null);
        return;
      }
      void Promise.resolve(latest.current.onValueChange(next)).then(
        (ok) => {
          if (ok === false) setShown(null);
        },
        () => setShown(null),
      );
    }),
  );
  // L’état du serveur a changé (ce choix confirmé, ou un autre fait ailleurs) : il l’emporte.
  useEffect(() => setShown(null), [value]);
  // Rubrique quittée juste après des flèches : le dernier choix est tout de même enregistré.
  useEffect(() => () => commit.flush(), [commit]);
  const current = shown ?? value;

  return (
    <fieldset
      className={cn('min-w-0', className)}
      disabled={disabled}
      aria-describedby={describedBy}
      onKeyDown={(event) => {
        if (ARROWS.has(event.key)) keyboard.current = true;
      }}
      onKeyUp={() => {
        keyboard.current = false;
      }}
      onPointerDown={() => {
        keyboard.current = false;
      }}
    >
      <legend
        className={
          hideLegend
            ? 'sr-only'
            : 'mb-2.5 p-0 text-xs font-semibold tracking-[0.08em] text-primary uppercase'
        }
      >
        {legend}
      </legend>
      <div
        className={
          compact
            ? 'flex flex-wrap gap-2'
            : 'grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3'
        }
      >
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            name={name}
            option={option}
            compact={compact}
            checked={current === option.value}
            onChange={() => {
              const source = keyboard.current ? 'keyboard' : 'pointer';
              keyboard.current = false;
              setShown(option.value);
              onChoose?.(option.value);
              commit.pick(option.value, source);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ChoiceCard<T extends string>({
  name,
  option,
  compact,
  checked,
  onChange,
}: {
  name: string;
  option: ChoiceOption<T>;
  compact: boolean;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  const titleId = id + '-titre';
  const descriptionId = option.description ? id + '-detail' : undefined;
  return (
    <label className="relative block cursor-pointer has-disabled:cursor-not-allowed">
      {/* Le vrai bouton radio, invisible : la carte qui suit en montre l’état et le focus. */}
      <input
        type="radio"
        className="peer absolute top-0 left-0 size-px opacity-0"
        name={name}
        value={option.value}
        checked={checked}
        disabled={option.disabled}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onChange={onChange}
      />
      {compact ? (
        <span
          className={cn(
            'inline-flex min-h-11 items-center rounded-full border border-border bg-muted px-4 text-sm transition-colors hover:border-[#5c7970] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 sm:min-h-9',
            checked && 'border-primary/70 bg-primary/15 font-medium text-foreground',
          )}
        >
          <span id={titleId}>{option.label}</span>
          {option.description && (
            <span id={descriptionId} className="sr-only">
              {option.description}
            </span>
          )}
        </span>
      ) : (
        <span
          className={cn(
            'flex h-full flex-col gap-1.5 rounded-[15px] border border-border bg-muted p-4 transition-colors hover:border-[#5c7970] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ring peer-disabled:opacity-55',
            checked && 'border-[#38b4a080] bg-[#38b4a019] hover:border-[#38b4a080]',
          )}
        >
          <span className="flex items-start justify-between gap-3">
            <span
              id={titleId}
              className="font-['Epilogue','Segoe_UI',sans-serif] text-base leading-snug font-semibold tracking-[-0.02em]"
            >
              {option.label}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'mt-[3px] size-4 shrink-0 rounded-full border border-[#667e74]',
                checked && 'border-[5px] border-[#38b4a0] bg-[#102b24]',
              )}
            />
          </span>
          {option.meta && (
            <span className="font-['DM_Mono',monospace] text-[10.5px] tracking-[0.16em] text-primary uppercase">
              {option.meta}
            </span>
          )}
          {option.description && (
            <span id={descriptionId} className="text-[13px] leading-relaxed text-muted-foreground">
              {option.description}
            </span>
          )}
        </span>
      )}
    </label>
  );
}
