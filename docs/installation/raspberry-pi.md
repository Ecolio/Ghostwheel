# Installer Cornelius sur Raspberry Pi

Cette page explique ce qui change quand Cornelius tourne sur un Raspberry Pi 4 ou 5, et comment l’installer. Elle complète [Installer sous Linux](linux.md), dont elle reprend le script. Elle s’adresse à la personne qui prépare le miroir.

## Ce qui change sur un Raspberry Pi

Un Raspberry Pi fait tourner la conversation, la reconnaissance des visages, le mot d’appel et le miroir. Il est trop juste pour les modèles d’image locaux. Cornelius le reconnaît seul au démarrage (nom de la carte lu dans `/proc/device-tree/model`) et s’adapte :

| | Sur un PC | Sur un Raspberry Pi |
|---|---|---|
| Conversation, mémoire, modules | oui | oui |
| Mot d’appel « Cornelius » | oui | oui |
| Reconnaissance des visages | image entière | visages cherchés sur une image réduite à 640 pixels de large, puis reconnus sur l’image entière |
| [Vision locale](../fonctionnalites/vision-locale.md) (description de la scène) | au choix | retirée : le module **Vision** n’apparaît pas dans l’administration |
| [Génération d’images](../fonctionnalites/generation-d-images.md) | sur ce PC ou avec OpenAI | avec OpenAI seulement |

La réduction de l’image ne touche que la recherche des visages, la partie la plus coûteuse. La reconnaissance garde l’image de la caméra en entier : un visage reconnu à deux mètres sur un PC l’est aussi sur le Pi. En contrepartie, un visage très petit, loin de la caméra, peut ne pas être trouvé.

Les réglages enregistrés ne sont pas effacés : la même base de données, recopiée sur un PC, y retrouve sa vision et son générateur d’images. Dans l’autre sens, une base venue d’un PC où les images étaient créées sur ce PC arrive avec la création d’images désactivée : rien ne part chez OpenAI, ni n’est facturé, avant que vous la réactiviez dans **Modules → Génération d’image**.

D’autres générateurs d’images en ligne peuvent s’ajouter par un [module](../modules/README.md).

## Ce qu’il faut

- Un Raspberry Pi 5 (conseillé) ou 4, avec 4 Go de mémoire au moins ; 8 Go laissent de la marge au navigateur.
- **Raspberry Pi OS 64 bits** (Bookworm ou plus récent). La version 32 bits ne convient pas : ONNX Runtime et OpenCV n’y sont pas publiés.
- Un refroidissement actif (ventilateur ou boîtier ventilé) : la caméra est analysée en continu et le Pi ralentit quand il chauffe.
- De préférence un SSD (port NVMe du Pi 5 ou disque USB) plutôt qu’une carte microSD, plus fragile face aux écritures de la base.
- Une **webcam USB**. Les modules caméra officiels (connecteur CSI, pilotés par libcamera) ne sont pas lus par la perception.
- Un micro USB, ou mieux un haut-parleur de conférence USB qui supprime l’écho : le Pi n’a pas de micro.
- Un écran Full HD de préférence : en 4K, l’orbe animée demande beaucoup au processeur graphique du Pi.
- Une clé OpenAI d’un compte payant, comme sur un PC.

## Installer

Préparez Node.js 24 avec fnm, puis lancez le script d’installation, comme décrit dans [Installer sous Linux](linux.md) :

```sh
sudo apt install git curl unzip
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
curl -fsSL https://fnm.vercel.app/install | bash
```

Ouvrez un nouveau terminal, revenez dans le dossier `Cornelius`, puis :

```sh
scripts/install-linux.sh --system-deps --wake --systemd
```

Le script affiche le processeur et la carte, puis « Petite machine : sans vision locale ni génération d’images locale ». Il installe Python 3.12 à part (Raspberry Pi OS fournit une autre version), la perception sur le processeur, et seulement les modèles des visages, de la parole et du mot d’appel : le modèle de vision n’est pas téléchargé. L’option `--gpu` n’accepte que `auto` ou `cpu` en ARM64.

