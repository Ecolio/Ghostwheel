import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Réglages secondaires d’un formulaire, repliés par défaut. `forceOpen` les déplie tant qu’un
 * champ caché demande une correction (identifiant en double, par exemple).
 */
export function FormOptions({
  title = 'Options',
  summary,
  forceOpen = false,
  defaultOpen = false,
  className,
  children,
}: {
  title?: string;
  summary?: ReactNode;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Une fois dépliées pour une correction, elles le restent : pas de repli sous le curseur.
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <details
      className={cn('group rounded-md border', className)}
      open={open || forceOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-secondary/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          {title}
          {summary && (
            <span className="ml-2 font-normal break-words text-muted-foreground">{summary}</span>
          )}
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="grid gap-4 border-t p-3 sm:grid-cols-2">{children}</div>
    </details>
  );
}
