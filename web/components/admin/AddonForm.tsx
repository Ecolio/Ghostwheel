import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Search } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { refFromLabel } from '../../../shared/addons';
import { api, errorMessage } from '../../api';
import type {
  AddonConfigError,
  AddonConfigField,
  AddonDefinitionView,
  AddonInstancePatch,
  AddonInstanceView,
  AddonSearchFieldView,
  AddonSearchResultView,
  RunAction,
} from './types';
import {
  decimalText,
  duplicateRef,
  parseDecimal,
  slug,
  spokenPhrase,
  timeZoneGroups,
  typingSlug,
} from './format';
import { FormOptions } from './FormOptions';
import { DecimalInput, EnabledSelect, Field, OwnerSelect } from './shared';
import { useUnsavedChanges } from './unsaved';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

function baseType(field: AddonConfigField): string {
  const type = Array.isArray(field.type)
    ? field.type.find((value) => value !== 'null')
    : field.type;
  return type ?? 'string';
}

function isNullable(field: AddonConfigField): boolean {
  return Array.isArray(field.type) ? field.type.includes('null') : false;
}

/** Libellé et exemple viennent du config.schema.json du module (title, examples). */
function labelOf(name: string, field: AddonConfigField): string {
  return field.title ?? name;
}

function exampleOf(field: AddonConfigField): string | undefined {
  const example = field.examples?.[0];
  if (typeof example === 'number') return 'ex. ' + example.toLocaleString('fr-FR');
  return typeof example === 'string' ? 'ex. ' + example : undefined;
}

/** Un fuseau horaire se choisit dans la liste du navigateur plutôt que de se taper. */
function isTimeZone(name: string): boolean {
  return /^time_?zone$/iu.test(name);
}

function toForm(
  definition: AddonDefinitionView,
  config: Record<string, unknown>,
): Record<string, string> {
  const form: Record<string, string> = {};
  for (const [name, field] of Object.entries(definition.configSchema.properties ?? {})) {
    const value = config[name];
    form[name] =
      value === null || value === undefined
        ? ''
        : // Un nombre décimal s’affiche avec la virgule, comme il se saisit.
          baseType(field) === 'number' && typeof value === 'number'
          ? decimalText(value)
          : String(value);
  }
  return form;
}

function toConfig(
  definition: AddonDefinitionView,
  form: Record<string, string>,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(definition.configSchema.properties ?? {})) {
    const raw = (form[name] ?? '').trim();
    const type = baseType(field);
    if (raw === '') {
      config[name] = isNullable(field) || type !== 'string' ? null : '';
    } else if (type === 'integer') {
      config[name] = Number(raw);
    } else if (type === 'number') {
      // « 45,75 » comme « 45.75 » ; une saisie illisible part telle quelle et le contrôle du
      // serveur la signale sous le champ (« Nombre attendu. »).
      const value = parseDecimal(raw);
      config[name] = Number.isFinite(value) ? value : raw;
    } else if (type === 'boolean') {
      config[name] = raw === 'true';
    } else {
      config[name] = raw;
    }
  }
  return config;
}

