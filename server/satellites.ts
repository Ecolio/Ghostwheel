import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { DiagnosticLog } from './logs.js';
import type { SessionController } from './controller.js';
import type { PerceptionBridge } from './perception.js';
import type { WakeArbiter } from './wake-arbiter.js';
import type { Satellite, SatelliteStore } from './satellites-store.js';

/** Version du protocole des satellites (docs/developpement/satellites-protocole.md). */
export const SATELLITE_PROTOCOL = 1;
const FRAME_BYTES = 2560;
const HELLO_MS = 5000;
const PING_MS = 15_000;

interface Connection {
  socket: WebSocket;
  satellite: Satellite;
  streamId: string;
  firmware: string | null;
  muted: boolean;
  listening: boolean | null;
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

export interface SatelliteStatus {
  online: boolean;
  firmware: string | null;
  muted: boolean;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * Satellites audio connectés : leur son de veille rejoint la perception, et leurs détections
 * l’arbitrage commun avec le miroir. Le son n’est demandé que pendant que la veille écoute.
 */
export class SatelliteHub {
  private connections = new Map<string, Connection>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: () => void;
  private disposed = false;
  constructor(
    private readonly deps: {
      store: SatelliteStore;
      perception: PerceptionBridge;
      arbiter: WakeArbiter;
      controller: SessionController;
      logs: DiagnosticLog;
      /** Faux dans les tests : pas de ping périodique. */
      heartbeat?: boolean;
    },
  ) {
    this.unsubscribe = deps.controller.subscribe(() => this.syncListening());
    if (deps.heartbeat !== false) {
      this.pingTimer = setInterval(() => this.ping(), PING_MS);
      this.pingTimer.unref();
    }
  }

  status(id: string): SatelliteStatus {
    const connection = this.connections.get(id);
    return connection?.firmware
      ? { online: true, firmware: connection.firmware, muted: connection.muted }
      : { online: false, firmware: null, muted: false };
  }

  connect(socket: WebSocket, satellite: Satellite): void {
    this.connections.get(satellite.id)?.socket.close(1008, 'Satellite reconnecté ailleurs.');
    const connection: Connection = {
      socket,
      satellite,
      streamId: randomUUID(),
      firmware: null,
      muted: false,
      listening: null,
      alive: true,
      helloTimer: setTimeout(() => socket.close(1008, 'Message hello attendu.'), HELLO_MS),
    };
    connection.helloTimer!.unref?.();
    this.connections.set(satellite.id, connection);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, binary) => {
      if (this.connections.get(satellite.id) !== connection) return;
      if (binary) return this.audio(connection, data);
      let message: Record<string, unknown>;
      try {
        message = object(JSON.parse(String(data)));
      } catch {
        if (!connection.firmware) socket.close(1008, 'Message hello attendu.');
        return;
      }
      if (!connection.firmware) return this.hello(connection, message);
      if (message.type === 'mic' && typeof message.muted === 'boolean') {
        connection.muted = message.muted;
        this.deps.logs.write('info', 'local', 'Micro du satellite', {
          satellite: satellite.name,
          muted: message.muted,
        });
      }
    });
    socket.on('close', () => this.closed(connection));
    socket.on('error', () => socket.close());
  }

  /** Satellite supprimé ou jeton renouvelé : sa connexion s’arrête aussitôt. */
  disconnect(id: string, reason: string): void {
    this.connections.get(id)?.socket.close(1008, reason);
  }

  /** Nom ou réglages changés : la connexion en cours les reprend. */
  refresh(satellite: Satellite): void {
    const connection = this.connections.get(satellite.id);
    if (connection) connection.satellite = satellite;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const connection of this.connections.values())
      connection.socket.close(1001, 'Arrêt du serveur');
    this.connections.clear();
  }

  private hello(connection: Connection, message: Record<string, unknown>) {
    const { socket, satellite } = connection;
    if (
      message.type !== 'hello' ||
      message.protocol !== SATELLITE_PROTOCOL ||
      typeof message.firmware !== 'string' ||
      message.firmware.length < 1 ||
      message.firmware.length > 32
    )
      return socket.close(
        1008,
        message.type === 'hello' && message.protocol !== SATELLITE_PROTOCOL
          ? 'Protocole non pris en charge.'
          : 'Message hello invalide.',
      );
    if (connection.helloTimer) clearTimeout(connection.helloTimer);
    connection.helloTimer = null;
    const started = this.deps.perception.startWakeStream(connection.streamId, (score) =>
      this.deps.arbiter.detected({ score, accept: () => this.wakeAccepted(connection, score) }),
    );
    if (!started) return socket.close(1008, 'Écoute du mot d’appel saturée.');
    connection.firmware = message.firmware;
    this.deps.store.seen(satellite.id);
    this.deps.logs.write('info', 'local', 'Satellite connecté', {
      satellite: satellite.name,
      firmware: message.firmware,
    });
    this.send(connection, {
      type: 'welcome',
      protocol: SATELLITE_PROTOCOL,
      id: satellite.id,
      name: satellite.name,
      volume: satellite.volume,
    });
    this.syncListening();
  }

  private audio(connection: Connection, data: unknown) {
    const { socket } = connection;
    if (!connection.firmware) return socket.close(1008, 'Message hello attendu.');
    const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (pcm.length !== FRAME_BYTES) return socket.close(1008, 'Trame audio invalide.');
    // Trames encore en route après « listen: false », ou micro coupé : jamais analysées.
    if (connection.muted || !connection.listening) return;
    this.deps.perception.wakeAudio(connection.streamId, pcm);
  }

  private wakeAccepted(connection: Connection, score: number) {
    if (this.connections.get(connection.satellite.id) !== connection) return;
    if (!this.deps.controller.isWakeListening()) return;
    this.deps.logs.write('info', 'local', 'Mot d’appel entendu par un satellite', {
      satellite: connection.satellite.name,
      score: Math.round(score * 100) / 100,
    });
    this.send(connection, { type: 'wake', score: Math.round(score * 100) / 100 });
  }

  private syncListening() {
    const listening = this.deps.controller.isWakeListening();
    for (const connection of this.connections.values()) {
      if (!connection.firmware || connection.listening === listening) continue;
      connection.listening = listening;
      this.send(connection, { type: 'listen', enabled: listening });
    }
  }

  private ping() {
    for (const connection of this.connections.values()) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private closed(connection: Connection) {
    if (connection.helloTimer) clearTimeout(connection.helloTimer);
    // Fermetures dues à l’arrêt du serveur : la base est déjà fermée.
    if (this.disposed) return;
    this.deps.perception.endWakeStream(connection.streamId);
    if (this.connections.get(connection.satellite.id) !== connection) return;
    this.connections.delete(connection.satellite.id);
    if (!connection.firmware) return;
    this.deps.store.seen(connection.satellite.id);
    this.deps.logs.write('info', 'local', 'Satellite déconnecté', {
      satellite: connection.satellite.name,
    });
  }

  private send(connection: Connection, value: unknown) {
    if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify(value));
  }
}
