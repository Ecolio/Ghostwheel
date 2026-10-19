# Le mot d’appel

Cette page explique comment ouvrir la conversation en disant « Cornelius » : l’activer, obtenir et installer le modèle qui reconnaît ce mot, et ce que devient le son du micro. Elle s’adresse à la personne qui installe et règle le miroir.

## Ce que fait le mot d’appel

Le mot « Cornelius » est reconnu sur l’ordinateur du miroir, par le service caméra (perception), avec le logiciel libre openWakeWord. Aucun service extérieur n’intervient pour l’entendre.

Dire « Cornelius » ouvre la conversation. C’est aussi une demande explicite : si la session avait été arrêtée depuis l’administration, le mot la relance.

## Activer le mot d’appel

Dans l’administration, choisissez **Quand il écoute → Ouverture de la conversation → Ce qui l’ouvre → « Cornelius »**. Il est désactivé au départ.

Choisissez ensuite **Qui peut l’ouvrir** :

- **Tout le monde** : toute personne qui dit « Cornelius » ouvre la conversation. La caméra reste éteinte en veille. La case **Reconnaître la personne pendant la conversation** permet de l’allumer le temps de la conversation pour reconnaître la personne.
- **Les membres du foyer** : il faut être reconnu devant le miroir en disant « Cornelius ». La caméra reste allumée en veille pour savoir qui parle.

Le détail de chaque combinaison, et la fin de la conversation sur un silence, sont décrits dans [Ouverture et présence](ouverture-et-presence.md).

Quand le modèle est prêt, le résumé de la carte affiche « Mot « Cornelius » prêt sur cet ordinateur. », et la rubrique **Mise en route** coche **Mot d’appel « Cornelius »** avec « Modèle local prêt. ». Tant qu’il manque, le choix peut être enregistré mais ne peut ouvrir aucune conversation : un avertissement le signale, et aucun autre mot ne le remplace.

## Le modèle « Cornelius »

Le dépôt fournit le modèle du mot « Cornelius » : `models/cornelius.onnx`. Il est prêt à l’emploi après un `git clone` ou un `git pull`, sans rien entraîner. openWakeWord ne livre que des modèles en anglais : celui-ci a été entraîné pour Cornelius, à partir de voix françaises de synthèse, sans aucun enregistrement de voix réelle.

