# Module Ragator

Le module Ragator pose une question à [Ragator](https://git.diy.yt/lfpoulain/ragator), le moteur de recherche citée sur les vidéos YouTube des Frères Poulain, et rapporte sa réponse avec les vidéos et l’instant qui la prouvent. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `ragator`).

## Ce que fait le module

- Il répond à « dans quelle vidéo ils parlent de la glacière ? », « comment ils ont fabriqué le skee-ball ? », « la première fois qu’ils utilisent une scie circulaire ? » et affiche une carte « Ragator » : la question, la réponse, puis une ligne par vidéo citée (cinq au plus) avec l’instant et la date de la vidéo.
- Cornelius dit la réponse sans les références entre crochets. Quand Ragator répond que le corpus ne contient pas l’information, Cornelius le dit tel quel.
- Chaque question est posée à Ragator : aucune réponse n’est gardée en cache, et une panne ne ressert jamais la réponse à une autre question.
- Une question précise prend environ 5 secondes, une question générale une douzaine (jusqu’à une minute en mode local de Ragator). Le module attend 60 secondes au plus.

## Avant de commencer

Ragator doit tourner et son interface web répondre (`npm run web` ou ses conteneurs, voir sa documentation). Aucun jeton n’est demandé côté Cornelius.

- Ragator sur le même ordinateur : rien à faire, l’adresse par défaut `http://127.0.0.1:3210` convient.
- Ragator sur une autre machine (un NAS, par exemple) : déclarez côté Ragator l’adresse utilisée par Cornelius dans `RAGATOR_HOSTS`, sinon Ragator refuse la requête (« Ragator refuse cette adresse… »).
- Le mot de passe de Ragator (`RAGATOR_PASSWORD`) n’est pas encore pris en charge : laissez-le vide, ou limitez l’accès par le réseau.

## Réglages d’une source

Dans **Modules → Ragator → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Adresse de Ragator | Adresse de l’interface web, sans chemin (`http://nas.local:3210`) | `http://127.0.0.1:3210` |
| Collection | Clé ou nom d’une chaîne du corpus (`npm run collections` côté Ragator) ; vide : toutes | vide |
| Réponses détaillées | Réponses plus longues et plus lentes ; désactivé, les réponses courtes conviennent mieux à la voix | désactivé |

Plusieurs sources sont possibles, par exemple une par chaîne : leur « Nom affiché » permet de les distinguer à la voix.

**Tester** ne pose pas de question : il vérifie que Ragator répond, que la collection existe, et affiche le nombre de vidéos indexées.

## Limites

- La carte montre 500 caractères de réponse au plus et cinq vidéos : une réponse générale très longue est coupée à la fin d’une phrase. Le modèle de conversation reçoit la réponse complète (4 000 caractères au plus).
- Les liens YouTube sont gardés dans les données de la réponse mais ne s’affichent pas sur le miroir.
- Les relances (« et dans cette vidéo ? ») ne sont pas transmises à Ragator comme un historique : Cornelius reformule la question complète avant de l’envoyer.
- Quand Ragator répond en mode dégradé (sans modèle, recherche lexicale seule), Cornelius ajoute « Réponse dégradée ».

## Outil vocal

L’outil s’appelle `ragator__ask`. Il reçoit `instanceRef` et `query`, la question complète (1 000 caractères au plus). C’est un outil à la demande : voir [L’outil vocal](../../docs/modules/reference.md#loutil-vocal) dans la référence. Pas d’affichage permanent.

## Voir aussi

- [Les modules](../../docs/modules/README.md)
- [Référence du contrat des modules](../../docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json), [data.schema.json](data.schema.json)
