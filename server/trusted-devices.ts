import type { DatabaseSync } from 'node:sqlite';

/** Appareils du réseau local autorisés à ouvrir le miroir (rejouable). */
export const trustedDevicesMigration = `CREATE TABLE IF NOT EXISTS trusted_devices (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;`;

/**
 * Un appareil du réseau devient un miroir autorisé quand quelqu'un s'y connecte une fois à
 * l'administration : son identifiant de miroir (cookie) est alors retenu. La machine elle-même
 * n'en a jamais besoin.
 */
export class TrustedDevices {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {}
  has(id: string | undefined): boolean {
    if (!id) return false;
    return !!this.db.prepare('SELECT 1 FROM trusted_devices WHERE id = ?').get(id);
  }
  add(id: string): void {
    const time = this.now();
    this.db
      .prepare(
        'INSERT INTO trusted_devices (id, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at',
      )
      .run(id, time, time);
  }
  count(): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get()?.n ?? 0);
  }
  clear(): void {
    this.db.exec('DELETE FROM trusted_devices');
  }
}
