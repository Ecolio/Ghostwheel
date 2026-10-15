class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.weight = 0;
    this.sum = 0;
    this.offset = 0;
    this.frame = new Int16Array(512);
    // Native-rate audio stays local until the session has been admitted.
    this.history = new Float32Array(Math.ceil(sampleRate * 16));
    this.maxBufferFrames = Math.floor(sampleRate * 8);
    this.write = 0;
    this.read = 0;
    this.triggered = false;
    this.playing = false;
    this.overflowed = false;
    // Rattrapage du retard : tant que l’envoi a plus de 0,3 s de retard sur le micro, les
    // silences du tampon sont raccourcis à 150 ms. La parole n’est jamais accélérée (sa voix
    // resterait naturelle) ; seuls les blancs, surtout l’attente de l’ouverture, disparaissent.
    this.chunk = Math.max(1, Math.floor(sampleRate * 0.01));
    this.lagLimit = Math.floor(sampleRate * 0.3);
    this.pauseKept = Math.floor(sampleRate * 0.15);
    this.quiet = 0;
    // Niveau du bruit de fond, suivi lentement pour distinguer un blanc de la parole.
    this.noiseFloor = 0.01;
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'trigger' && !this.triggered) {
        const advanced = data.advanced === true;
        this.maxBufferFrames = Math.floor(sampleRate * (advanced ? 16 : 8));
        const lookback =
          advanced && Number.isFinite(data.lookbackSeconds)
            ? Math.max(1, Math.min(16, data.lookbackSeconds))
            : advanced
              ? 1
              : 0.5;
        this.read = Math.max(0, this.write - Math.floor(sampleRate * lookback));
        this.triggered = true;
        this.quiet = 0;
      } else if (data?.type === 'reset') {
        this.triggered = false;
        this.playing = false;
        this.overflowed = false;
        this.read = this.write;
      } else if (data?.type === 'catchup' && this.triggered) {
        // Live has consumed the buffered command. Keep only a short edge buffer
        // so later turns are sent with current timing.
        this.read = Math.max(this.read, this.write - Math.floor(sampleRate * 0.25));
      } else if (data?.type === 'play') {
        this.playing = true;
      } else if (data?.type === 'pause') {
        this.playing = false;
      }
    };
  }

  /** Énergie d’un bloc de 10 ms du tampon, à partir de `start`. */
  level(start) {
    let energy = 0;
    for (let i = 0; i < this.chunk; i++) {
      const sample = this.history[(start + i) % this.history.length];
      energy += sample * sample;
    }
    return Math.sqrt(energy / this.chunk);
  }

  /** Saute les blancs du tampon en retard, en gardant une courte pause entre les mots. */
  skipSilence() {
    const threshold = Math.max(0.006, this.noiseFloor * 2.5);
    while (this.write - this.read > this.lagLimit + this.chunk) {
      if (this.level(this.read) >= threshold) {
        this.quiet = 0;
        return;
      }
      if (this.quiet < this.pauseKept) {
        this.quiet += this.chunk;
        return;
      }
      this.read += this.chunk;
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const channels = outputs?.[0];
    if (input) {
      let energy = 0;
      for (const sample of input) energy += sample * sample;
      const rms = Math.sqrt(energy / Math.max(1, input.length));
      // Descend vite vers un silence, remonte lentement : la parole ne relève pas le plancher.
      this.noiseFloor =
        rms < this.noiseFloor ? rms : this.noiseFloor + (rms - this.noiseFloor) * 0.0005;
      for (const sample of input) {
        this.history[this.write++ % this.history.length] = sample;
        let rest = 1;
        while (rest > 0) {
          const taken = Math.min(rest, this.ratio - this.weight);
          this.sum += sample * taken;
          this.weight += taken;
          rest -= taken;
          if (this.weight >= this.ratio - 1e-8) {
            this.frame[this.offset++] = Math.round(
              Math.max(-1, Math.min(1, this.sum / this.ratio)) * 32767,
            );
            this.sum = this.weight = 0;
            if (this.offset === 512) {
              this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
              this.frame = new Int16Array(512);
              this.offset = 0;
            }
          }
        }
      }
      if (this.triggered && this.write - this.read > this.maxBufferFrames) {
        this.read = this.write - this.maxBufferFrames;
        if (!this.overflowed) {
          this.overflowed = true;
          this.port.postMessage({ type: 'overflow' });
        }
      }
    }
    if (channels?.length && this.triggered && this.playing) {
      this.skipSilence();
      const output = channels[0];
      for (let i = 0; i < output.length && this.read < this.write; i++) {
        const sample = this.history[this.read++ % this.history.length];
        for (const channel of channels) channel[i] = sample;
      }
    }
    return true;
  }
}
registerProcessor('cornelius-pcm', PcmCapture);
