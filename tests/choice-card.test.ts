import assert from 'node:assert/strict';
import test from 'node:test';
import { KEYBOARD_COMMIT_DELAY_MS, createChoiceCommit } from '../web/components/ui/choice-card.js';

test('un clic enregistre tout de suite, les flèches seulement leur dernier choix', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: string[] = [];
  const commit = createChoiceCommit<string>((value) => sent.push(value));
  commit.pick('normal', 'pointer');
  assert.deepEqual(sent, ['normal']);
  // Trois flèches rapprochées : rien ne part avant la fin du délai, puis seulement la dernière.
  commit.pick('fast', 'keyboard');
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS - 100);
  commit.pick('ultrafast', 'keyboard');
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS - 100);
  commit.pick('normal', 'keyboard');
  assert.deepEqual(sent, ['normal']);
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS);
  assert.deepEqual(sent, ['normal', 'normal']);
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS * 4);
  assert.equal(sent.length, 2);
});

test('un clic après des flèches remplace le choix en attente', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: string[] = [];
  const commit = createChoiceCommit<string>((value) => sent.push(value));
  commit.pick('fast', 'keyboard');
  commit.pick('ultrafast', 'pointer');
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS * 2);
  assert.deepEqual(sent, ['ultrafast']);
});

test('quitter la rubrique envoie le choix en attente, annuler l’oublie', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sent: string[] = [];
  const commit = createChoiceCommit<string>((value) => sent.push(value));
  commit.pick('gaze', 'keyboard');
  commit.flush();
  assert.deepEqual(sent, ['gaze']);
  commit.flush();
  assert.deepEqual(sent, ['gaze']);
  commit.pick('voice', 'keyboard');
  commit.cancel();
  context.mock.timers.tick(KEYBOARD_COMMIT_DELAY_MS * 2);
  assert.deepEqual(sent, ['gaze']);
});
