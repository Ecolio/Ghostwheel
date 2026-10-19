import { useCallback, useEffect, useState } from 'react';
import { KeyRound, MicOff, TriangleAlert } from 'lucide-react';
import type { NetworkStatus, Profile } from '../../../shared/types';
import { SATELLITE_NAME_MAX, type SatelliteView } from '../../../shared/satellites';
import { api } from '../../api';
import { formatWhen } from './format';
import { ConfirmAction, Field, ResourceState } from './shared';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';

/** Jeton tout juste créé : montré une seule fois, avec ce qu’il faut saisir dans le satellite. */
interface Issued {
  name: string;
  token: string;
}

/**
 * Satellites audio : les petits micros et haut-parleurs des autres pièces, qui ouvrent une
 * conversation en voix seule quand ils entendent « Cornelius ».
 */
export function Satellites({
  profiles,
  network,
  run,
}: {
  profiles: Profile[];
  network: NetworkStatus | undefined;
  run: RunAction;
}) {
  const load = useCallback(() => api.satellites().then((result) => result.satellites), []);
  const resource = useAdminResource(load);
  const { reload } = resource;
  // Satellites en ligne ou non : la liste suit sans recharger la page.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let created: Issued | null = null;
    const ok = await run('Satellite ajouté.', async () => {
      const result = await api.createSatellite(trimmed);
      created = { name: result.satellite.name, token: result.token };
    });
    if (ok && created) {
      setIssued(created);
      setName('');
      await resource.reload();
    }
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Satellites audio</CardTitle>
          <CardDescription>
            Un satellite écoute « Cornelius » dans une autre pièce et y tient la conversation, à
            voix seule : ni carte, ni caméra. Une seule conversation à la fois dans la maison.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {network && !network.lan && (
            <p className="flex items-start gap-2.5 rounded-lg border border-[#e8bc8866] bg-[#2a2519] px-3.5 py-3 text-[#f3d7b0]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                L’accès depuis le réseau local est désactivé : un satellite ne peut pas se
                connecter. Voir la carte « Accès depuis le réseau local » dans Mise en route.
              </span>
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field
              id="satellite-name"
              label="Pièce du nouveau satellite"
              className="min-w-56 flex-1"
            >
              <Input
                id="satellite-name"
                value={name}
                maxLength={SATELLITE_NAME_MAX}
                placeholder="Chambre, cuisine…"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!name.trim()}>
              Ajouter
            </Button>
          </form>
          {issued && (
            <IssuedToken issued={issued} network={network} onClose={() => setIssued(null)} />
          )}
        </CardContent>
      </Card>
      <ResourceState
        resource={resource}
        loadingLabel="Lecture des satellites…"
        isEmpty={(satellites) => satellites.length === 0}
        empty={{
          title: 'Aucun satellite pour l’instant.',
          description:
            'Ajoutez-en un ci-dessus, puis saisissez son jeton dans le satellite lors de sa configuration.',
        }}
      >
        {(satellites) => (
          <div className="space-y-4">
            {satellites.map((satellite) => (
              <SatelliteCard
                key={satellite.id}
                satellite={satellite}
                profiles={profiles}
                run={run}
                onIssued={setIssued}
                onChanged={() => void resource.reload()}
              />
            ))}
          </div>
        )}
      </ResourceState>
    </div>
  );
}

