import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Satellites audio du foyer (rejouable). Le jeton n’est jamais gardé : seulement son empreinte.
 * Créée par le registre lui-même tant que la fonction reste sur la branche des satellites :
 * sans changer la version de la base, une branche principale l’ouvre encore.
 */
export const satellitesMigration = `CREATE TABLE IF NOT EXISTS satellites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  token_hash TEXT NOT NULL UNIQUE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  volume INTEGER NOT NULL DEFAULT 70 CHECK (volume BETWEEN 0 AND 100),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
) STRICT;`;

export const SATELLITE_NAME_MAX = 40;

export interface Satellite {
  id: string;
  name: string;
  /** Profil rattaché (mémoire personnelle) ; null : satellite anonyme, le cas par défaut. */
  profileId: string | null;
  volume: number;
  createdAt: number;
  lastSeenAt: number | null;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

function satellite(row: Record<string, unknown>): Satellite {
  return {
    id: String(row.id),
    name: String(row.name),
    profileId: row.profile_id === null ? null : String(row.profile_id),
    volume: Number(row.volume),
    createdAt: Number(row.created_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
  };
}

export class SatelliteStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {
    db.exec(satellitesMigration);
  }
  list(): Satellite[] {
    return this.db
      .prepare('SELECT * FROM satellites ORDER BY created_at, id')
      .all()
      .map((row) => satellite(row));
  }
  get(id: string): Satellite | null {
    const row = this.db.prepare('SELECT * FROM satellites WHERE id = ?').get(id);
    return row ? satellite(row) : null;
  }
  /** Le jeton n’est rendu qu’ici : il faut le noter tout de suite dans le satellite. */
  create(name: string): { satellite: Satellite; token: string } {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    this.db
      .prepare('INSERT INTO satellites (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, tokenHash(token), this.now());
    return { satellite: this.get(id)!, token };
  }
  /** Nouveau jeton : l’ancien cesse aussitôt de fonctionner. */
  renewToken(id: string): string | null {
    const token = randomBytes(32).toString('base64url');
    const changed = this.db
      .prepare('UPDATE satellites SET token_hash = ? WHERE id = ?')
      .run(tokenHash(token), id).changes;
    return changed ? token : null;
  }
  update(
    id: string,
    changes: { name?: string; profileId?: string | null; volume?: number },
  ): Satellite | null {
    const current = this.get(id);
    if (!current) return null;
    this.db
      .prepare('UPDATE satellites SET name = ?, profile_id = ?, volume = ? WHERE id = ?')
      .run(
        changes.name ?? current.name,
        changes.profileId === undefined ? current.profileId : changes.profileId,
        changes.volume ?? current.volume,
        id,
      );
    return this.get(id);
  }
  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM satellites WHERE id = ?').run(id).changes > 0;
  }
  /** Satellite du jeton présenté, ou null. Le jeton est comparé par son empreinte. */
  authenticate(token: string): Satellite | null {
    if (!token || token.length > 256) return null;
    const row = this.db
      .prepare('SELECT * FROM satellites WHERE token_hash = ?')
      .get(tokenHash(token));
    return row ? satellite(row) : null;
  }
  seen(id: string): void {
    this.db.prepare('UPDATE satellites SET last_seen_at = ? WHERE id = ?').run(this.now(), id);
  }
}
