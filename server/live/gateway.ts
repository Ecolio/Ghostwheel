import type { DiagnosticLog } from '../logs.js';
import OpenAI from 'openai';
import WebSocket from 'ws';
import type { LiveCreateResponse, MediaSessionConfig } from 'openai/resources/live/live';
import type { ConnectClientEvent, ConnectServerEvent } from 'openai/resources/live/sideband';

export interface LiveConnection {
  send(event: ConnectClientEvent): void;
  dispose(): void;
}
export interface LiveGateway {
  hangup?(id: string): Promise<void>;
  /** Ouvre la connexion HTTPS que réutilisera la création de session, sans rien créer. */
  prewarm?(): Promise<void>;
  create(
    config: MediaSessionConfig,
    sdp: string,
    signal?: AbortSignal,
  ): Promise<LiveCreateResponse>;
  attach(
    id: string,
    handlers: {
      open(): void;
      event(event: ConnectServerEvent): void;
      failure(): void;
    },
  ): LiveConnection;
}
export function createLiveGateway(apiKey: string, logs?: DiagnosticLog): LiveGateway {
  const client = new OpenAI({ apiKey, timeout: 4000, maxRetries: 0 });
  return {
    hangup: (id) => client.live.sessions.hangup(id),
    // Lecture gratuite : le handshake TLS est fait avant l’admission, pas pendant la création.
    prewarm: async () => {
      await client.models.retrieve('gpt-live-1').catch(() => {});
    },
    create: (session, sdp, signal) =>
      client.live.create({ session, transport: { type: 'webrtc', sdp } }, { signal }),
    attach(id, handlers) {
      const socket = new WebSocket(
        'wss://api.openai.com/v1/live/sessions/' + encodeURIComponent(id) + '/attach',
        {
          headers: { Authorization: 'Bearer ' + apiKey },
          handshakeTimeout: 4000,
          maxPayload: 1024 * 1024,
        },
      );
      logs?.write('info', 'openai', 'Connexion du canal de contrôle', { remoteId: id });
      socket.on('open', () => {
        logs?.write('info', 'openai', 'Canal de contrôle connecté', { remoteId: id });
        handlers.open();
      });
      socket.on('message', (data) => {
        try {
          handlers.event(JSON.parse(data.toString()) as ConnectServerEvent);
        } catch (error) {
          logs?.write('error', 'openai', 'Traitement du message de contrôle échoué', {
            remoteId: id,
            error,
          });
          handlers.failure();
        }
      });
      socket.on('error', (error) => {
        logs?.write('error', 'openai', 'Erreur réseau du canal de contrôle', {
          remoteId: id,
          error,
        });
        handlers.failure();
      });
      socket.on('close', (code) => {
        logs?.write('warn', 'openai', 'Canal de contrôle fermé', { remoteId: id, code });
        handlers.failure();
      });
      return {
        send(event) {
          if (socket.readyState !== WebSocket.OPEN) throw new Error('Contrôle Live indisponible.');
          socket.send(JSON.stringify(event));
        },
        dispose() {
          socket.removeAllListeners();
          socket.on('error', () => {});
          socket.terminate();
        },
      };
    },
  };
}
