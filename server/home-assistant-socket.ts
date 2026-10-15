import WebSocket from 'ws';

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Aucune réponse avant l’authentification : adresse erronée ou Home Assistant éteint. */
export const HOME_ASSISTANT_UNREACHABLE =
  'Home Assistant ne répond pas à cette adresse (souvent http://homeassistant.local:8123).';
/** Coupure d’une connexion établie : Cornelius réessaie seul. */
export const HOME_ASSISTANT_CUT =
  'La connexion à Home Assistant s’est coupée. Cornelius réessaie automatiquement.';

export class HomeAssistantError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Canal HA authentifié ; aucun message ou détail d'erreur distant n'est journalisé. */
export class HomeAssistantSocket {
  private socket: WebSocket;
  private nextId = 1;
  private authenticated = false;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly ready: Promise<void>;
  constructor(
    url: string,
    token: string,
    onEvent: (event: unknown) => void,
    onClose: (error: HomeAssistantError) => void,
  ) {
    const target = new URL('/api/websocket', url);
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(target, {
      followRedirects: false,
      handshakeTimeout: 5000,
      maxPayload: 4 * 1024 * 1024,
    });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void this.ready.catch(() => {});
    const timer = setTimeout(
      () => fail(new HomeAssistantError('unreachable', HOME_ASSISTANT_UNREACHABLE)),
      5000,
    );
    // Avant l’authentification, une erreur désigne l’adresse ; après, une coupure.
    const lost = () =>
      this.authenticated
        ? new HomeAssistantError('unavailable', HOME_ASSISTANT_CUT)
        : new HomeAssistantError('unreachable', HOME_ASSISTANT_UNREACHABLE);
    const fail = (error: HomeAssistantError) => {
      if (this.closed) return;
      this.closed = true;
      this.authenticated = false;
      clearTimeout(timer);
      clearInterval(heartbeat);
      rejectReady(error);
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      this.pending.clear();
      this.socket.terminate();
      onClose(error);
    };
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!this.authenticated || this.closed) return;
      if (!alive) {
        fail(new HomeAssistantError('unavailable', HOME_ASSISTANT_CUT));
        return;
      }
      alive = false;
      this.socket.ping();
    }, 15_000);
    heartbeat.unref();
    this.socket.on('pong', () => {
      alive = true;
    });
    this.socket.on('error', () => fail(lost()));
    this.socket.on('close', () => fail(lost()));
    this.socket.on('message', (raw) => {
      let message: Record<string, unknown>;
      try {
        message = record(JSON.parse(String(raw)));
      } catch {
        fail(new HomeAssistantError('malformed', 'Réponse Home Assistant invalide.'));
        return;
      }
      if (message.type === 'auth_required') {
        this.socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (message.type === 'auth_ok') {
        clearTimeout(timer);
        this.authenticated = true;
        resolveReady();
      } else if (message.type === 'auth_invalid') {
        fail(
          new HomeAssistantError(
            'auth',
            'Home Assistant a refusé le jeton. Créez-en un nouveau dans votre profil Home Assistant.',
          ),
        );
      } else if (message.type === 'event') {
        onEvent(message.event);
      } else if (message.type === 'result' && typeof message.id === 'number') {
        const item = this.pending.get(message.id);
        if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.success === true) item.resolve(message.result);
        else {
          const code = record(message.error).code;
          item.reject(
            new HomeAssistantError(
              code === 'unauthorized' ? 'forbidden' : 'upstream',
              code === 'unauthorized'
                ? 'Droits Home Assistant insuffisants pour cette opération.'
                : 'Home Assistant a refusé cette opération.',
            ),
          );
        }
      }
    });
    this.stop = () => fail(new HomeAssistantError('cancelled', 'Connexion Home Assistant fermée.'));
  }
  private stop: () => void;
  dispose() {
    this.stop();
  }
  async request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    await this.ready;
    if (this.closed || !this.authenticated)
      throw new HomeAssistantError('unavailable', 'Home Assistant déconnecté.');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HomeAssistantError('timeout', 'Home Assistant ne répond pas à temps.'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...fields, id, type }), (error) => {
        if (!error) return;
        const item = this.pending.get(id);
        if (item) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new HomeAssistantError('unavailable', 'Envoi à Home Assistant interrompu.'));
        }
      });
    });
  }
}
