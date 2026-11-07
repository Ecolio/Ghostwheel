/**
 * Choisit le mot de passe de l’administration depuis un terminal, par exemple en SSH quand le
 * miroir n’a pas encore d’écran. Comme la carte « Mot de passe administrateur » de la Mise en
 * route, il est gardé en base (empreinte seulement) et compte aussitôt, sans redémarrage.
 *
 *   npm run password                  choisir ou changer le mot de passe
 *   npm run password -- --if-default  seulement s’il vaut encore celui de départ (installateur)
 */
import { DEFAULT_ADMIN_PASSWORD, loadConfig } from '../server/config.js';
import {
  AdminPassword,
  ADMIN_PASSWORD_MIN_LENGTH,
  newPasswordError,
} from '../server/admin-password.js';
import { openDatabase } from '../server/storage.js';

const ifDefault = process.argv.includes('--if-default');

/** Lit une ligne sans l’afficher ; Ctrl+C abandonne. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          input.off('data', onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          input.setRawMode(false);
          process.stdout.write('\nAbandon : mot de passe inchangé.\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}

/** Code de sortie : 0 choisi ou laissé tel quel, 1 abandon. */
async function choose(password: AdminPassword): Promise<number> {
  if (ifDefault && !password.isDefault()) return 0;
  if (!process.stdin.isTTY) {
    const advice =
      'Choisissez le mot de passe de l’administration avec « npm run password » dans un terminal.';
    if (ifDefault) console.log(advice);
    else console.error(advice);
    return ifDefault ? 0 : 1;
  }
  const length = `${ADMIN_PASSWORD_MIN_LENGTH} caractères au moins`;
  if (ifDefault) {
    console.log(
      `\nL’administration a encore le mot de passe de départ « ${DEFAULT_ADMIN_PASSWORD} » :` +
        ' depuis un autre appareil, elle refuse de s’ouvrir tant qu’il n’est pas changé.',
    );
    console.log(
      `Choisissez-en un (${length}), ou appuyez sur Entrée pour le faire plus tard (npm run password).`,
    );
  } else console.log(`Nouveau mot de passe de l’administration (${length}).`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await askHidden('Mot de passe : ');
    if (!next && ifDefault) {
      console.log('Mot de passe inchangé.');
      return 0;
    }
    const error = newPasswordError(next, DEFAULT_ADMIN_PASSWORD);
    if (error) {
      console.log(error);
      continue;
    }
    if ((await askHidden('Confirmez : ')) !== next) {
      console.log('Les deux saisies diffèrent.');
      continue;
    }
    password.set(next);
    console.log('Mot de passe enregistré : il compte tout de suite, sans redémarrage.');
    return 0;
  }
  console.error('Mot de passe inchangé.');
  return 1;
}

const config = loadConfig();
const db = openDatabase(config.databasePath);
let code = 1;
try {
  code = await choose(new AdminPassword(db, config.adminPassword, DEFAULT_ADMIN_PASSWORD));
} finally {
  db.close();
}
process.exit(code);
