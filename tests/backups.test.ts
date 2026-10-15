import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  MIGRATION_BACKUPS_KEPT,
  PersonalDataEraser,
  migrationBackups,
  rotateMigrationBackups,
} from '../server/backups.js';
import { openDatabase, ProfileRepository } from '../server/storage.js';

const marker = 'MARQUEUR-PERSONNEL-' + randomUUID();

function backupName(path: string, createdAt: number) {
  return `${path}.backup-v40-${createdAt}-${randomUUID()}.sqlite`;
}

function withDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'cornelius-backups-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Base réelle avec un profil, son visage et un souvenir portant un marqueur reconnaissable. */
function seed(path: string) {
  const db = openDatabase(path);
  const profile = new ProfileRepository(db).create('Alice');
  db.prepare(
    'INSERT INTO profile_faces (profile_id, embedding, templates, enrolled_at) VALUES (?, ?, ?, ?)',
  ).run(profile.id, JSON.stringify([marker]), JSON.stringify([[marker]]), Date.now());
  db.prepare(
    `INSERT INTO memories (id, profile_id, topic, fact, scope, expires_at, created_at, updated_at, evidence, origin)
     VALUES (?, ?, 'goûts', ?, 'durable', NULL, 1, 1, '[]', 'admin')`,
  ).run(randomUUID(), profile.id, marker);
  return { db, profile };
}

function count(path: string, sql: string, ...params: string[]) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Number(db.prepare(sql).get(...params)?.count);
  } finally {
    db.close();
  }
}

test('seules les deux copies pré-migration les plus récentes sont gardées, sans toucher aux autres fichiers', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    const names = [1000, 4000, 2000, 3000].map((at) => backupName(path, at));
    for (const name of names) writeFileSync(name, 'copie');
    const unrelated = join(directory, 'cornelius.sqlite.backup-manuelle.sqlite');
    writeFileSync(unrelated, 'à garder');
    writeFileSync(join(directory, 'autre.sqlite.backup-v1-9000-' + randomUUID() + '.sqlite'), 'x');

    assert.deepEqual(migrationBackups(path), [names[1], names[3], names[2], names[0]]);
    const removed = rotateMigrationBackups(path);
    assert.deepEqual(removed.sort(), [names[0], names[2]].sort());
    assert.equal(MIGRATION_BACKUPS_KEPT, 2);
    assert.deepEqual(migrationBackups(path), [names[1], names[3]]);
    assert.ok(readdirSync(directory).includes('cornelius.sqlite.backup-manuelle.sqlite'));
    assert.equal(readdirSync(directory).filter((name) => name.startsWith('autre')).length, 1);
  });
});

test('le démarrage réduit les copies accumulées par les anciennes versions', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    openDatabase(path).close();
    for (const at of [1, 2, 3, 4, 5]) writeFileSync(backupName(path, at), 'copie');
    openDatabase(path).close();
    assert.equal(migrationBackups(path).length, MIGRATION_BACKUPS_KEPT);
  });
});

test('supprimer un profil efface son visage et ses souvenirs de la base et de ses copies', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    const { db, profile } = seed(path);
    const backup = backupName(path, Date.now());
    db.prepare('VACUUM INTO ?').run(backup);
    try {
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM profile_faces'), 1);
      new ProfileRepository(db).delete(profile.id);
      new PersonalDataEraser(db, path).profileDeleted(profile.id);

      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM profiles'), 0);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM profile_faces'), 0);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM memories'), 0);
      // Ni la copie ni la base principale ne gardent la donnée dans des pages libérées.
      assert.equal(readFileSync(backup).includes(marker), false);
      assert.equal(readFileSync(path).includes(marker), false);
      assert.equal(readFileSync(path + '-wal').includes(marker), false);
    } finally {
      db.close();
    }
  });
});

test('oublier un visage ou un souvenir garde le profil mais nettoie aussi les copies', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    const { db, profile } = seed(path);
    const backup = backupName(path, Date.now());
    db.prepare('VACUUM INTO ?').run(backup);
    try {
      const eraser = new PersonalDataEraser(db, path);
      eraser.faceForgotten(profile.id);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM profile_faces'), 0);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM profiles'), 1);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM memories'), 1);

      eraser.memoriesForgotten(profile.id, null);
      assert.equal(count(backup, 'SELECT COUNT(*) AS count FROM memories'), 0);
      assert.equal(readFileSync(backup).includes(marker), false);
    } finally {
      db.close();
    }
  });
});

test('une copie illisible est supprimée plutôt que gardée avec des données personnelles', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    const { db, profile } = seed(path);
    const broken = backupName(path, Date.now());
    writeFileSync(broken, 'pas une base SQLite ' + marker);
    try {
      new PersonalDataEraser(db, path).profileDeleted(profile.id);
      assert.deepEqual(migrationBackups(path), []);
    } finally {
      db.close();
    }
  });
});

test('une copie d’un ancien schéma sans la table concernée reste utilisable', () => {
  withDirectory((directory) => {
    const path = join(directory, 'cornelius.sqlite');
    const { db, profile } = seed(path);
    const legacy = backupName(path, Date.now());
    const old = new DatabaseSync(legacy);
    old.exec(
      "CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT; INSERT INTO profiles VALUES ('autre', 'Bob', 1);",
    );
    old.close();
    try {
      new PersonalDataEraser(db, path).memoriesForgotten(profile.id, null);
      assert.deepEqual(migrationBackups(path), [legacy]);
      assert.equal(count(legacy, 'SELECT COUNT(*) AS count FROM profiles'), 1);
    } finally {
      db.close();
    }
  });
});
