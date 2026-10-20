# Module Transports

Le module Transports annonce les prochains passages à un arrêt de bus, de tram, de métro ou de train d’Île-de-France, en temps réel quand c’est possible. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `transit`).

## Ce que fait le module

- Il répond à « mon bus ? » ou « prochain passage ? » et affiche une carte avec les trois prochains passages (« Prochain », « Suivant », « Puis »), en minutes et à l’heure prévue.
- Sur la carte, un horaire sans temps réel s’affiche comme les autres ; à l’oral, Cornelius précise « horaire théorique » pour le prochain passage. Les passages supprimés sont comptés à l’oral.
- Quand la ligne n’a aucun passage prévu (la nuit, une interruption), Cornelius dit « Aucun passage prévu pour le moment » plutôt qu’une panne.
- Les horaires restent en cache une minute.

## Jeton requis

Le module a besoin d’un jeton PRIM d’Île-de-France Mobilités (gratuit), à demander sur https://prim.iledefrance-mobilites.fr/. Collez-le dans la carte du module, dans l’administration : il compte tout de suite. Ou ajoutez-le dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_PRIM_API_KEY=votre-jeton
```

Tant qu’il manque, la carte du module affiche « Jeton manquant » et le bouton « Ajouter une source » reste grisé.

## Réglages d’une source

Dans **Modules → Transports → Ajouter une source**, rien ne se tape à la main : deux recherches proposent des choix.

1. **Arrêt** : tapez au moins trois lettres du nom de l’arrêt ou de la rue, puis Entrée ou **Chercher**. Huit propositions au plus.
2. **Direction** : disponible après le choix de l’arrêt. La liste montre les lignes et leurs destinations ; un mot tapé la filtre. « Toutes les directions » efface ce choix pour suivre toutes les lignes de l’arrêt.

## Limites

- PRIM ne couvre que le réseau d’Île-de-France Mobilités.
- Quand aucun passage n’est annoncé, la source répond qu’il n’y a aucune donnée utile.
- Une panne ne veut jamais dire « aucun bus » : après un premier succès, les derniers horaires restent affichés comme dernier horaire connu, et ceux qui sont dépassés ne sont pas annoncés.

## Outil vocal et affichage permanent

L’outil s’appelle `transit__read`. Avec « Afficher en permanence sur le miroir », le miroir montre, sous le nom de la source, la ligne, la direction et trois passages au plus. Les minutes d’attente diminuent chaque minute, sans attendre une nouvelle collecte.

## Voir aussi

- [Les modules](../../docs/modules/README.md)
- [Configuration](../../docs/reference/configuration.md)
- [Référence du contrat des modules](../../docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
