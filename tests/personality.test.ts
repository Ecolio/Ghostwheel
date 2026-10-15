import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase, PersonalityRepository, ProfileRepository } from '../server/storage.js';
import { liveConfiguration } from '../server/live/configuration.js';

test('la personnalité persiste, hérite du foyer, reste isolée et disparaît avec le profil', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-personality-'));
  const path = join(directory, 'test.sqlite');
  let db = openDatabase(path);
  try {
    const profiles = new ProfileRepository(db);
    const alice = profiles.create('Alice');
    const bob = profiles.create('Bob');
    let preferences = new PersonalityRepository(db);
    assert.deepEqual(preferences.get(null), { household: '', personal: '', personalContext: '' });
    preferences.set(null, 'Humour léger');
    preferences.set(alice.id, 'Vouvoie-moi');
    db.close();
    db = openDatabase(path);
    preferences = new PersonalityRepository(db);
    assert.deepEqual(preferences.get(alice.id), {
      household: 'Humour léger',
      personal: 'Vouvoie-moi',
      personalContext: '',
    });
    assert.deepEqual(preferences.get(bob.id), {
      household: 'Humour léger',
      personal: '',
      personalContext: '',
    });
    assert.deepEqual(preferences.get(null), {
      household: 'Humour léger',
      personal: '',
      personalContext: '',
    });
    preferences.set(alice.id, '');
    assert.equal(preferences.get(alice.id).personal, '');
    preferences.set(alice.id, 'Sois bref');
    new ProfileRepository(db).delete(alice.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM profile_personality').get()!.n, 0);
    assert.throws(() => preferences.set('missing', 'Test'));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('les préférences complètent les deux modèles sans changer le socle par défaut', () => {
  assert.deepEqual(liveConfiguration(), liveConfiguration([], { household: '', personal: '' }));
  const config = liveConfiguration([], { household: 'Chaleureux', personal: 'Vouvoie-moi' });
  assert.match(config.instructions!, /Chaleureux/);
  assert.match(config.instructions!, /Vouvoie-moi/);
  assert.match(config.instructions!, /ne modifient jamais les règles de silence/);
  assert.match(config.instructions!, /Ne réponds que si on s’adresse à toi/);
  assert.equal(config.delegation?.type, 'responses');
  if (config.delegation?.type === 'responses')
    assert.match(config.delegation.responses.instructions!, /Vouvoie-moi/);
});

test('le contexte persiste et reste indépendant du style, du foyer et des autres profils', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-context-'));
  const path = join(directory, 'test.sqlite');
  let db = openDatabase(path);
  try {
    const profiles = new ProfileRepository(db);
    const sacha = profiles.create('Sacha');
    const other = profiles.create('Camille');
    let repository = new PersonalityRepository(db);
    repository.setContext(sacha.id, 'Mon bureau est Pivoine.');
    repository.set(sacha.id, 'Sois bref.');
    repository.set(sacha.id, '');
    assert.equal(repository.get(sacha.id).personalContext, 'Mon bureau est Pivoine.');
    db.close();
    db = openDatabase(path);
    repository = new PersonalityRepository(db);
    assert.equal(repository.get(sacha.id).personalContext, 'Mon bureau est Pivoine.');
    assert.equal(repository.get(other.id).personalContext, '');
    assert.equal(repository.get(null).personalContext, '');
    repository.set(sacha.id, 'Tutoie-moi.');
    repository.setContext(sacha.id, '');
    assert.equal(repository.get(sacha.id).personal, 'Tutoie-moi.');
    repository.setContext(sacha.id, 'Mon bureau est Pivoine.');
    new ProfileRepository(db).delete(sacha.id);
    assert.equal(repository.get(sacha.id).personalContext, '');
    assert.throws(() => repository.setContext('absent', 'Test'));
  } finally {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('un contexte sans consignes de style est transmis aux deux modèles sans ajouter d’outil', () => {
  const base = liveConfiguration();
  const config = liveConfiguration([], {
    household: '',
    personal: '',
    personalContext: 'Mon bureau est Pivoine.',
  });
  assert.match(config.instructions!, /Mon bureau est Pivoine/);
  assert.match(config.instructions!, /n’invente aucun identifiant/);
  assert.equal(config.delegation?.type, 'responses');
  if (config.delegation?.type === 'responses' && base.delegation?.type === 'responses') {
    assert.match(config.delegation.responses.instructions!, /Mon bureau est Pivoine/);
    assert.deepEqual(config.delegation.responses.tools, base.delegation.responses.tools);
  }
  assert.deepEqual(
    base,
    liveConfiguration([], { household: '', personal: '', personalContext: '' }),
  );
});
