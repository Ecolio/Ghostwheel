/** Un appareil (miroir ou satellite) qui vient d’entendre « Cornelius ». */
export interface WakeCandidate {
  score: number;
  accept(): void;
}

/**
 * Plusieurs appareils dans la même pièce entendent le même « Cornelius » : le meilleur score
 * l’emporte. Avec un seul flux à l’écoute, la détection passe aussitôt, sans délai ajouté.
 */
export class WakeArbiter {
  private pending: { best: WakeCandidate; timer: ReturnType<typeof setTimeout> } | null = null;
  private settledUntil = 0;
  constructor(
    /** Nombre de flux à l’écoute du mot d’appel. */
    private readonly contenders: () => number,
    private readonly now: () => number = Date.now,
    private readonly windowMs = 250,
    /** Après une décision, les échos tardifs du même appel sont ignorés. */
    private readonly quietMs = 1500,
  ) {}
  detected(candidate: WakeCandidate): void {
    if (this.pending) {
      if (candidate.score > this.pending.best.score) this.pending.best = candidate;
      return;
    }
    if (this.now() < this.settledUntil) return;
    if (this.contenders() <= 1) return this.settle(candidate);
    this.pending = {
      best: candidate,
      timer: setTimeout(() => {
        const best = this.pending!.best;
        this.pending = null;
        this.settle(best);
      }, this.windowMs),
    };
  }
  private settle(candidate: WakeCandidate) {
    this.settledUntil = this.now() + this.quietMs;
    candidate.accept();
  }
  dispose(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}
