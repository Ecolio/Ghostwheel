/**
 * Crée un satellite audio et affiche son jeton (montré une seule fois), en attendant la rubrique
 * de l’administration.
 *
 *   npx tsx --env-file-if-exists=.env scripts/satellite-ajouter.ts "Bureau"
 */
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/storage.js';
import { SATELLITE_NAME_MAX, SatelliteStore } from '../server/satellites-store.js';

const name = (process.argv[2] ?? '').trim();
if (!name || name.length > SATELLITE_NAME_MAX) {
  console.error(
    `Usage : satellite-ajouter.ts "<nom de la pièce, ${SATELLITE_NAME_MAX} caractères maximum>"`,
  );
  process.exit(1);
}
const config = loadConfig();
const db = openDatabase(config.databasePath);
try {
  const { satellite, token } = new SatelliteStore(db, Date.now).create(name);
  console.log('Satellite « ' + satellite.name + ' » créé (' + satellite.id + ').');
  console.log('Jeton, à noter maintenant, il ne sera plus affiché :\n  ' + token);
  console.log('Depuis cet ordinateur : ws://127.0.0.1:' + config.port + '/satellite');
  if (config.lan)
    console.log(
      'Depuis le réseau local : wss://<adresse>:' +
        config.httpsPort +
        '/satellite' +
        (config.tlsFingerprint ? ' (empreinte ' + config.tlsFingerprint + ')' : ''),
    );
} finally {
  db.close();
}
