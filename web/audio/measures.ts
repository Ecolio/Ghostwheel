import type { VoiceActivity } from '../../shared/types';

export type ConversationPhase = VoiceActivity['phase'];
export type ConversationMeasureName = 'reponse_latence' | 'interruption';

const AUDIBLE = 0.02;
const ANSWER_TIMEOUT_MS = 10_000;
const INTERRUPTION_TIMEOUT_MS = 5_000;

/**
 * Derives the two conversation latencies of the recipe from the server voice phase and the
 * local output level: question end to first audible answer, and user speech to silenced
 * output. Pure logic, so it is unit-testable without a browser.
 */
export class ConversationMeasures {
  private phase: ConversationPhase = 'idle';
  private outputActive = false;
  private awaitingAnswerFrom: number | null = null;
  private interruptionFrom: number | null = null;

  constructor(private readonly emit: (name: ConversationMeasureName, durationMs: number) => void) {}

  onPhase(phase: ConversationPhase, at: number): void {
    if (this.phase === 'listening' && phase !== 'listening') this.awaitingAnswerFrom = at;
    if (phase === 'listening') {
      if (this.outputActive) {
        this.interruptionFrom ??= at;
        this.awaitingAnswerFrom = null;
      }
    }
    this.phase = phase;
  }

  sample(output: number, at: number): void {
    const active = output >= AUDIBLE;
    if (active !== this.outputActive) {
      this.outputActive = active;
      if (this.interruptionFrom !== null) {
        this.emit('interruption', at - this.interruptionFrom);
        this.interruptionFrom = null;
      } else if (active && this.awaitingAnswerFrom !== null) {
        this.emit('reponse_latence', at - this.awaitingAnswerFrom);
        this.awaitingAnswerFrom = null;
      }
    }
    if (this.awaitingAnswerFrom !== null && at - this.awaitingAnswerFrom > ANSWER_TIMEOUT_MS)
      this.awaitingAnswerFrom = null;
    if (this.interruptionFrom !== null && at - this.interruptionFrom > INTERRUPTION_TIMEOUT_MS)
      this.interruptionFrom = null;
  }

  reset(): void {
    this.phase = 'idle';
    this.outputActive = false;
    this.awaitingAnswerFrom = null;
    this.interruptionFrom = null;
  }
}
