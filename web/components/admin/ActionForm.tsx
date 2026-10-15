import { useState, type FormEvent } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { HEADER_NAME_PATTERN, refFromLabel } from '../../../shared/addons';
import { api } from '../../api';
import type { HttpActionInput, HttpActionPatch, HttpActionView, RunAction } from './types';
import { duplicateRef, plural, slug, typingSlug } from './format';
import { EnabledSelect, Field, OwnerSelect } from './shared';
import { FormOptions } from './FormOptions';
import { useUnsavedChanges } from './unsaved';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Textarea } from '../ui/textarea';

type HeaderRow = { key: string; value: string };

const headerName = new RegExp(HEADER_NAME_PATTERN, 'u');

/** Problème d’une ligne d’en-tête, ou null : le serveur refuserait le même nom. */
export function headerRowError(row: HeaderRow, rows: readonly HeaderRow[]): string | null {
  const name = row.key.trim();
  if (!name) return row.value.trim() ? 'Nom d’en-tête manquant.' : null;
  if (!headerName.test(name))
    return 'Nom invalide : lettres, chiffres et tirets, sans espace ni accent.';
  const lower = name.toLowerCase();
  if (rows.find((other) => other.key.trim().toLowerCase() === lower) !== row)
    return 'Cet en-tête est déjà présent.';
  return null;
}

