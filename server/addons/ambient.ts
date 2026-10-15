import type { AddonInstance, AmbientDisplay } from '../../shared/addons.js';
import { ambientProfile } from '../../shared/ambient.js';
import type { MirrorState } from '../../shared/types.js';
import type { AddonRuntime } from './runtime.js';

interface Job {
  key: string;
  abort: AbortController;
  pending: boolean;
  nextAttempt: number;
  failures: number;
}

/** Collecte locale à la présence, sans session Live ni carte. Le cache reste celui du runtime. */
export class AmbientModules {
  private jobs = new Map<string, Job>();
  private profile: string | null | undefined;
  private disposed = false;

  constructor(
    private readonly runtime: AddonRuntime,
    private readonly state: () => MirrorState,
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  private instances(state: MirrorState): AddonInstance[] {
    const profile = ambientProfile(state);
    return profile === undefined ? [] : this.runtime.ambientInstances(profile);
  }

  /** Filtrage à chaque projection, avant toute émission HTTP ou WebSocket. */
  view(state: MirrorState): AmbientDisplay[] {
    if (this.disposed) return [];
    return this.instances(state).map((instance) => this.runtime.ambientDisplay(instance));
  }

  tick(): void {
    if (this.disposed) return;
    const state = this.state();
    const profile = ambientProfile(state);
    if (profile !== this.profile) {
      for (const job of this.jobs.values()) job.abort.abort();
      this.jobs.clear();
      this.profile = profile;
    }
    const instances = this.instances(state);
    const desired = new Map(instances.map((instance) => [instance.id, JSON.stringify(instance)]));
    for (const [id, job] of this.jobs) {
      if (desired.get(id) !== job.key) {
        job.abort.abort();
        this.jobs.delete(id);
      }
    }
    for (const instance of instances) {
      let job = this.jobs.get(instance.id);
      if (!job) {
        job = {
          key: desired.get(instance.id)!,
          abort: new AbortController(),
          pending: false,
          nextAttempt: 0,
          failures: 0,
        };
        this.jobs.set(instance.id, job);
      }
      if (job.pending || job.nextAttempt > this.now()) continue;
      const snapshot = this.runtime.ambientSnapshot(instance);
      if (
        snapshot?.data &&
        snapshot.validUntil &&
        Date.parse(snapshot.validUntil) > this.now() &&
        (snapshot.status === 'ready' || snapshot.status === 'empty')
      )
        continue;
      const current = job;
      current.pending = true;
      void this.runtime
        .refreshAmbient(instance, current.abort.signal)
        .then((result) => {
          const success =
            (result.status === 'ready' || result.status === 'empty') &&
            Date.parse(result.validUntil ?? '') > this.now();
          current.failures = success ? 0 : current.failures + 1;
          current.nextAttempt = success ? Date.parse(result.validUntil!) : this.retryAt(current);
        })
        .catch(() => {
          current.failures += 1;
          current.nextAttempt = this.retryAt(current);
        })
        .finally(() => {
          current.pending = false;
          if (
            !this.disposed &&
            !current.abort.signal.aborted &&
            this.jobs.get(instance.id) === current
          )
            this.changed();
        });
    }
  }

  private retryAt(job: Job): number {
    return this.now() + Math.min(300_000, 30_000 * 2 ** Math.min(4, job.failures - 1));
  }

  dispose(): void {
    this.disposed = true;
    for (const job of this.jobs.values()) job.abort.abort();
    this.jobs.clear();
  }
}
