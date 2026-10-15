# Module [Nom affiché]

<!--
Fiche à remplir. Ce dossier est le gabarit des nouveaux modules : son nom commence par « _ »,
Cornelius ne le charge donc pas. Il contient un module de démonstration « parking » relié à un
fournisseur fictif. Après « cp -r addons/_template addons/<id> », remplacez chaque [crochet]
puis supprimez ce commentaire. Guide pas à pas : docs/modules/creer-un-module.md.
-->

Le module [Nom affiché] [ce qu’il apporte, en une phrase]. Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `[id]`).

## Ce que fait le module

- Il répond à « [question type] » et affiche une carte « [titre de la carte] » : [valeur principale, lignes].
- [Ce qui se passe quand il n’y a rien à dire, par exemple « zéro place » ou « aucun passage ».]
- Les données restent en cache [durée de `freshMs`].

## Jeton requis

[Supprimez cette section si le module n’en a pas besoin.]

Le module a besoin d’[un jeton Fournisseur] ([gratuit ou payant]), à demander sur [adresse de la page d’inscription, identique au champ `url` de `secrets`]. Ajoutez-le dans le fichier `.env` puis redémarrez Cornelius :

```ini
[CORNELIUS_NOM_DU_JETON]=votre-jeton
```

## Réglages d’une source

Dans **Modules → [Nom affiché] → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| [title du champ dans config.schema.json] | [description du champ] | [valeur de `configDefaults`] |

## Limites

- [Zone couverte, quota du fournisseur, précision des données.]
- [Ce que la source dit en cas de panne.]

## Outil vocal et affichage permanent

L’outil s’appelle `[id]__read`. [Avec « Afficher en permanence sur le miroir », le miroir montre … / Ce module ne propose pas d’affichage permanent.]

## Voir aussi

- [Les modules](../../docs/modules/README.md)
- [Créer un module](../../docs/modules/creer-un-module.md)
- [Référence du contrat des modules](../../docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