export function InstanceForm({
  defaultProfileId = null,
  definition,
  profiles,
  instance,
  siblings = [],
  run,
  onDone,
  onCancel,
}: {
  definition: AddonDefinitionView;
  profiles: Profile[];
  instance?: AddonInstanceView;
  /** Sources du même module, pour signaler un identifiant déjà pris. */
  siblings?: AddonInstanceView[];
  defaultProfileId?: string | null;
  run: RunAction;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(instance?.label ?? '');
  const [ref, setRef] = useState(instance?.ref ?? '');
  // Tant que l’identifiant n’a pas été modifié à la main, il suit le nom affiché.
  const [refEdited, setRefEdited] = useState(!!instance?.ref);
  const [owner, setOwner] = useState(
    instance ? (instance.profileId ?? '') : (defaultProfileId ?? ''),
  );
  const [enabled, setEnabled] = useState(instance?.enabled ?? true);
  const [displayEnabled, setDisplayEnabled] = useState(instance?.displayEnabled ?? false);
  const [form, setForm] = useState<Record<string, string>>(() =>
    toForm(definition, instance?.config ?? definition.configDefaults),
  );
  // Erreurs par champ renvoyées par le serveur ; un champ modifié perd la sienne.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const clearError = (...names: string[]) =>
    setErrors((current) => {
      if (![...names, ''].some((name) => name in current)) return current;
      const next = { ...current };
      for (const name of [...names, '']) delete next[name];
      return next;
    });
  const setField = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    clearError(name);
  };
  const suffix = instance?.id ?? definition.id;
  // Exemple propre au module (`display.example`) : « Bus maison » n’a pas de sens pour l’heure.
  const example = definition.display?.example ?? { label: 'Ma source', ref: 'maison' };
  const [initial] = useState(() =>
    JSON.stringify({ label, ref, owner, enabled, displayEnabled, form }),
  );
  useUnsavedChanges(
    JSON.stringify({ label, ref, owner, enabled, displayEnabled, form }) !== initial,
  );
  // Les champs alimentés par la recherche assistée ne sont pas saisis à la main.
  const managed = new Set(
    definition.search
      .flatMap((field) => [field.target, field.labelTarget])
      .filter((name): name is string => Boolean(name)),
  );
  const suggestRef = (name: string) =>
    name.trim()
      ? refFromLabel(
          name,
          new Set(
            siblings
              .filter((sibling) => sibling.id !== instance?.id && sibling.ref)
              .map((sibling) => sibling.ref!),
          ),
        )
      : '';
  const refTaken = (candidate: string) =>
    duplicateRef(candidate, owner || null, siblings, instance?.id ?? null);
  const duplicate = refTaken(ref);
  // Champs saisis d’abord, interrupteurs ensuite : l’ordre affiché.
  const moduleFields = Object.entries(definition.configSchema.properties ?? {})
    .filter(([name]) => !managed.has(name))
    .sort(([, a], [, b]) => Number(baseType(a) === 'boolean') - Number(baseType(b) === 'boolean'))
    .map(([name]) => name);
  const hasModuleFields = definition.search.length > 0 || moduleFields.length > 0;
  const optionsSummary = [
    slug(ref) ? `identifiant ${slug(ref)}` : null,
    owner ? (profiles.find((profile) => profile.id === owner)?.name ?? null) : 'le foyer',
    enabled ? null : 'désactivée',
  ]
    .filter(Boolean)
    .join(' · ');
  // Laissé vide, l’identifiant est tiré du nom à l’enregistrement : la phrase le montre déjà.
  const spoken = spokenPhrase(definition.display?.spoken, slug(ref) || suggestRef(label), label);
  const missingSelection = definition.search.some(
    (field) =>
      (definition.configSchema.required ?? []).includes(field.target) &&
      !isNullable(definition.configSchema.properties?.[field.target] ?? {}) &&
      !(form[field.target] ?? '').trim(),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const config = toConfig(definition, form);
    setChecking(true);
    let found: AddonConfigError[] = [];
    try {
      found = (await api.validateAddonConfig(definition.id, config)).errors;
    } catch {
      // Contrôle indisponible : l’enregistrement revalide de toute façon côté serveur.
    } finally {
      setChecking(false);
    }
    if (found.length > 0) {
      const next: Record<string, string> = {};
      for (const error of found) next[error.path] ??= error.message;
      setErrors(next);
      focusField(found.find((error) => error.path)?.path);
      return;
    }
    setErrors({});
    const profileId = owner || null;
    const trimmedRef = slug(ref) || null;
    const done = instance
      ? await run('Source enregistrée.', () => {
          const patch: AddonInstancePatch = {
            label: label.trim(),
            ref: trimmedRef,
            profileId,
            enabled,
            displayEnabled: definition.ambient && displayEnabled,
            config,
          };
          return api.updateAddonInstance(instance.id, patch);
        })
      : await run('Source ajoutée.', () =>
          api.createAddonInstance({
            addonId: definition.id,
            enabled,
            displayEnabled: definition.ambient && displayEnabled,
            profileId,
            ref: trimmedRef,
            label: label.trim(),
            config,
          }),
        );
    if (done) await onDone();
  }

  /** Place le focus sur le premier champ signalé, recherche assistée comprise. */
  function focusField(name: string | undefined) {
    if (!name) return;
    const search = definition.search.find(
      (field) => field.target === name || field.labelTarget === name,
    );
    const id = search ? `search-${definition.id}-${search.kind}` : `${name}-${suffix}`;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-dashed p-4"
      // Les erreurs viennent du contrôle serveur, en français et sous chaque champ.
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      {definition.search.length > 0 && (
        <div className="space-y-3">
          {definition.search.map((field, index) => (
            <SearchPicker
              autoFocus={index === 0}
              key={`${field.kind}:${field.dependsOn ? form[field.dependsOn] : ''}`}
              definition={definition}
              field={field}
              values={form}
              error={
                errors[field.target] ?? (field.labelTarget ? errors[field.labelTarget] : undefined)
              }
              allowClear={isNullable(definition.configSchema.properties?.[field.target] ?? {})}
              onSelect={(result) => {
                clearError(field.target, ...(field.labelTarget ? [field.labelTarget] : []));
                setForm((current) => {
                  const next = {
                    ...current,
                    [field.target]: result.id,
                    ...(field.labelTarget ? { [field.labelTarget]: result.label } : {}),
                  };
                  if (current[field.target] !== result.id) {
                    const changed = new Set([field.target]);
                    for (const target of changed) {
                      for (const dependent of definition.search) {
                        if (dependent.dependsOn !== target || changed.has(dependent.target))
                          continue;
                        next[dependent.target] = '';
                        if (dependent.labelTarget) next[dependent.labelTarget] = '';
                        changed.add(dependent.target);
                      }
                    }
                  }
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}
      {/* Champs saisis d’abord, interrupteurs oui ou non ensuite, chacun dans sa grille. */}
      {[false, true].map((switches) => {
        const fields = Object.entries(definition.configSchema.properties ?? {}).filter(
          ([name, field]) => !managed.has(name) && (baseType(field) === 'boolean') === switches,
        );
        if (fields.length === 0) return null;
        return (
          <div
            key={switches ? 'switches' : 'fields'}
            className={switches ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'}
          >
            {fields.map(([name, field]) => (
              <ConfigField
                key={name}
                autoFocus={definition.search.length === 0 && name === moduleFields[0]}
                id={`${name}-${suffix}`}
                name={name}
                field={field}
                required={(definition.configSchema.required ?? []).includes(name)}
                value={form[name] ?? ''}
                error={errors[name]}
                onChange={(value) => setField(name, value)}
              />
            ))}
          </div>
        );
      })}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`label-${suffix}`}
          label="Nom affiché"
          help={spoken ? `Pour l’obtenir à la voix, dites : « ${spoken} ».` : undefined}
        >
          <Input
            id={`label-${suffix}`}
            autoFocus={!hasModuleFields}
            autoComplete="off"
            value={label}
            maxLength={80}
            required
            onChange={(event) => {
              setLabel(event.target.value);
              if (!refEdited) setRef(suggestRef(event.target.value));
            }}
            placeholder={'Par exemple, ' + example.label}
          />
        </Field>
      </div>
      {definition.ambient && (
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Switch
            id={`display-${suffix}`}
            checked={displayEnabled}
            onCheckedChange={setDisplayEnabled}
          />
          <div className="space-y-1">
            <Label htmlFor={`display-${suffix}`}>Afficher en permanence sur le miroir</Label>
            <p className="text-xs text-muted-foreground">
              Dès la reconnaissance du propriétaire, sans demande vocale. Les sources du foyer
              s’affichent pendant la présence. Les données se rafraîchissent automatiquement.
            </p>
          </div>
        </div>
      )}
      <FormOptions summary={optionsSummary} forceOpen={duplicate !== null}>
        <Field
          id={`ref-${suffix}`}
          label="Identifiant"
          help="Mot court qui désigne cette source à la voix : minuscules, chiffres et tirets. Laissé vide, il est tiré du nom."
          error={duplicate ? `Identifiant déjà utilisé par « ${duplicate.label} ».` : undefined}
        >
          <Input
            id={`ref-${suffix}`}
            autoComplete="off"
            spellCheck={false}
            value={ref}
            maxLength={64}
            onChange={(event) => {
              setRefEdited(true);
              setRef(typingSlug(event.target.value));
            }}
            onBlur={() => setRef((current) => slug(current))}
            placeholder={'ex. ' + example.ref}
          />
        </Field>
        <Field id={`owner-${suffix}`} label="Propriétaire">
          <OwnerSelect
            id={`owner-${suffix}`}
            value={owner}
            onChange={setOwner}
            profiles={profiles}
          />
        </Field>
        <Field id={`enabled-${suffix}`} label="État">
          <EnabledSelect id={`enabled-${suffix}`} value={enabled} onChange={setEnabled} />
        </Field>
      </FormOptions>
      {Object.keys(errors).length > 0 && (
        <p className="text-sm text-destructive" role="alert">
          {errors[''] ?? 'Réglage incomplet : corrigez les champs signalés.'}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!label.trim() || missingSelection || duplicate !== null || checking}
        >
          <Check />
          {instance ? 'Enregistrer' : 'Ajouter'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function SearchPicker({
  autoFocus = false,
  definition,
  field,
  values,
  error,
  allowClear,
  onSelect,
}: {
  autoFocus?: boolean;
  definition: AddonDefinitionView;
  field: AddonSearchFieldView;
  values: Record<string, string>;
  error?: string;
  allowClear: boolean;
  onSelect: (result: AddonSearchResultView) => void;
}) {
  const errorId = `search-${definition.id}-${field.kind}-error`;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddonSearchResultView[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );
  const dependencyMissing = field.dependsOn ? !(values[field.dependsOn] ?? '').trim() : false;
  const dependency = definition.search.find((candidate) => candidate.target === field.dependsOn);
  const selected = field.labelTarget ? values[field.labelTarget] : values[field.target];

  async function search() {
    if (dependencyMissing || busy) return;
    const id = ++requestId.current;
    setBusy(true);
    setNote(null);
    setResults([]);
    try {
      const response = await api.searchAddon(definition.id, {
        kind: field.kind,
        query: query.trim(),
        values,
      });
      if (id !== requestId.current) return;
      setResults(response.results);
      if (response.results.length === 0) setNote('Aucun résultat.');
    } catch (failure) {
      if (id === requestId.current) setNote(errorMessage(failure));
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <Label htmlFor={`search-${definition.id}-${field.kind}`}>{field.label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`search-${definition.id}-${field.kind}`}
          className="max-w-xs"
          type="search"
          autoComplete="off"
          autoFocus={autoFocus}
          value={query}
          disabled={dependencyMissing}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={
            dependencyMissing
              ? 'Choisissez d’abord : ' + (dependency?.label ?? 'le champ précédent').toLowerCase()
              : field.placeholder
          }
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void search();
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || dependencyMissing}
          onClick={() => void search()}
        >
          <Search />
          {busy ? 'Recherche…' : 'Chercher'}
        </Button>
      </div>
      {allowClear && selected && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            requestId.current++;
            setBusy(false);
            setResults([]);
            setNote(null);
            onSelect({ id: '', label: '' });
          }}
        >
          {field.clearLabel ?? 'Effacer la sélection'}
        </Button>
      )}
      {selected ? (
        <p className="text-xs text-muted-foreground">
          Sélection : <span className="text-foreground">{selected}</span>
        </p>
      ) : (
        !busy &&
        !results.length &&
        !note && (
          <p className="text-xs text-muted-foreground">
            {dependencyMissing
              ? 'Disponible après le choix précédent.'
              : 'Tapez quelques lettres puis Entrée pour chercher.'}
          </p>
        )
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
      {note && (
        <p className="text-xs text-muted-foreground" role="status">
          {note}
        </p>
      )}
      {results.length > 0 && (
        <ul className="divide-y rounded-md border">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-secondary/50"
                onClick={() => {
                  onSelect(result);
                  setResults([]);
                  setNote(null);
                }}
              >
                <span>{result.label}</span>
                {result.detail && (
                  <span className="text-xs text-muted-foreground">{result.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ConfigField({
  id,
  name,
  field,
  required,
  value,
  error,
  autoFocus = false,
  onChange,
}: {
  id: string;
  name: string;
  field: AddonConfigField;
  required: boolean;
  value: string;
  error?: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const type = baseType(field);
  const nullable = isNullable(field);
  const range =
    field.minimum !== undefined && field.maximum !== undefined
      ? `De ${field.minimum.toLocaleString('fr-FR')} à ${field.maximum.toLocaleString('fr-FR')}.`
      : undefined;
  const help = field.description ?? range;
  if (type === 'boolean') {
    // Interrupteur : un réglage oui ou non se lit et se change d’un geste.
    const described = [error ? `${id}-error` : '', help ? `${id}-help` : '']
      .filter(Boolean)
      .join(' ');
    return (
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Switch
          id={id}
          autoFocus={autoFocus}
          checked={value === 'true'}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
        />
        <div className="space-y-1">
          <Label htmlFor={id}>{labelOf(name, field)}</Label>
          {error && (
            <p id={`${id}-error`} className="text-xs text-destructive">
              {error}
            </p>
          )}
          {help && (
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              {help}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <Field
      id={id}
      label={
        <>
          {labelOf(name, field)}
          {required && !nullable && (
            <span className="text-muted-foreground" aria-hidden="true">
              *
            </span>
          )}
        </>
      }
      help={help}
      error={error}
    >
      {isTimeZone(name) ? (
        <NativeSelect
          id={id}
          wrapperClassName="w-full"
          className="w-full"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {timeZoneGroups(value).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.zones.map((zone) => (
                <NativeSelectOption key={zone.value} value={zone.value}>
                  {zone.label}
                </NativeSelectOption>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      ) : type === 'number' ? (
        <DecimalInput
          id={id}
          autoFocus={autoFocus}
          value={value}
          required={required && !nullable}
          onChange={(event) => onChange(event.target.value)}
          placeholder={exampleOf(field) ?? (nullable ? 'Facultatif' : undefined)}
        />
      ) : (
        <Input
          id={id}
          autoFocus={autoFocus}
          value={value}
          inputMode={type === 'integer' ? 'numeric' : 'text'}
          pattern={field.pattern}
          maxLength={field.maxLength}
          min={field.minimum}
          max={field.maximum}
          type={type === 'integer' ? 'number' : 'text'}
          step={type === 'integer' ? 1 : undefined}
          required={required && !nullable}
          onChange={(event) => onChange(event.target.value)}
          placeholder={exampleOf(field) ?? (nullable ? 'Facultatif' : undefined)}
        />
      )}
    </Field>
  );
}
