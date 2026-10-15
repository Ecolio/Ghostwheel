import type { ReactNode } from 'react';
import { LayoutPanelTop } from 'lucide-react';
import type { MirrorState } from '../../../shared/types';
import {
  CARD_COUNT_MAX,
  CARD_COUNT_MIN,
  CARD_LIFETIME_PRESETS_MS,
  DEFAULT_CARD_SETTINGS,
  type CardSettings as Settings,
} from '../../../shared/cards';
import { api } from '../../api';
import { plural } from './format';
import { Field, ModulePanel } from './shared';
import type { RunAction } from './types';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

function lifetimeLabel(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : plural(Math.round(seconds / 60), 'minute');
}

/** Module natif « Cartes » : combien de cartes, leur forme au second plan, leur durée. */
export function CardSettings({
  state,
  run,
  hidden,
  action,
}: {
  state: MirrorState;
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const settings = state.cardSettings ?? DEFAULT_CARD_SETTINGS;
  const save = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    void run('Cartes enregistrées.', () => api.cards(next), { key: 'cards', payload: next });
  };
  const lifetimes = CARD_LIFETIME_PRESETS_MS.includes(
    settings.lifetimeMs as (typeof CARD_LIFETIME_PRESETS_MS)[number],
  )
    ? CARD_LIFETIME_PRESETS_MS
    : [...CARD_LIFETIME_PRESETS_MS, settings.lifetimeMs].sort((a, b) => a - b);
  return (
    <ModulePanel
      id="module-cards"
      icon={LayoutPanelTop}
      title="Cartes"
      subtitle="Les réponses affichées sur le miroir"
      badge={
        <Badge variant="secondary">
          {plural(settings.maxCards, 'carte')} · {lifetimeLabel(settings.lifetimeMs)}
        </Badge>
      }
      action={action}
      hidden={hidden}
    >
      <p className="text-sm text-muted-foreground">
        Chaque réponse utile (une date, un chiffre, une liste, la météo, un bus) s’affiche sur une
        carte. La plus récente est au premier plan, les précédentes passent sur le côté.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cards-max" label="Cartes à l’écran" help="La principale et les complémentaires.">
          <NativeSelect
            id="cards-max"
            wrapperClassName="w-full"
            className="w-full"
            value={String(settings.maxCards)}
            onChange={(event) => save({ maxCards: Number(event.target.value) })}
          >
            {Array.from({ length: CARD_COUNT_MAX - CARD_COUNT_MIN + 1 }, (_, index) => {
              const count = CARD_COUNT_MIN + index;
              return (
                <NativeSelectOption key={count} value={String(count)}>
                  {count === 1 ? '1 carte (seulement la principale)' : plural(count, 'carte')}
                  {count === DEFAULT_CARD_SETTINGS.maxCards ? ' (par défaut)' : ''}
                </NativeSelectOption>
              );
            })}
          </NativeSelect>
        </Field>
        <Field
          id="cards-lifetime"
          label="Disparition après"
          help="Temps d’affichage d’une carte depuis son apparition."
        >
          <NativeSelect
            id="cards-lifetime"
            wrapperClassName="w-full"
            className="w-full"
            value={String(settings.lifetimeMs)}
            onChange={(event) => save({ lifetimeMs: Number(event.target.value) })}
          >
            {lifetimes.map((ms) => (
              <NativeSelectOption key={ms} value={String(ms)}>
                {lifetimeLabel(ms)}
                {ms === DEFAULT_CARD_SETTINGS.lifetimeMs ? ' (par défaut)' : ''}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="cards-compact">Raccourcir les cartes au second plan</Label>
          <p className="text-xs text-muted-foreground" id="cards-compact-detail">
            Activé : une carte qui passe sur le côté garde son titre, sa valeur et deux lignes.
            Désactivé : elle reste entière.
          </p>
        </div>
        <Switch
          id="cards-compact"
          aria-describedby="cards-compact-detail"
          checked={settings.compactSecondary}
          disabled={settings.maxCards === 1}
          onCheckedChange={(compactSecondary) => save({ compactSecondary })}
        />
      </div>
    </ModulePanel>
  );
}