Sa licence et ses attributions sont dans `models/cornelius.onnx.LICENSE`, à garder avec lui : il est diffusé sous CC BY-NC-SA 4.0, pour un usage non commercial (voir [Licences](../reference/licences.md#le-mot-dappel)).

`models/cornelius.onnx` et sa licence sont les seuls fichiers du dossier `models/` suivis par Git ; tous les autres modèles sont téléchargés.

### Entraîner votre propre version, ou un autre mot

Le modèle a été fabriqué avec [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), un projet séparé. Il tourne dans Docker, demande environ 40 Go d’espace libre et profite d’un GPU NVIDIA. Sa configuration d’exemple vise déjà « Cornelius » et produit `output/cornelius.onnx`. Il contient aussi un testeur au micro, utile pour régler le seuil. Toutes les étapes sont dans son README.

Il est aussi possible d’entraîner un modèle compatible avec [la méthode décrite par openWakeWord](https://github.com/dscripka/openWakeWord#training-new-models).

Pour l’utiliser, copiez le fichier obtenu à la place de `models/cornelius.onnx` (votre version apparaît alors dans `git status` tant qu’elle n’est pas validée), ou indiquez son chemin dans la variable `CORNELIUS_WAKE_MODEL` du fichier `.env` (voir [Configuration](../reference/configuration.md)). Relancez ensuite Cornelius.

## Installer l’écoute du mot d’appel

L’écoute demande quelques composants Python en plus de la perception. Ils ne sont pas installés par défaut.

### Linux

L’installateur s’en charge avec l’option `--wake` :

```sh
scripts/install-linux.sh --wake
```

Il installe openWakeWord dans `.venv`, télécharge ses deux modèles de prétraitement dans `models/openwakeword/` et prévient si `models/cornelius.onnx` manque. Voir [Installation sous Linux](../installation/linux.md).

### Windows

Depuis la racine du dépôt, une fois la perception installée (voir [Installation sous Windows](../installation/windows.md)) :

```powershell
.venv\Scripts\python -m pip install -r perception\requirements-wake.txt
.venv\Scripts\python -m pip install --no-deps openwakeword==0.6.0
.venv\Scripts\python perception\install_wake_features.py
.venv\Scripts\python perception\worker.py --check
```

openWakeWord est installé avec `--no-deps` : sa version publiée réclame un composant (TFLite) que Cornelius n’utilise pas. Les composants vraiment nécessaires sont dans `perception/requirements-wake.txt`.

`perception/install_wake_features.py` télécharge les deux modèles de prétraitement partagés depuis [la version v0.5.1 d’openWakeWord](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1) vers `models/openwakeword/`. Il vérifie leur empreinte SHA-256 et ne télécharge aucun modèle de mot d’appel.

`perception/worker.py --check` affiche l’état du mot d’appel parmi ses vérifications.

### Après l’installation

Relancez Cornelius pour que la perception charge le modèle : `scripts/restart.sh` sous Linux (ou `systemctl --user restart cornelius-perception` avec les services systemd), `powershell -ExecutionPolicy Bypass -File scripts\restart.ps1` sous Windows.

## Régler la sensibilité

Un score est calculé pour chaque instant d’écoute. Le mot est reconnu quand ce score atteint le seuil, 0,5 par défaut. La variable `CORNELIUS_WAKE_THRESHOLD` du fichier `.env` le change ; elle doit être strictement comprise entre 0 et 1, sinon 0,5 est utilisé. Un seuil plus bas déclenche plus facilement, un seuil plus haut évite les faux déclenchements.

Avant de changer cette valeur, essayez le modèle avec plusieurs voix, à plusieurs distances, avec du bruit et la télévision allumée. Comptez les déclenchements involontaires et les appels manqués. Le testeur de [wakeword-generator](https://github.com/lfpoulain/wakeword-generator) affiche le score en direct.

## Où va le son

- Après **Activer la voix** sur le miroir, le navigateur garde le micro ouvert pendant la veille.
- Le son est envoyé à Cornelius sur l’ordinateur lui-même, puis analysé par la perception. En veille, il ne quitte pas l’ordinateur.
- Quand « Cornelius » est reconnu et que la conversation s’ouvre, le même micro sert à la conversation, et le son part alors chez OpenAI.
- Si la conversation ne s’ouvre pas (personne non reconnue alors que l’ouverture est réservée aux membres du foyer, par exemple), rien n’est envoyé.
- Avec **Micro gardé prêt**, le début de la phrase dite avec « Cornelius » est gardé sur l’ordinateur puis transmis à la conversation une fois ouverte (voir [Ouverture et présence](ouverture-et-presence.md#micro-gardé-prêt-bêta)).

Les [satellites audio](satellites.md) écoutent aussi « Cornelius » : ils envoient le son de leur micro à l’ordinateur, par le réseau local, et c’est l’ordinateur qui cherche le mot, avec le même modèle. Quand le miroir et un satellite entendent le même appel, l’appareil au meilleur score l’emporte.

Pour couper toute écoute, choisissez une autre ouverture que « Cornelius », ou utilisez **Bloquer OpenAI** dans le panneau **Conversation** de la rubrique **Quand il écoute**.

## Quand il ne répond pas

- Le service caméra doit tourner : c’est lui qui entend « Cornelius ». S’il s’arrête, le miroir affiche « Écoute du mot « Cornelius » arrêtée : relancez Cornelius sur cet ordinateur. » (ou « Service caméra arrêté : relancez Cornelius sur cet ordinateur. » quand l’ouverture est réservée aux membres du foyer). Si le modèle manque, il affiche « Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur. ».
- Si le navigateur perd l’autorisation du micro, le bouton **Activer la voix** réapparaît sur le miroir.
- La rubrique **Mise en route** indique ce qui manque : modèle absent, prétraitement absent ou modèle illisible.

Voir [Dépannage](../utilisation/depannage.md).

## Licences

Le code d’openWakeWord est sous licence Apache 2.0. Ses modèles prêts à l’emploi, sous une licence non commerciale, ne sont pas installés. Le modèle « Cornelius » fourni est sous CC BY-NC-SA 4.0, à cause des données utilisées pour l’entraîner ; un modèle que vous entraînez vous-même dépend aussi de ses données. La licence des deux modèles de prétraitement reste à clarifier. Le détail est dans [Licences](../reference/licences.md).

## Voir aussi

- [Ouverture et présence](ouverture-et-presence.md)
- [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), le générateur du modèle
- [Installation sous Linux](../installation/linux.md)
- [Installation sous Windows](../installation/windows.md)
- [Configuration](../reference/configuration.md)
- [Licences](../reference/licences.md)
- [Confidentialité](../reference/confidentialite.md)
