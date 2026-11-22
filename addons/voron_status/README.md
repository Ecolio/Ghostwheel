# Module Imprimante 3D (voron_status)

Le module **Imprimante 3D** lit l’état d’une imprimante 3D sous Klipper/Moonraker (Voron 0, Voron 2.4, ou toute machine exposant l’API Moonraker) et l’affiche en carte à la voix. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `voron_status`).

## Ce que fait le module

- Il répond à « que fait la Voron 2.4 ? », « l’impression est-elle terminée ? », « quelles sont les températures ? », « à combien de pourcent en est l’impression ? » et affiche une carte avec l’avancement, le fichier, les températures de la buse et du lit, le temps écoulé et le filament consommé.
- Une source = une imprimante : on crée « Voron 0 » et « Voron 2.4 » avec chacune son adresse Moonraker.
- **Lecture seule** : la seule requête envoyée est `POST /printer/objects/query`. Aucun G-code, aucune macro, aucune écriture. Une imprimante hors ligne produit « Source indisponible » à l’oral et aucune carte ; elle n’est jamais confondue avec une imprimante prête.

## Réglages d’une source

Dans **Modules → Imprimante 3D → Ajouter une source** :

| Réglage           | Effet                                                                                                 | Par défaut              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| Adresse Moonraker | Hôte de l’API Moonraker, sans chemin (port 7125 en standard), par exemple `http://192.168.1.106:7125` | `http://127.0.0.1:7125` |

Le « Nom affiché » (par exemple « Voron 2.4 ») sert de titre de carte et de nom prononçable. Le jeton API, s’il est requis par Moonraker, se déclare dans **Mise en route → Clés et jetons** (secret `CORNELIUS_MOONRAKER_API_KEY`) : il est envoyé en en-tête `X-Api-Key`, jamais stocké dans la source ni journalisé. N’exposez jamais le port Moonraker sur Internet.

## Outil vocal

L’outil s’appelle `voron_status__read`. Le modèle choisit la source avec `instanceRef` quand plusieurs imprimantes sont enregistrées. Le relevé est mis en cache 15 secondes : une question de suivi ne relance pas de requête tant que le relevé est frais. Si l’imprimante ne répond pas, l’outil échoue avec « Source indisponible » et aucune carte n’est affichée ; si elle avait répondu auparavant, la carte montre le dernier relevé connu, marqué comme tel.

## Affichage permanent

Ce module ne déclare pas d’affichage permanent : la carte n’apparaît que quand on interroge l’imprimante à la voix.

## Voir aussi

- [Rapport de faisabilité Voron](../../docs/modules/voron_status.md) : contrat, sécurité et limites (aucune macro, aucun G-code).
- [API Moonraker](https://moonraker.readthedocs.io/en/latest/external_api/printer/) : `printer.objects.query`.
