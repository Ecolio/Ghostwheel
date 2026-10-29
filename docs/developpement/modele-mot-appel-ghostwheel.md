# Modèle du mot d’appel « Ghostwheel »

Cette note décrit le modèle livré sous `models/cornelius.onnx` (nom conservé pour compatibilité), sa recette de génération et son premier essai au micro. Le produit s’appelle toujours Cornelius ; le mot d’appel est maintenant **« Ghostwheel »**. L’ancien modèle, qui reconnaissait le mot « Cornelius », est archivé dans `models/archive/`.

## Fabrication

Le changement de mot d’appel ne demande pas de modifier le code d’inférence : openWakeWord charge un classifieur par chemin, et le service conserve `models/cornelius.onnx` comme emplacement configuré par défaut. Le binaire du modèle a été remplacé par le nouvel artefact, sans conversion supplémentaire.

Le modèle a été entraîné dans le projet séparé [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), à partir de la configuration `ghostwheel.yml` et du dépôt du générateur à la révision `66f08ff`. Le fichier livré est `output/ghostwheel-fr-phonetic-v1.onnx`.

La recette contient :

- mots positifs synthétisés sous trois graphies destinées aux voix françaises : `Goste-wil`, `Goste-ouile` et `Goss-touile` ;
- voix Piper françaises Siwis, UPMC et Tom, pour les exemples positifs et négatifs ; aucun enregistrement de voix réelle n’a été utilisé ;
- huit expressions négatives personnalisées : « Gauche », « Goût », « Gustave », « Gaston », « Gosses », « Whisky », « Guillaume » et « Winnie » ;
- 20 000 exemples par catégorie pour l’entraînement et 2 000 pour la validation ;
- le pipeline openWakeWord : augmentation par bruits de fond, réponses impulsionnelles et caractéristiques négatives openwakeword_features, puis entraînement d’un petit classifieur DNN (32 unités, 50 000 étapes visées, cible de 0,2 faux positifs par heure sur les données de validation).

La cible de faux positifs est une mesure de validation du pipeline, **pas** une garantie en maison. Les voix synthétiques, graphies phonétiques et bruits d’entraînement ne couvrent pas toutes les voix, accents, distances, pièces, téléviseurs ou conditions de microphone. Le modèle est un détecteur de score : le seuil par défaut de Cornelius est 0,5 et doit être évalué avec le matériel réel.

Empreinte SHA-256 du modèle livré : `fa3b68e23651fa2cb0252879877af7cebe54d263e1511d4f4630a851ffb2c9ed`.

## Essai au micro

Le 29 octobre 2026, le modèle a été essayé avec le testeur local de wakeword-generator (au seuil utilisé lors de l’essai, non consigné dans la note), à partir d’un microphone de la machine de développement. L’essai initial, puis une série de vidéos en français et en anglais contenant notamment des mots comme « ghostVPN », n’ont pas déclenché le détecteur selon l’observation de l’utilisateur ; la reconnaissance de « Ghostwheel » est restée bonne pendant la lecture des vidéos.

C’est un retour qualitatif encourageant, mais pas un protocole de recette complet : il n’y a pas encore de nombre consigné d’appels positifs, de faux déclenchements par heure, de niveaux sonores, de distances, de seuils comparés, ni de mesures sur le miroir et son microphone définitifs. La télévision et les vidéos testées ne représentent pas toutes les sources de bruit. Continuer les essais avec conversations, musique, différents locuteurs, distances, volumes, pièces et longues périodes sans appel ; noter le seuil et les détections manquées ou injustifiées. Le réglage `CORNELIUS_WAKE_THRESHOLD` change le compromis : le monter réduit généralement les faux déclenchements, au prix d’appels manqués.

## Changements de compatibilité et limites

Le service charge toujours le modèle via `models/cornelius.onnx` et les états de disponibilité restent libellés « Cornelius », car Cornelius est le nom du produit. Le mot à prononcer, les instructions d’administration et le mot reconnu par le modèle sont désormais « Ghostwheel ». Les mises à jour doivent remplacer le modèle et les textes ensemble ; un ancien fichier `.env` utilisant `CORNELIUS_WAKE_MODEL` avec un chemin explicite continue à prendre le pas sur le modèle livré.

Le nom fixe du fichier facilite une mise à jour, mais ne garantit pas que tous les anciens clones ou installations personnalisées disposent du nouveau modèle. L’ancien modèle a été conservé avec sa notice dans `models/archive/cornelius-original.onnx` ; il peut être repris en réglant `CORNELIUS_WAKE_MODEL` vers ce chemin, mais les textes de l’application décrivent désormais Ghostwheel.

Le modèle est distribué sous CC BY-NC-SA 4.0, par prudence, avec les mêmes réserves que celles détaillées dans [Licences](../reference/licences.md#le-mot-dappel) : la licence des caractéristiques négatives est non commerciale, les droits des réponses impulsionnelles ne sont pas précisés, et les licences des voix décrivent leurs données sans trancher à elles seules le statut des sons synthétiques ou du modèle obtenu. Il ne convient pas à un usage commercial sans nouvelle analyse des droits et, si nécessaire, un réentraînement avec des données explicitement autorisées. La note et la licence ne constituent pas un avis juridique.

## Reproduire l’essai

Dans `wakeword-generator`, le testeur peut charger le modèle livré par chemin :

```sh
# Depuis le dépôt wakeword-generator : configurer et lancer le testeur selon docs/tester.md,
# puis indiquer le modèle Ghostwheel plutôt que le modèle d’entraînement par défaut.
./tester.sh --model ../Ghostwheel/models/cornelius.onnx --label Ghostwheel
```

Le testeur fourni lit encore sa configuration par défaut pour préparer les modèles de prétraitement ; il faut que l’environnement du testeur soit installé selon son guide avant cette commande.

Voir [la documentation du testeur](https://github.com/lfpoulain/wakeword-generator/blob/main/docs/tester.md) pour l’installation, le choix du micro, le seuil et les scénarios d’évaluation.
