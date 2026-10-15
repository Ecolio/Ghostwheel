# Module Heure

Le module Heure donne l’heure et la date dans le fuseau horaire de votre choix, à la voix ou en permanence sur le miroir. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `clock`).

## Ce que fait le module

- Il répond à « quelle heure est-il ? » ou « quelle est la date aujourd’hui ? » et affiche une carte « Heure ».
- L’heure vient de l’ordinateur qui fait tourner Cornelius. Le module ne fait aucun appel réseau et n’a besoin d’aucun jeton.
- Aucune source n’est créée d’office : sans source, le miroir n’affiche pas l’heure.

## Réglages d’une source

Dans **Modules → Heure → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Fuseau horaire | Liste des fuseaux (par exemple Europe/Paris ou UTC) | Europe/Paris |
| Afficher la date | Ajoute le jour et la date sous l’heure | activé |
| Afficher les secondes | Ajoute les secondes | désactivé |

Le « Nom affiché » et l’« Identifiant » donnent la phrase à prononcer, par exemple « l’heure de Paris ». Un fuseau inconnu fait échouer la source avec le message « Fuseau horaire inconnu ».

## Outil vocal

L’outil s’appelle `clock__read`. La date reste dite à l’oral même quand « Afficher la date » est désactivé.

## Affichage permanent

Activez « Afficher en permanence sur le miroir » dans la source. Le miroir montre l’heure en grand, et la date si elle est demandée. L’heure avance d’elle-même : le module ne garde en cache que ses réglages (une heure), pas l’heure. La date de relevé n’est pas affichée, sauf si la source passe en « Dernière donnée connue ».

Désactiver l’affichage garde la réponse vocale. Désactiver ou supprimer la source retire aussi la réponse vocale.

## Voir aussi

- [Les modules](../../docs/modules/README.md)
- [Créer un module](../../docs/modules/creer-un-module.md)
- [Référence du contrat des modules](../../docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
