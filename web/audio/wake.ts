import { warmAudioConnection } from './connection';

/** Local wake inference shares the capture that will be transferred to WebRTC. */
export class WakeListener {
  private disposed = false;
  private socket: WebSocket | null = null;
  private unsubscribe: (() => void) | null = null;
  private frame = new Int16Array(1280);
  private offset = 0;

  constructor(
    private readonly interrupted: (reason: 'microphone' | 'socket') => void,
    private readonly advancedBuffer = false,
  ) {}

  async start(): Promise<void> {
    try {
      const connection = warmAudioConnection(true, this.advancedBuffer);
      if (!connection) throw new Error('Microphone de veille non préparé.');
      const stream = await connection.microphone();
      if (this.disposed) return;
      // Une suspension brève (changement de sortie audio) se reprend sans nouveau geste.
      if (connection.context.state !== 'running')
        await Promise.race([
          connection.context.resume().catch(() => {}),
          new Promise<void>((resolve) => setTimeout(resolve, 1000)),
        ]);
      if (this.disposed) return;
      if (connection.context.state !== 'running') throw new Error('AudioContext suspendu.');
      const socket = new WebSocket(
        (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wake-audio',
      );
      this.socket = socket;
      socket.onmessage = ({ data }) => {
        if (this.disposed || !this.advancedBuffer) return;
        try {
          if (JSON.parse(String(data))?.type === 'wake_detected') connection.triggerAudio(true);
        } catch {
          // Only the server's wake notification is expected here.
        }
      };
      socket.onclose = () => {
        if (!this.disposed) this.interrupted('socket');
      };
      socket.onerror = () => socket.close();
      this.unsubscribe = connection.subscribePcm((data) => {
        if (this.disposed || socket.readyState !== WebSocket.OPEN) return;
        const samples = new Int16Array(data);
        for (const sample of samples) {
          this.frame[this.offset++] = sample;
          if (this.offset === this.frame.length) {
            if (socket.bufferedAmount < 10_240) socket.send(this.frame.buffer);
            this.frame = new Int16Array(1280);
            this.offset = 0;
          }
        }
      });
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          if (!this.disposed) this.interrupted('microphone');
        };
      });
    } catch (error) {
      if (this.disposed) return;
      this.stop();
      throw error;
    }
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.socket?.close();
  }
}