export function ActionForm({
  profiles,
  action,
  actions = [],
  run,
  onDone,
  onCancel,
}: {
  profiles: Profile[];
  action?: HttpActionView;
  /** Commandes enregistrées, pour signaler un identifiant déjà pris. */
  actions?: HttpActionView[];
  run: RunAction;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const suffix = action?.id ?? 'new';
  const [label, setLabel] = useState(action?.label ?? '');
  const [ref, setRef] = useState(action?.ref ?? '');
  // Tant que l’identifiant n’a pas été modifié à la main, il suit le nom affiché.
  const [refEdited, setRefEdited] = useState(!!action);
  const [description, setDescription] = useState(action?.description ?? '');
  const [method, setMethod] = useState<'GET' | 'POST'>(action?.method ?? 'GET');
  const [url, setUrl] = useState(action?.url ?? '');
  const [owner, setOwner] = useState(action?.profileId ?? '');
  const [confirmation, setConfirmation] = useState<'required' | 'none'>(
    action?.confirmation ?? 'required',
  );
  const [enabled, setEnabled] = useState(action?.enabled ?? true);
  const [body, setBody] = useState(action?.body ?? '');
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    Object.entries(action?.headers ?? {}).map(([key, value]) => ({ key, value })),
  );

  const snapshot = JSON.stringify({
    label,
    ref,
    description,
    method,
    url,
    owner,
    confirmation,
    enabled,
    body,
    headers,
  });
  const [initial] = useState(snapshot);
  useUnsavedChanges(snapshot !== initial);

  const suggestRef = (name: string) =>
    name.trim()
      ? refFromLabel(
          name,
          new Set(actions.filter((entry) => entry.id !== action?.id).map((entry) => entry.ref)),
        )
      : '';
  const duplicate = duplicateRef(ref, owner || null, actions, action?.id ?? null);
  const headerErrors = headers.map((row) => headerRowError(row, headers));
  const headersInvalid = headerErrors.some(Boolean);

  function headerRecord(): Record<string, string> {
    const record: Record<string, string> = {};
    for (const row of headers) if (row.key.trim()) record[row.key.trim()] = row.value;
    return record;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: HttpActionInput = {
      enabled,
      ref: slug(ref) || suggestRef(label),
      label: label.trim(),
      description: description.trim(),
      method,
      url: url.trim(),
      profileId: owner || null,
      headers: headerRecord(),
      body: method === 'POST' ? body : null,
      confirmation,
    };
    const done = action
      ? await run('Commande enregistrée.', () => {
          const patch: HttpActionPatch = { ...input, enabled };
          return api.updateAction(action.id, patch);
        })
      : await run('Commande ajoutée.', () => api.createAction(input));
    if (done) await onDone();
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-dashed p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`action-label-${suffix}`} label="Nom affiché">
          <Input
            id={`action-label-${suffix}`}
            autoFocus
            autoComplete="off"
            value={label}
            maxLength={80}
            required
            onChange={(event) => {
              setLabel(event.target.value);
              if (!refEdited) setRef(suggestRef(event.target.value));
            }}
            placeholder="Par exemple, Ouvrir le portail"
          />
        </Field>
        <Field
          id={`action-ref-${suffix}`}
          label="Identifiant"
          help="Mot court qui désigne la commande à la voix : minuscules, chiffres et tirets."
          error={duplicate ? `Identifiant déjà utilisé par « ${duplicate.label} ».` : undefined}
        >
          <Input
            id={`action-ref-${suffix}`}
            autoComplete="off"
            spellCheck={false}
            value={ref}
            maxLength={64}
            required
            onChange={(event) => {
              setRefEdited(true);
              setRef(typingSlug(event.target.value));
            }}
            onBlur={() => setRef((current) => slug(current))}
            placeholder="ex. portail"
          />
        </Field>
        <Field
          className="sm:col-span-2"
          id={`action-desc-${suffix}`}
          label="Description (lue par Cornelius)"
          help={`Quand l’utiliser, en une phrase. ${description.length} / 200 caractères.`}
        >
          <Input
            id={`action-desc-${suffix}`}
            autoComplete="off"
            value={description}
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ouvre le portail d’entrée quand quelqu’un arrive"
          />
        </Field>
        <Field
          className="sm:col-span-2"
          id={`action-url-${suffix}`}
          label="Adresse (http ou https)"
        >
          <Input
            id={`action-url-${suffix}`}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            maxLength={1024}
            required
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://maison.example/portail"
          />
        </Field>
        <Field id={`action-owner-${suffix}`} label="Propriétaire">
          <OwnerSelect
            id={`action-owner-${suffix}`}
            value={owner}
            onChange={setOwner}
            profiles={profiles}
          />
        </Field>
        <Field id={`action-confirm-${suffix}`} label="Confirmation">
          <NativeSelect
            id={`action-confirm-${suffix}`}
            wrapperClassName="w-full"
            className="w-full"
            value={confirmation}
            onChange={(event) =>
              setConfirmation(event.target.value === 'none' ? 'none' : 'required')
            }
          >
            <NativeSelectOption value="required">Demander votre accord</NativeSelectOption>
            <NativeSelectOption value="none">Sans accord</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field id={`action-enabled-${suffix}`} label="État">
          <EnabledSelect id={`action-enabled-${suffix}`} value={enabled} onChange={setEnabled} />
        </Field>
      </div>

      <FormOptions
        title="Options avancées"
        summary={
          method +
          (headers.length ? ' · ' + plural(headers.length, 'en-tête') : '') +
          (method === 'POST' && body.trim() ? ' · avec corps' : '')
        }
        forceOpen={headersInvalid}
      >
        <Field
          id={`action-method-${suffix}`}
          label="Méthode"
          help="GET lit une adresse, POST envoie un ordre avec un corps."
        >
          <NativeSelect
            id={`action-method-${suffix}`}
            wrapperClassName="w-full"
            className="w-full"
            value={method}
            onChange={(event) => setMethod(event.target.value === 'POST' ? 'POST' : 'GET')}
          >
            <NativeSelectOption value="GET">GET</NativeSelectOption>
            <NativeSelectOption value="POST">POST</NativeSelectOption>
          </NativeSelect>
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Label>En-têtes</Label>
          {headers.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Aucun en-tête : la requête part telle quelle.
            </p>
          )}
          {headers.map((row, index) => {
            const error = headerErrors[index];
            const errorId = `action-header-${suffix}-${index}-error`;
            return (
              <div className="space-y-1" key={index}>
                <div className="flex flex-wrap gap-2">
                  {/* Largeur fixée par l’enveloppe : le thème force max-width à 100 % sur les champs. */}
                  <div className="w-full sm:w-56">
                    <Input
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`Nom d’en-tête ${index + 1}`}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      value={row.key}
                      onChange={(event) =>
                        setHeaders((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, key: event.target.value } : entry,
                          ),
                        )
                      }
                      placeholder="Authorization"
                    />
                  </div>
                  <Input
                    className="min-w-40 flex-1"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={`Valeur d’en-tête ${index + 1}`}
                    value={row.value}
                    onChange={(event) =>
                      setHeaders((current) =>
                        current.map((entry, position) =>
                          position === index ? { ...entry, value: event.target.value } : entry,
                        ),
                      )
                    }
                    placeholder="Bearer ${secret:PORTAIL_TOKEN}"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Retirer l’en-tête ${row.key.trim() || index + 1}`}
                    title="Retirer cet en-tête"
                    onClick={() => setHeaders((current) => current.filter((_, p) => p !== index))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {error && (
                  <p id={errorId} className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHeaders((current) => [...current, { key: '', value: '' }])}
            >
              <Plus />
              Ajouter un en-tête
            </Button>
            <span className="text-xs text-muted-foreground">
              Un secret reste hors base : écrivez <code>{'${secret:NOM}'}</code> et ajoutez{' '}
              <code>CORNELIUS_SECRET_NOM</code> dans le fichier .env.
            </span>
          </div>
        </div>
        {method === 'POST' && (
          <Field className="sm:col-span-2" id={`action-body-${suffix}`} label="Corps de la requête">
            <Textarea
              id={`action-body-${suffix}`}
              className="font-mono"
              spellCheck={false}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={'{"action":"open"}'}
            />
          </Field>
        )}
      </FormOptions>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={
            !label.trim() || !slug(ref) || !url.trim() || duplicate !== null || headersInvalid
          }
        >
          <Check />
          {action ? 'Enregistrer' : 'Ajouter'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