À la fin, il vous demande un mot de passe pour l’administration, puis affiche son adresse depuis un autre appareil, par exemple `https://192.168.1.20:3443/admin`. Choisissez-le à ce moment : depuis votre ordinateur, l’administration refuse de s’ouvrir avec le mot de passe de départ `cornelius`. Plus tard, `npm run password` dans le dossier `Cornelius` le change à nouveau.

Le script demande votre mot de passe pour `sudo` deux fois au plus : pour les paquets du système, puis pour laisser tourner les services sans session ouverte. Sans ce second réglage, Cornelius s’arrêterait dès la fermeture du terminal SSH et ne démarrerait pas avec le Pi, car Raspberry Pi OS Lite n’ouvre aucune session au démarrage.

## Ouvrir le miroir au démarrage

Cornelius ne lance pas le navigateur lui-même : c’est un réglage du système, différent selon que le Pi a un bureau ou non. Dans les deux cas, gardez toujours la même adresse, `http://127.0.0.1:3000/` : `127.0.0.1` et `localhost` sont deux sites différents pour le navigateur.

### Avec le bureau (Raspberry Pi OS « with desktop »)

1. Ouvrez une fois `http://127.0.0.1:3000/` dans Chromium.
2. Autorisez durablement le micro et le son pour ce site (cadenas à gauche de l’adresse, « Paramètres du site », **Microphone** et **Son** sur « Autoriser »). Sans cela, il faut toucher **Activer la voix** à chaque démarrage (voir le [dépannage](../utilisation/depannage.md)).
3. Ajoutez Chromium en plein écran au démarrage de la session graphique, par exemple avec la commande `chromium --kiosk http://127.0.0.1:3000/` (`chromium-browser` sur Raspberry Pi OS Bookworm) dans les applications lancées au démarrage du bureau.

### Sans bureau (Raspberry Pi OS Lite)

