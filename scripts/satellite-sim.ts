/**
 * Simulateur de satellite audio : parle le protocole des satellites (version 1) sans matériel.
 * Il envoie du silence au rythme d’un micro, puis l’enregistrement donné, et affiche les
 * messages du serveur. Voir docs/developpement/satellites-protocole.md.
 *
 *   npx tsx scripts/satellite-sim.ts --token <jeton> [--wav cornelius.wav] [--after 2]
 *     [--url ws://127.0.0.1:3000/satellite] [--fingerprint AA:BB:…] [--timeout 30]
 *
 * Avec --wav, la sortie vaut 0 si « Cornelius » est entendu, 1 sinon.
 */
import { readFileSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import WebSocket from 'ws';

const RATE = 16000;
const FRAME_BYTES = 2560;
const FRAME_MS = 80;

function option(name: string): string | undefined {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const token = option('token') ?? process.env.CORNELIUS_SATELLITE_TOKEN;
const url = option('url') ?? 'ws://127.0.0.1:' + (process.env.PORT ?? 3000) + '/satellite';
const wavPath = option('wav');
const afterMs = Number(option('after') ?? 2) * 1000;
const timeoutMs = Number(option('timeout') ?? 30) * 1000;
const fingerprint = option('fingerprint')?.replace(/:/g, '').toUpperCase();
if (!token) {
  console.error('Jeton manquant : --token <jeton> ou CORNELIUS_SATELLITE_TOKEN.');
  process.exit(1);
}
if (url.startsWith('wss:') && !fingerprint) {
  console.error('wss:// demande --fingerprint (empreinte affichée dans Réseau local).');
  process.exit(1);
}

function readWav(path: string): Buffer {
  const file = readFileSync(path);
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Fichier WAV attendu.');
  let offset = 12;
  let valid = false;
  while (offset + 8 <= file.length) {
    const id = file.toString('ascii', offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ')
      valid =
        file.readUInt16LE(body) === 1 &&
        file.readUInt16LE(body + 2) === 1 &&
        file.readUInt32LE(body + 4) === RATE &&
        file.readUInt16LE(body + 14) === 16;
    if (id === 'data') {
      if (!valid) throw new Error('WAV PCM 16 bits mono 16 kHz attendu.');
      return file.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  throw new Error('Données WAV introuvables.');
}

const speech = wavPath ? readWav(wavPath) : null;
const started = performance.now();
const at = () => (performance.now() - started) / 1000;
const log = (text: string) => console.log(at().toFixed(2).padStart(6) + ' s  ' + text);

let listening = false;
let speechAt: number | null = null;
let speechOffset = 0;
let heard = false;
let refused = false;
let streamTimer: ReturnType<typeof setTimeout> | null = null;

const socket = new WebSocket(url, {
  headers: { Authorization: 'Bearer ' + token },
  // Certificat auto-signé de Cornelius : vérifié par son empreinte, comme un vrai satellite.
  rejectUnauthorized: false,
});
socket.on('upgrade', (response) => {
  if (!fingerprint) return;
  const peer = (response.socket as TLSSocket).getPeerCertificate?.();
  if (peer?.fingerprint256?.replace(/:/g, '').toUpperCase() !== fingerprint) {
    log('Empreinte TLS inattendue : connexion abandonnée.');
    refused = true;
    socket.terminate();
  }
});
socket.on('unexpected-response', (_request, response) => {
  log('Connexion refusée (' + response.statusCode + ').');
  process.exit(1);
});
socket.on('open', () => {
  log('Connecté à ' + url);
  socket.send(JSON.stringify({ type: 'hello', protocol: 1, firmware: 'sim-0.1.0' }));
});

function nextFrame(): Buffer {
  const frame = Buffer.alloc(FRAME_BYTES);
  if (speech && speechAt !== null && speechOffset < speech.length) {
    speech.copy(frame, 0, speechOffset, Math.min(speechOffset + FRAME_BYTES, speech.length));
    speechOffset += FRAME_BYTES;
    if (speechOffset >= speech.length) log('Fin de l’enregistrement.');
  }
  return frame;
}

function stream() {
  // Rythme réel : une trame toutes les 80 ms, recalée sur l’horloge pour ne pas dériver.
  const begin = performance.now();
  let index = 0;
  const tick = () => {
    if (!listening || socket.readyState !== WebSocket.OPEN) return;
    if (speech && speechAt === null && performance.now() - begin >= afterMs) {
      speechAt = at();
      log('Lecture de ' + wavPath + ' (' + (speech.length / 2 / RATE).toFixed(2) + ' s).');
    }
    socket.send(nextFrame());
    index++;
    streamTimer = setTimeout(tick, Math.max(0, begin + index * FRAME_MS - performance.now()));
  };
  tick();
}

socket.on('message', (data, binary) => {
  if (binary) return;
  const message = JSON.parse(String(data));
  if (message.type === 'welcome')
    log(
      'Accueilli : « ' +
        message.name +
        ' », volume ' +
        message.volume +
        ', protocole ' +
        message.protocol +
        '.',
    );
  else if (message.type === 'listen') {
    log(
      message.enabled
        ? 'Le serveur écoute : envoi du micro.'
        : 'Le serveur n’écoute pas : micro au repos.',
    );
    const wasListening = listening;
    listening = message.enabled === true;
    if (streamTimer) clearTimeout(streamTimer);
    if (listening && !wasListening) stream();
  } else if (message.type === 'wake') {
    heard = true;
    log('« Cornelius » entendu (score ' + message.score + ').');
    if (speech) setTimeout(() => socket.close(1000), 1000);
  } else log('Message : ' + JSON.stringify(message));
});
socket.on('close', (code, reason) => {
  log('Fermé (' + code + (reason.length ? ' ' + reason : '') + ').');
  process.exit(refused || (speech && !heard) ? 1 : 0);
});
socket.on('error', (error) => log('Erreur : ' + error.message));
setTimeout(() => {
  log(speech ? 'Délai dépassé sans « Cornelius ».' : 'Fin de la simulation.');
  socket.close(1000);
}, timeoutMs).unref();
