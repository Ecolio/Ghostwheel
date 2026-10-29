import assert from 'node:assert/strict';
import test from 'node:test';
import { openingWarnings } from '../web/components/admin/SessionMode.js';
import { cameraBlocker, cameraNote } from '../web/components/admin/Camera.js';
import { silenceChoice, silenceDelayLabel } from '../web/components/admin/SilenceCloseSettings.js';
import { decimalText, parseDecimal } from '../web/components/admin/format.js';

test('l’ouverture signale ce qui l’empêche de fonctionner', () => {
  const ready = { perception: true, wakeWordReady: true, enrolledFaces: 1 };
  const gaze = { trigger: 'gaze', audience: 'everyone', recognizeVoice: false } as const;
  assert.deepEqual(openingWarnings(gaze, ready), []);
  // Service caméra arrêté : la présence et le regard ne peuvent pas être vus.
  const stopped = openingWarnings(gaze, { ...ready, perception: false });
  assert.equal(stopped.length, 1);
  assert.equal(
    stopped[0]!.text,
    'Le service caméra n’est pas lancé : ce choix ne peut pas fonctionner pour l’instant.',
  );
  assert.equal(stopped[0]!.link.href, '#start');
  // Ancien serveur sans état de préparation : aucun avertissement inventé.
  assert.deepEqual(openingWarnings(gaze, { ...ready, perception: undefined }), []);
  // Réservée aux membres, sans visage mémorisé : personne ne peut ouvrir.
  const members = { ...gaze, audience: 'members' } as const;
  const faces = openingWarnings(members, { ...ready, enrolledFaces: 0 });
  assert.deepEqual(
    faces.map((warning) => [warning.text, warning.link.href]),
    [
      [
        'Aucun visage n’est encore mémorisé : personne ne pourra ouvrir la conversation.',
        '#profiles',
      ],
    ],
  );
  // Nombre de visages encore inconnu : pas d’alerte.
  assert.deepEqual(openingWarnings(members, { ...ready, enrolledFaces: null }), []);
  // « Ghostwheel » sans modèle du mot d’appel.
  const voice = { trigger: 'voice', audience: 'everyone', recognizeVoice: false } as const;
  assert.match(
    openingWarnings(voice, { ...ready, wakeWordReady: false })[0]!.text,
    /Le mot « Ghostwheel » n’est pas encore prêt/,
  );
  // Service arrêté : un seul motif pour le mot d’appel, celui du service.
  const down = openingWarnings(voice, { ...ready, perception: false, wakeWordReady: false });
  assert.equal(down.length, 1);
  assert.match(down[0]!.text, /c’est lui qui entend « Ghostwheel »/);
  for (const warning of [...stopped, ...faces, ...down]) assert.doesNotMatch(warning.text, /[—–]/);
});

test('la caméra ne bloque que pour un service arrêté ou un visage en cours, sans figer le réglage', () => {
  assert.match(
    cameraBlocker({ connected: false, enrolling: true })!,
    /^Le service caméra n’est pas lancé/,
  );
  assert.match(
    cameraBlocker({ connected: true, enrolling: true })!,
    /^Un visage est en cours d’enregistrement/,
  );
  assert.equal(cameraBlocker({ connected: true, enrolling: false }), null);
  // Une conversation ou une veille sans caméra se signalent sans rien griser.
  const quiet = { starting: false, standbyOff: false, conversation: false };
  assert.equal(cameraNote(quiet), null);
  assert.match(cameraNote({ ...quiet, starting: true })!, /^Allumage de la caméra/);
  assert.match(cameraNote({ ...quiet, conversation: true })!, /peut la couper un instant/);
  assert.match(cameraNote({ ...quiet, standbyOff: true })!, /reste allumée tant que cette page/);
});

test('la fin de parole se lit en durées courantes', () => {
  assert.equal(silenceDelayLabel(10_000), '10 s');
  assert.equal(silenceDelayLabel(60_000), '1 min');
  assert.equal(silenceDelayLabel(90_000), '1 min 30 s');
  assert.equal(silenceDelayLabel(300_000), '5 min');
  assert.equal(silenceChoice({ enabled: false, delayMs: 20_000 }, false), 'never');
  // Avec « Ghostwheel » pour tout le monde, le silence ferme toujours : jamais « Jamais ».
  assert.equal(silenceChoice({ enabled: false, delayMs: 20_000 }, true), '20000');
  assert.equal(silenceChoice({ enabled: true, delayMs: 120_000 }, false), '120000');
  assert.equal(silenceChoice({ enabled: true, delayMs: 45_000 }, false), 'custom');
});

test('une valeur décimale se saisit et s’affiche avec la virgule', () => {
  assert.equal(parseDecimal('1,5'), 1.5);
  assert.equal(parseDecimal('1.5'), 1.5);
  assert.equal(parseDecimal(' 0,42 '), 0.42);
  assert.equal(parseDecimal(',5'), 0.5);
  assert.equal(parseDecimal('8'), 8);
  assert.equal(parseDecimal('-2,25'), -2.25);
  for (const invalid of ['', ' ', 'abc', '1,5,2', '1.5.2', '1,5 s', ','])
    assert.ok(Number.isNaN(parseDecimal(invalid)), invalid);
  assert.equal(decimalText(1.5), '1,5');
  assert.equal(decimalText(0.42), '0,42');
  assert.equal(decimalText(8), '8');
});
