import { readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { DiagnosticLog } from './logs.js';

/** Copies pré-migration gardées : les plus récentes suffisent pour revenir en arrière. */
export const MIGRATION_BACKUPS_KEPT = 2;

export interface BackupErasure {
  sql: string;
  params: SQLInputValue[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Copies créées par `openDatabase` pour cette base, de la plus récente à la plus ancienne. */
export function migrationBackups(databasePath: string): string[] {
  const directory = dirname(databasePath);
  const pattern = new RegExp(
    '^' +
      escapeRegExp(basename(databasePath)) +
      '\\.backup-v\\d+-(\\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.sqlite$',
    'u',
  );
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  return entries
    .flatMap((name) => {
      const match = pattern.exec(name);
      return match ? [{ path: join(directory, name), createdAt: Number(match[1]) }] : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.path.localeCompare(a.path))
    .map((entry) => entry.path);
}

function removeBackup(path: string) {
  for (const file of [path, path + '-wal', path + '-shm', path + '-journal'])
    rmSync(file, { force: true });
}

/** Ne garde que les copies les plus récentes ; un fichier sans le nom attendu n’est jamais touché. */
export function rotateMigrationBackups(
  databasePath: string,
  keep = MIGRATION_BACKUPS_KEPT,
): string[] {
  const removed: string[] = [];
  for (const path of migrationBackups(databasePath).slice(Math.max(0, keep))) {
    // Sous Windows, un antivirus ou un outil SQLite peut verrouiller une copie : elle sera
    // retirée au prochain démarrage, sans empêcher celui-ci.
    try {
      removeBackup(path);
      removed.push(path);
    } catch {
      continue;
    }
  }
  return removed;
}

/**
 * Applique les suppressions aux copies de sécurité. Une table absente d’un ancien schéma est
 * ignorée ; une copie illisible ou impossible à nettoyer est supprimée plutôt que conservée.
 */
export function eraseFromBackups(
  databasePath: string,
  erasures: BackupErasure[],
): { cleaned: number; removed: number } {
  let cleaned = 0;
  let removed = 0;
  for (const path of migrationBackups(databasePath)) {
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(path);
      db.exec('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');
      let changes = 0;
      for (const { sql, params } of erasures) {
        try {
          changes += Number(db.prepare(sql).run(...params).changes);
        } catch (error) {
          if (/no such table/iu.test((error as Error).message)) continue;
          throw error;
        }
      }
      if (changes > 0) {
        // Réécrit le fichier : aucune page libérée ne garde l’ancienne donnée.
        db.exec('PRAGMA journal_mode = DELETE');
        db.exec('VACUUM');
        cleaned++;
      }
      db.close();
      db = null;
    } catch {
      if (db?.isOpen) db.close();
      removeBackup(path);
      removed++;
    }
  }
  return { cleaned, removed };
}

/**
 * Effacement réel des données personnelles : la base principale vide son journal WAL et les
 * copies pré-migration perdent la même donnée. Sans cela, une signature faciale supprimée
 * survivait dans les sauvegardes.
 */
export class PersonalDataEraser {
  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    private readonly logs?: DiagnosticLog,
  ) {}

  profileDeleted(profileId: string) {
    this.erase('profil', [{ sql: 'DELETE FROM profiles WHERE id = ?', params: [profileId] }]);
  }

  faceForgotten(profileId: string) {
    this.erase('visage', [
      { sql: 'DELETE FROM profile_faces WHERE profile_id = ?', params: [profileId] },
    ]);
  }

  memoriesForgotten(profileId: string, memoryId: string | null) {
    this.erase('souvenir', [
      memoryId
        ? {
            sql: 'DELETE FROM memories WHERE id = ? AND profile_id = ?',
            params: [memoryId, profileId],
          }
        : { sql: 'DELETE FROM memories WHERE profile_id = ?', params: [profileId] },
    ]);
  }

  private erase(kind: string, erasures: BackupErasure[]) {
    try {
      // Les anciennes versions des pages restent dans le WAL jusqu’au point de contrôle.
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* Une lecture concurrente retarde seulement le point de contrôle suivant. */
    }
    if (this.databasePath === ':memory:') return;
    const result = eraseFromBackups(this.databasePath, erasures);
    if (result.cleaned || result.removed)
      this.logs?.write('info', 'local', 'Données retirées des sauvegardes', { kind, ...result });
  }
}
