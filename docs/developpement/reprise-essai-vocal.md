# Reprise de l’essai vocal Ghostwheel

Note de passation après le premier essai réel du mot d’appel et de la conversation vocale. Elle décrit l’état de départ pour reprendre le travail sans refaire les essais coûteux.

## État actuel

- Le serveur et le worker de perception ont été arrêtés avec `scripts/stop.sh` après l’essai. Ne pas les laisser tourner quand ils ne servent pas.
- L’installation locale a réussi sur Fedora 44 : Node.js 24.2.0 via `fnm`, dépendances Node, environnement Python 3.12, perception et openWakeWord.
- L’écoute locale est installée et le modèle fourni `models/cornelius.onnx` reconnaît « Ghostwheel ». Le nom de fichier reste historique pour compatibilité.
- Une clé OpenAI a été ajoutée dans `.env`. **Ne jamais copier sa valeur dans cette note, les journaux, une commande partagée ou Git.** `.env` est ignoré par `.gitignore` et n’est pas suivi par Git.
- L’essai vocal a coûté environ **1,50 $**, selon le relevé de l’utilisateur. Le montant n’a pas été vérifié dans le tableau de bord OpenAI.
- Le dépôt contient déjà de nombreuses modifications non validées antérieures à cette note. Les changements du budget ci-dessous sont aussi non validés : ne pas nettoyer ou réinitialiser le répertoire de travail.

## Problème observé

Après une recherche Internet, l’assistant s’est arrêté au milieu d’une phrase. L’extrait de journal local consulté montrait des événements `response.completed`, et non `response.incomplete`. Les transcriptions et le contenu des réponses ne sont volontairement pas conservés dans le journal ; la cause n’a donc pas été confirmée.

La piste retenue était le petit budget de sortie de la délégation Responses : 512 jetons en modes `normal` et `fast`, alors que la réponse devait faire la recherche, produire une carte et un résumé oral. Ce budget peut contribuer à une réponse tronquée, mais le journal consulté ne prouve pas que c’est ce qui s’est passé.

## Changement en attente

Dans `server/live/configuration.ts`, `max_output_tokens` a été porté à **4096 pour tous les modes** (`normal`, `fast` et `ultrafast`). Le test des configurations de délégation dans `tests/live.test.ts` a été ajusté en conséquence.

Les **653 tests** ont réussi après ce changement. La commande d’essai était `npm test -- --test-name-pattern="délégation (normal|fast|ultrafast)"` ; malgré le filtre demandé, le résultat affiché couvre la suite entière.

Ce changement n’a **pas** été activé sur le serveur arrêté, ni commité. Le laisser tel quel pour la reprise et décider demain du budget approprié après avoir comparé les options moins coûteuses. Un budget plus élevé peut augmenter les coûts ; ne pas relancer de recherche vocale tant que le mode et le budget ne sont pas choisis.

## Reprise sur Fedora

Charger `fnm` dans le terminal avant d’utiliser les scripts, puis lancer le serveur seulement au moment des essais :

```sh
source ~/.bashrc
scripts/start.sh
```

Le serveur utilise le port 3000 par défaut. Pour arrêter le serveur et la perception après les essais :

```sh
scripts/stop.sh
```

Contrôler que `.env` reste privé sans en afficher le contenu :

```sh
git check-ignore -v .env
git status --short -- .env
```

Le premier doit confirmer l’ignorance ; le second ne doit pas lister `.env`. Ne pas utiliser `cat .env` ni ajouter ce fichier à l’index.

## À faire à la prochaine reprise

1. Examiner les options de réduction du coût avant tout nouvel essai : modèle de délégation, mode de vitesse, budget de sortie et comportement de recherche. Comparer les tarifs actuels dans le tableau de bord ou la documentation officielle avant de choisir.
2. Vérifier si le budget 4096 est nécessaire ou si un budget inférieur suffit pour la recherche, la carte et une réponse orale courte. Les trois modes partagent maintenant 4096 dans le changement en attente.
3. Faire un seul essai contrôlé, avec une question web courte, puis regarder le coût réel et le résultat avant d’en lancer d’autres.
4. Si la réponse se coupe encore, relever l’heure et l’`interactionId`, puis examiner dans le journal les événements `response.completed`, `response.incomplete` et `incomplete_details`. Le journal ne contient pas la transcription ; noter séparément le symptôme sans enregistrer de données personnelles inutiles.
5. Arrêter les services avec `scripts/stop.sh` dès la fin.

Ne pas réduire le niveau de sécurité ou exposer la clé pour tenter d’abaisser le coût. La clé reste dans `.env` ou dans le coffre de clés de l’application.