function IssuedToken({
  issued,
  network,
  onClose,
}: {
  issued: Issued;
  network: NetworkStatus | undefined;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const addresses = (network?.urls ?? []).map(
    (url) => url.replace(/^https:/u, 'wss:') + '/satellite',
  );
  return (
    <div
      className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
      role="region"
      aria-label={'Jeton du satellite ' + issued.name}
    >
      <p className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4 text-primary" aria-hidden="true" />
        Jeton de « {issued.name} », affiché une seule fois
      </p>
      <p className="break-all rounded bg-background px-3 py-2 font-mono text-xs">{issued.token}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(issued.token)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }
        >
          {copied ? 'Copié' : 'Copier le jeton'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          C’est noté
        </Button>
      </div>
      <p className="text-muted-foreground">
        À saisir dans le satellite, avec l’adresse de Cornelius
        {addresses.length > 0 ? ' :' : '.'}
      </p>
      {addresses.length > 0 && (
        <ul className="space-y-1 font-mono text-xs" aria-label="Adresses pour les satellites">
          {addresses.map((address) => (
            <li key={address}>{address}</li>
          ))}
        </ul>
      )}
      {network?.keyFingerprint && (
        <p className="text-muted-foreground">
          Et l’empreinte de la clé de Cornelius, que le satellite vérifie à chaque connexion (elle
          ne change pas quand le certificat est renouvelé) :{' '}
          <span className="break-all font-mono text-xs text-foreground">
            {network.keyFingerprint}
          </span>
        </p>
      )}
    </div>
  );
}

function SatelliteCard({
  satellite,
  profiles,
  run,
  onIssued,
  onChanged,
}: {
  satellite: SatelliteView;
  profiles: Profile[];
  run: RunAction;
  onIssued: (issued: Issued) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(satellite.name);
  const [volume, setVolume] = useState(String(satellite.volume));
  const [profileId, setProfileId] = useState(satellite.profileId ?? '');
  const [confirming, setConfirming] = useState<'token' | 'remove' | null>(null);
  const volumeValue = Number(volume);
  const volumeValid = /^\d{1,3}$/u.test(volume) && volumeValue <= 100;
  const changed =
    name.trim() !== satellite.name ||
    (volumeValid && volumeValue !== satellite.volume) ||
    profileId !== (satellite.profileId ?? '');
  const id = 'satellite-' + satellite.id;
  const save = async () => {
    const ok = await run('Satellite enregistré.', () =>
      api.updateSatellite(satellite.id, {
        name: name.trim(),
        volume: volumeValue,
        profileId: profileId || null,
      }),
    );
    if (ok) onChanged();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {satellite.name}
          <Badge variant={satellite.online ? 'default' : 'outline'}>
            {satellite.online ? 'En ligne' : 'Hors ligne'}
          </Badge>
          {satellite.online && satellite.muted && (
            <Badge variant="secondary">
              <MicOff aria-hidden="true" />
              Micro coupé
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {satellite.online
            ? 'Connecté' + (satellite.firmware ? ', firmware ' + satellite.firmware : '') + '.'
            : 'Vu pour la dernière fois : ' + formatWhen(satellite.lastSeenAt) + '.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <form
          className="grid gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed && volumeValid && name.trim()) void save();
          }}
        >
          <Field id={id + '-name'} label="Pièce">
            <Input
              id={id + '-name'}
              value={name}
              maxLength={SATELLITE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            id={id + '-volume'}
            label="Volume"
            error={volumeValid ? undefined : 'Un nombre de 0 à 100.'}
          >
            <Input
              id={id + '-volume'}
              inputMode="numeric"
              value={volume}
              onChange={(event) => setVolume(event.target.value)}
            />
          </Field>
          <Field
            id={id + '-profile'}
            label="Conversations au nom de"
            help={
              profileId
                ? 'Quiconque parle dans cette pièce accède à la mémoire de cette personne.'
                : 'Personne : conversations anonymes, sans mémoire personnelle.'
            }
          >
            <NativeSelect
              id={id + '-profile'}
              wrapperClassName="w-full"
              className="w-full"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            >
              <NativeSelectOption value="">Personne (anonyme)</NativeSelectOption>
              {profiles.map((profile) => (
                <NativeSelectOption key={profile.id} value={profile.id}>
                  {profile.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {changed && (
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" size="sm" disabled={!volumeValid || !name.trim()}>
                Enregistrer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setName(satellite.name);
                  setVolume(String(satellite.volume));
                  setProfileId(satellite.profileId ?? '');
                }}
              >
                Annuler
              </Button>
            </div>
          )}
        </form>
        {confirming === 'token' ? (
          <ConfirmAction
            message={`Créer un nouveau jeton pour « ${satellite.name} » ? L’ancien cesse aussitôt de fonctionner : il faudra saisir le nouveau dans le satellite.`}
            confirmLabel="Nouveau jeton"
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              let token: string | null = null;
              void run('Nouveau jeton créé.', async () => {
                token = (await api.renewSatelliteToken(satellite.id)).token;
              }).then((ok) => {
                if (ok && token) onIssued({ name: satellite.name, token });
                onChanged();
              });
            }}
          />
        ) : confirming === 'remove' ? (
          <ConfirmAction
            message={`Retirer « ${satellite.name} » ? Il est déconnecté et son jeton ne fonctionne plus.`}
            confirmLabel="Retirer"
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              void run('Satellite retiré.', () => api.removeSatellite(satellite.id)).then(
                onChanged,
              );
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirming('token')}>
              Nouveau jeton
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming('remove')}>
              Retirer
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
