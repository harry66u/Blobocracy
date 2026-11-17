import type { Tier } from '@blobocracy/shared';

/**
 * Which state frames go out (spec §10, graceful degradation). Players subscribe to the `play`
 * topic, watchers to `watch`. Normally players get every frame and watchers every other one;
 * on an overloaded relay players get every other frame and watchers every fourth. Slow sockets
 * additionally skip frames on their own through uWS backpressure.
 */
export class FrameGate {
  private n = 0;

  next(degraded: boolean): { play: boolean; watch: boolean } {
    const n = this.n++;
    return { play: !degraded || n % 2 === 0, watch: n % (degraded ? 4 : 2) === 0 };
  }
}

export interface LoadThresholds {
  /** Process CPU (fraction of one core) that degrades the relay, and the level it must fall under to recover. */
  cpuHigh: number; cpuLow: number;
  /** Share of sampled sockets with backed-up send buffers that degrades / recovers. */
  bpHigh: number; bpLow: number;
  /** How long it must stay calm before full rate returns. */
  calmMs: number;
}

export const DEFAULT_LOAD: LoadThresholds = { cpuHigh: 0.85, cpuLow: 0.6, bpHigh: 0.2, bpLow: 0.05, calmMs: 3000 };

/** Relay overload detector with hysteresis, so the frame rate does not flap. */
export class LoadMonitor {
  degraded = false;
  private calmSince = -1;

  constructor(private t: LoadThresholds = DEFAULT_LOAD) {}

  sample(cpu: number, backpressure: number, nowMs: number): boolean {
    if (cpu >= this.t.cpuHigh || backpressure >= this.t.bpHigh) {
      this.degraded = true;
      this.calmSince = -1;
    } else if (this.degraded) {
      if (cpu < this.t.cpuLow && backpressure < this.t.bpLow) {
        if (this.calmSince < 0) this.calmSince = nowMs;
        if (nowMs - this.calmSince >= this.t.calmMs) this.degraded = false;
      } else {
        this.calmSince = -1;
      }
    }
    return this.degraded;
  }
}

export interface AdmitPolicy { tier: Tier; alwaysOn: boolean; capacity: number }

/**
 * What a new visitor becomes on this relay (spec §10). `connections` is this relay's current count.
 * - below 90%: a player;
 * - 90%: beyond the always-on relays' capacity, a watcher (lower frame rate, inputs still count);
 * - 100%: capacity is held at the always-on relays; anyone beyond it sees the packed page.
 */
export function admit(p: AdmitPolicy, connections: number): 'player' | 'watcher' | 'packed' {
  if (p.tier < 90) return 'player';
  const within = p.alwaysOn && connections < p.capacity;
  if (within) return 'player';
  return p.tier >= 100 ? 'packed' : 'watcher';
}
