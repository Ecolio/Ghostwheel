import type { WebSocket } from 'ws';
import type { DiagnosticLog } from './logs.js';
import { SATELLITE_PROTOCOL } from './satellites.js';

/** Un satellite neuf qui attend d’être associé, tel que l’administration le voit. */
export interface PendingSatellite {
  /** Nom du satellite sur le réseau (cornelius-satellite-xxxxxx), qui l’identifie. */
  device: string;
  firmware: string;
  address: string | null;
  since: number;
}

interface Pending extends PendingSatellite {
  socket: WebSocket;
}

// Peu de satellites neufs à la fois : au-delà, les plus anciens attendront une reconnexion.
const MAX_PENDING = 8;
const HELLO_MS = 5000;
const DEVICE_PATTERN = /^[a-z0-9-]{3,48}$/u;

/**
 * Association des satellites neufs. Un satellite sans jeton ouvre /satellite/pair et se
 * présente ; il attend que quelqu’un l’associe dans l’administration, qui crée alors le
 * satellite et lui envoie son jeton sur cette connexion. Rien n’est accordé sans ce clic.
 */
export class SatellitePairing {
  private pending = new Map<string, Pending>();
  constructor(
    private readonly logs: DiagnosticLog,
    private readonly now: () => number = Date.now,
  ) {}

  list(): PendingSatellite[] {
    return [...this.pending.values()]
      .sort((a, b) => a.since - b.since)
      .map(({ device, firmware, address, since }) => ({ device, firmware, address, since }));
  }

  connect(socket: WebSocket, address: string | null): void {
    let device: string | null = null;
    const helloTimer = setTimeout(() => socket.close(1008, 'Message pair attendu.'), HELLO_MS);
    helloTimer.unref?.();
    socket.on('message', (data, binary) => {
      if (binary || device) return;
      let message: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (parsed && typeof parsed === 'object') message = parsed as Record<string, unknown>;
      } catch {
        /* Message illisible : refusé ci-dessous. */
      }
      if (
        message.type !== 'pair' ||
        message.protocol !== SATELLITE_PROTOCOL ||
        typeof message.device !== 'string' ||
        !DEVICE_PATTERN.test(message.device) ||
        typeof message.firmware !== 'string' ||
        message.firmware.length < 1 ||
        message.firmware.length > 32
      )
        return socket.close(1008, 'Message pair invalide.');
      clearTimeout(helloTimer);
      device = message.device;
      this.pending.get(device)?.socket.close(1008, 'Satellite reconnecté.');
      if (!this.pending.has(device) && this.pending.size >= MAX_PENDING) {
        const oldest = this.list()[0];
        if (oldest)
          this.pending.get(oldest.device)?.socket.close(1008, 'Trop de satellites neufs.');
      }
      this.pending.set(device, {
        socket,
        device,
        firmware: message.firmware,
        address,
        since: this.now(),
      });
      this.logs.write('info', 'local', 'Satellite neuf en attente d’association', {
        device,
        firmware: message.firmware,
      });
      this.send(socket, { type: 'waiting' });
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (device && this.pending.get(device)?.socket === socket) this.pending.delete(device);
    });
    socket.on('error', () => socket.close());
  }

  /** Fait clignoter l’anneau du satellite, pour le reconnaître parmi d’autres. */
  identify(device: string): boolean {
    const entry = this.pending.get(device);
    if (!entry) return false;
    this.send(entry.socket, { type: 'identify' });
    return true;
  }

  /**
   * Association acceptée : le satellite reçoit son jeton et son nom, puis se reconnecte en
   * satellite ordinaire. Faux s’il n’attend plus (le satellite créé est alors à retirer).
   */
  accept(device: string, satellite: { name: string; token: string }): boolean {
    const entry = this.pending.get(device);
    if (!entry || entry.socket.readyState !== 1) return false;
    this.pending.delete(device);
    this.send(entry.socket, { type: 'paired', name: satellite.name, token: satellite.token });
    this.logs.write('info', 'local', 'Satellite associé', { device, satellite: satellite.name });
    // Le satellite ferme lui-même après avoir enregistré son jeton ; sinon, au bout de 5 s.
    setTimeout(() => entry.socket.close(1000, 'Associé.'), 5000).unref?.();
    return true;
  }

  reject(device: string): boolean {
    const entry = this.pending.get(device);
    if (!entry) return false;
    this.pending.delete(device);
    entry.socket.close(1008, 'Association refusée.');
    return true;
  }

  dispose(): void {
    for (const entry of this.pending.values()) entry.socket.close(1001, 'Arrêt du serveur');
    this.pending.clear();
  }

  private send(socket: WebSocket, value: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(value));
  }
}
