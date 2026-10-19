# Protocole des satellites audio

Cette page décrit le dialogue entre Cornelius et un satellite audio (micro et haut-parleur sur ESP32-S3, par exemple la carte Waveshare ESP32-S3-AUDIO-Board). Elle s’adresse aux personnes qui écrivent le firmware, développé dans un dépôt séparé, et à celles qui modifient le serveur. Le protocole est versionné : toute modification incompatible change son numéro.

État : **version 1, en cours de développement** sur la branche `satellite`. Seule la veille (mot d’appel) est en place ; la conversation viendra dans une étape suivante.

## Principe

- Un satellite ne parle qu’à Cornelius, jamais à OpenAI : la clé reste sur l’ordinateur du miroir.
- En veille, le satellite envoie le son de son micro ; l’ordinateur y cherche « Cornelius » avec le même modèle que le miroir. Le son n’est envoyé que lorsque le serveur le demande (message `listen`).
- Une seule conversation à la fois dans toute la maison : miroir ou un satellite.
- Quand le miroir et un satellite entendent « Cornelius » en même temps, l’appareil au meilleur score l’emporte.

## Connexion

| | |
|---|---|
| Adresse | `wss://<ordinateur>:3443/satellite` depuis le réseau local (accès réseau local activé), `ws://127.0.0.1:3000/satellite` depuis l’ordinateur lui-même |
| Authentification | en-tête `Authorization: Bearer <jeton>`, jeton créé dans l’administration et montré une seule fois |
| Origine | aucun en-tête `Origin` : un satellite n’est pas un navigateur |
| TLS | certificat auto-signé de Cornelius ; le satellite épingle son empreinte SHA-256, affichée dans **Réseau local** |
| Maintien | le serveur envoie un ping WebSocket toutes les 15 s et coupe un satellite muet depuis 30 s |

Un jeton inconnu ou révoqué est refusé (403) avant l’ouverture du WebSocket.

## Son

Le son circule en messages binaires, toujours au même format :

- PCM 16 bits signé little-endian, mono, 16 000 Hz ;
- trames de **2 560 octets** (1 280 échantillons, 80 ms) dans le sens satellite → serveur.

Une trame d’une autre taille ferme la connexion. Le satellite envoie les trames au rythme du micro, sans les regrouper.

## Messages

Les autres messages sont des objets JSON en texte, avec un champ `type`. Un message inconnu est ignoré par le serveur, sauf avant `hello`.

### Satellite → serveur

| Message | Quand | Effet |
|---|---|---|
| `{"type":"hello","protocol":1,"firmware":"0.1.0"}` | premier message, dans les 5 s | le serveur répond `welcome`, ou ferme si le protocole n’est pas pris en charge |
| binaire, 2 560 octets | tant que `listen` vaut `true` | cherché pour « Cornelius » |
| `{"type":"mic","muted":true}` | bouton de vie privée | le serveur ignore le son tant que le micro est coupé |

`firmware` est une chaîne de 1 à 32 caractères.

### Serveur → satellite

| Message | Sens |
|---|---|
| `{"type":"welcome","protocol":1,"id":"…","name":"Chambre","volume":70}` | connexion acceptée ; `volume` de 0 à 100 |
| `{"type":"listen","enabled":true}` | envoyer (`true`) ou cesser d’envoyer (`false`) le son du micro ; envoyé après `welcome` puis à chaque changement |
| `{"type":"wake","score":0.93}` | « Cornelius » a été entendu par ce satellite (signal lumineux) |

`listen` passe à `false` quand le mot d’appel est désactivé ou pas prêt, ou qu’une conversation est en cours.

## Fermetures

| Code | Raison |
|---|---|
| 1008 | `hello` absent, invalide ou de protocole non pris en charge ; trame invalide ; satellite révoqué ou reconnecté ailleurs |
| 1001 | arrêt du serveur |

Après une fermeture, le satellite se reconnecte avec un délai croissant (1 s, 2 s, 4 s… jusqu’à 60 s).

## Essayer sans matériel

Créer un satellite et afficher son jeton :

```sh
npx tsx --env-file-if-exists=.env scripts/satellite-ajouter.ts "Bureau"
```

Puis simuler le satellite avec un enregistrement WAV (PCM mono 16 kHz) qui contient « Cornelius » :

```sh
npx tsx scripts/satellite-sim.ts --token <jeton> --wav question.wav
```

Le simulateur envoie du silence, puis l’enregistrement, au rythme réel, et affiche les messages du serveur.

## À venir

- Conversation : son de Cornelius vers le satellite (même format, en continu au rythme réel), états `listening`, `speaking`, `busy`.
- Mot d’appel détecté sur le satellite (`wake` envoyé par le satellite avec le son qui précède), vérifié par le serveur.
- Bouton d’action, volume, mise à jour du firmware.