Raspberry Pi OS Lite n’a pas d’interface graphique. Le plus léger est [cage](https://github.com/cage-kiosk/cage), qui affiche une seule application en plein écran : Chromium y ouvre le miroir, sans barre ni bureau. Les commandes se tapent en SSH, dans le compte qui a installé Cornelius. Cette méthode a été vérifiée sur un Raspberry Pi 5 sous Raspberry Pi OS Lite 64 bits (Debian 13), avec cage 0.3 et Chromium 156.

**1. Installer cage, Chromium et wlrctl.** wlrctl sert à une seule chose, plus bas : faire disparaître le pointeur.

```sh
sudo apt install cage chromium wlrctl
```

**2. Autoriser d’avance le micro, la caméra et le son.** Sans souris ni clavier, personne ne peut répondre à la demande d’autorisation du navigateur. Une règle de Chromium l’accorde à l’adresse du miroir seulement :

```sh
sudo mkdir -p /etc/chromium/policies/managed
sudo tee /etc/chromium/policies/managed/cornelius.json >/dev/null <<'EOF'
{
  "AudioCaptureAllowedUrls": ["http://127.0.0.1:3000"],
  "VideoCaptureAllowedUrls": ["http://127.0.0.1:3000"],
  "AutoplayAllowlist": ["http://127.0.0.1:3000"],
  "TranslateEnabled": false,
  "PasswordManagerEnabled": false
}
EOF
```

**3. Créer le script du kiosque.** Il attend que le serveur réponde, puis lance Chromium dans cage :

```sh
mkdir -p ~/.local/bin
cat >~/.local/bin/cornelius-kiosk <<'EOF'
#!/bin/sh
# Miroir Cornelius en plein écran : attend le serveur, puis Chromium seul dans cage.
until curl -sf -o /dev/null http://127.0.0.1:3000/; do sleep 1; done
exec cage -s -- sh -c '
  chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-infobars \
    --no-first-run --password-store=basic --disable-session-crashed-bubble \
    http://127.0.0.1:3000/ &
  # Chromium ne change de pointeur qu’au premier mouvement : un pixel, une fois la page chargée.
  sleep 20; wlrctl pointer move 1 0
  wait
'
EOF
chmod +x ~/.local/bin/cornelius-kiosk
```

Le miroir cache le pointeur de la souris quand elle ne bouge pas, mais Chromium n’applique ce changement qu’au mouvement suivant : sans le déplacement d’un pixel fait par `wlrctl`, une flèche resterait au milieu de l’écran. Un outil comme `unclutter` ne sert à rien ici : il ne fonctionne qu’avec X11, et cage utilise Wayland.

**4. Lancer le kiosque au démarrage.** Le Pi ouvre une session sur l’écran sans mot de passe, et cette session lance le script. Si Chromium se ferme, la session se rouvre et le relance.

```sh
sudo raspi-config nonint do_boot_behaviour B2
cat >>~/.profile <<'EOF'

# Kiosque : sur l’écran (tty1), lancer le miroir ; à sa fermeture, la session se rouvre seule.
if [ -z "$WAYLAND_DISPLAY" ] && [ "$(tty)" = /dev/tty1 ]; then
  exec "$HOME/.local/bin/cornelius-kiosk"
fi
EOF
sudo reboot
```

Le miroir apparaît environ une minute après la mise sous tension. Les connexions SSH ne sont pas touchées : seule la session de l’écran (`tty1`) lance le kiosque.

Pour arrêter le kiosque, retirez le bloc ajouté à `~/.profile` et remettez la connexion par mot de passe (`sudo raspi-config nonint do_boot_behaviour B1`), puis redémarrez. Pour le relancer sans redémarrer, après une mise à jour par exemple : `pkill -x cage`.

### L’écran

Un écran HDMI fonctionne sans réglage. Un écran DSI (nappe plate) se déclare dans `/boot/firmware/config.txt`, avec la ligne que donne son fabricant, puis demande un redémarrage. Par exemple, pour le Waveshare **7inch DSI LCD (C)** (1024 × 600, tactile) sur un Pi 5, branché sur le port DSI 1 avec son câble 4 broches sur l’alimentation 5 V et le bus I2C1 (broches 3 et 5) :

```sh
echo 'dtoverlay=vc4-kms-dsi-waveshare-panel,7_0_inchC,i2c1' | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

Sans l’option `i2c1`, l’écran reste noir et le tactile n’est pas reconnu, alors que le système croit l’écran branché. Pour vérifier : `cat /sys/class/drm/*DSI*/status` répond `connected`, et `grep -i touch /proc/bus/input/devices` nomme le tactile (`Goodix Capacitive TouchScreen`).

L’écran DSI ne transporte pas le son : il faut un haut-parleur USB, ou mieux un haut-parleur de conférence USB qui contient aussi le micro.

## Forcer ou désactiver le mode petite machine

La variable `CORNELIUS_SMALL_MACHINE` du fichier `.env` remplace la détection, pour le serveur comme pour le script d’installation :

- `CORNELIUS_SMALL_MACHINE=0` : un Raspberry Pi garde la vision locale et le choix du générateur d’images, à vos risques (descriptions lentes, analyses abandonnées après 10 s).
- `CORNELIUS_SMALL_MACHINE=1` : un autre ordinateur modeste (mini-PC, carte ARM) se comporte comme un Raspberry Pi.

Redémarrez Cornelius après un changement. Voir [Configuration](../reference/configuration.md).

## Alléger encore

Si le Pi peine (orbe saccadée, reconnaissance lente) :

- **Caméra et reconnaissance** : choisissez 640 × 480 à 15 images par seconde.
- **Quand il écoute** : ouvrez la conversation au mot « Cornelius » pour tout le monde. La caméra reste alors éteinte en veille.
- Ajoutez `--force-prefers-reduced-motion` à la commande qui lance Chromium : l’orbe ne se redessine plus que quatre fois par seconde.

Pour un Pi 4 très sollicité, une autre solution est de faire tourner Cornelius sur un autre ordinateur de la maison et de garder le Pi comme écran, avec la [caméra du navigateur](../fonctionnalites/camera-navigateur.md) : les images partent alors vers le serveur, qui fait l’analyse.
