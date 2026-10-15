import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraWatchesInStandby,
  isOpening,
  OPENING_AUDIENCES,
  OPENING_TRIGGERS,
  openingFromSettings,
  sameOpeningSettings,
  settingsForOpening,
  type Opening,
  type OpeningSettings,
} from '../shared/opening.js';
import { normalizeOpening, openDatabase, SessionPreferences } from '../server/storage.js';
import type { SessionMode } from '../shared/types.js';

const openings: Opening[] = OPENING_TRIGGERS.flatMap((trigger) =>
  OPENING_AUDIENCES.flatMap((audience) =>
    [false, true].map((recognizeVoice) => ({ trigger, audience, recognizeVoice })),
  ),
);

function allSettings(): OpeningSettings[] {
  const result: OpeningSettings[] = [];
  for (const mode of [1, 2, 3, 4] as SessionMode[])
    for (const knownPeopleOnly of [false, true])
      for (const wakeWord of [false, true])
        for (const voiceRecognition of [false, true])
          result.push({ mode, knownPeopleOnly, wakeWord, voiceRecognition });
  return result;
}

test('chaque ouverture a une seule écriture, relue à l’identique', () => {
  const seen = new Map<string, Opening>();
  for (const opening of openings) {
    const settings = settingsForOpening(opening);
    assert.deepEqual(openingFromSettings(settings), opening);
    // La reconnaissance au mot d’appel est le seul réglage qui ne change pas le déclenchement.
    const key = JSON.stringify({ ...settings, voiceRecognition: undefined });
    const previous = seen.get(key);
    if (previous)
      assert.deepEqual(
        { ...previous, recognizeVoice: false },
        { ...opening, recognizeVoice: false },
        'deux ouvertures différentes ne partagent pas les mêmes réglages',
      );
    seen.set(key, opening);
  }
  assert.equal(seen.size, 6, 'trois déclencheurs × deux publics');
});

test('table logique : étape, personnes reconnues, mot d’appel et caméra en veille', () => {
  const row = (trigger: Opening['trigger'], audience: Opening['audience']) => {
    const opening = { trigger, audience, recognizeVoice: false };
    const { mode, knownPeopleOnly, wakeWord } = settingsForOpening(opening);
    return [mode, knownPeopleOnly, wakeWord, cameraWatchesInStandby(opening)];
  };
  assert.deepEqual(row('presence', 'everyone'), [1, false, false, true]);
  assert.deepEqual(row('presence', 'members'), [2, false, false, true]);
  assert.deepEqual(row('gaze', 'everyone'), [3, false, false, true]);
  assert.deepEqual(row('gaze', 'members'), [3, true, false, true]);
  assert.deepEqual(row('voice', 'everyone'), [4, false, true, false]);
  assert.deepEqual(row('voice', 'members'), [2, false, true, true]);
});

test('les anciennes combinaisons qui se recouvraient retombent sur une ouverture unique', () => {
  const read = (mode: SessionMode, knownPeopleOnly: boolean, wakeWord: boolean) =>
    openingFromSettings({ mode, knownPeopleOnly, wakeWord, voiceRecognition: false });
  // Étape 1 + personnes reconnues valait déjà l’étape 2.
  assert.deepEqual(read(1, true, false), read(2, false, false));
  assert.deepEqual(read(2, true, false), read(2, false, false));
  // Mot d’appel exigé dans une étape caméra : la voix, avec la personne reconnue comme avant.
  assert.deepEqual(read(1, false, true), {
    trigger: 'voice',
    audience: 'everyone',
    recognizeVoice: true,
  });
  assert.deepEqual(read(3, true, true), {
    trigger: 'voice',
    audience: 'members',
    recognizeVoice: false,
  });
  // L’étape 4 ignorait « personnes reconnues » : elle reste ouverte à tout le monde.
  assert.equal(read(4, true, false).audience, 'everyone');
  for (const settings of allSettings()) {
    const canonical = settingsForOpening(openingFromSettings(settings));
    assert.ok(
      sameOpeningSettings(canonical, settingsForOpening(openingFromSettings(canonical))),
      'la forme canonique est stable',
    );
  }
});

test('validation stricte du corps de requête', () => {
  assert.ok(isOpening({ trigger: 'voice', audience: 'members', recognizeVoice: false }));
  assert.ok(!isOpening({ trigger: 'voice', audience: 'members' }));
  assert.ok(!isOpening({ trigger: 'wake', audience: 'members', recognizeVoice: false }));
  assert.ok(!isOpening({ trigger: 'gaze', audience: 'all', recognizeVoice: false }));
  assert.ok(!isOpening({ trigger: 'gaze', audience: 'members', recognizeVoice: false, mode: 2 }));
  assert.ok(!isOpening(null));
});

test('au démarrage, une ancienne combinaison enregistrée est réécrite une fois', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const preferences = new SessionPreferences(db);
  preferences.setSessionMode(1);
  preferences.setKnownPeopleOnly(true);
  preferences.setWakeWordEnabled(true);
  assert.equal(normalizeOpening(preferences), true);
  assert.equal(preferences.getSessionMode(), 2);
  assert.equal(preferences.getKnownPeopleOnly(), false);
  assert.equal(preferences.getWakeWordEnabled(), true);
  assert.equal(normalizeOpening(preferences), false, 'déjà canonique : rien à réécrire');
});
