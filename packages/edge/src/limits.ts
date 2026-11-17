/**
 * Per-connection abuse checks (spec §8), all O(1) per input change.
 */

/** At most `perSecond` input changes in any 1 s window. Sustained excess flags the sender. */
export class RateLimiter {
  /** Input changes dropped so far. */
  dropped = 0;
  flagged = false;
  private times: number[] = [];
  private head = 0;
  private strikes: number[] = [];

  constructor(private perSecond: number, private strikesToFlag = 3, private strikeWindowMs = 10_000) {}

  allow(nowMs: number): boolean {
    if (this.times.length < this.perSecond) { this.times.push(nowMs); return true; }
    const oldest = this.times[this.head]!;
    if (nowMs - oldest >= 1000) {
      this.times[this.head] = nowMs;
      this.head = (this.head + 1) % this.perSecond;
      return true;
    }
    this.dropped++;
    const sec = Math.floor(nowMs / 1000);
    if (this.strikes.at(-1) !== sec) {
      this.strikes.push(sec);
      this.strikes = this.strikes.filter((s) => (sec - s) * 1000 < this.strikeWindowMs);
      if (this.strikes.length >= this.strikesToFlag) this.flagged = true;
    }
    return false;
  }
}

/**
 * Inhumanly regular timing. People's key timing jitters by tens of milliseconds; a script on a
 * timer repeats its intervals to within a millisecond or two. Looks at the last `window` gaps
 * between input changes and flags when every gap matches the one 1, 2 or 3 changes earlier
 * (a metronome, or a press/release rhythm) within `toleranceMs`.
 */
export class TimingMonitor {
  private last = NaN;
  private gaps: number[] = [];

  constructor(private window = 8, private toleranceMs = 3, private maxGapMs = 5000) {}

  /** Records an input change; true when the recent rhythm is machine-regular. */
  record(nowMs: number): boolean {
    const gap = nowMs - this.last;
    this.last = nowMs;
    if (!Number.isFinite(gap)) return false;
    if (gap > this.maxGapMs) { this.gaps = []; return false; }
    this.gaps.push(gap);
    if (this.gaps.length > this.window + 3) this.gaps.shift();
    if (this.gaps.length < this.window + 3) return false;
    for (const lag of [1, 2, 3]) {
      let worst = 0;
      for (let i = this.gaps.length - this.window; i < this.gaps.length; i++) {
        worst = Math.max(worst, Math.abs(this.gaps[i]! - this.gaps[i - lag]!));
      }
      if (worst <= this.toleranceMs) return true;
    }
    return false;
  }
}

/**
 * Many sockets producing the same input stream (one script driving a farm). Each socket's last
 * `minChanges` changes (bits plus the `binMs` slot they happened in) form a fingerprint; when
 * `minGroup` sockets share one, they are all flagged. People reacting to the same moment still
 * spread over a few hundred ms, so even thousands of them never line up to the same 25 ms over
 * twelve changes in a row, while one script's sockets arrive within a millisecond or two of each
 * other. (Looser settings, 6 changes in 100 ms slots, flagged 0.7% of 3,500 well-behaved bots in
 * the load test: a busy event loop handles many sockets' messages in one batch.)
 */
export class IdenticalStreams {
  private readonly minGroup: number;
  private readonly minChanges: number;
  private readonly binMs: number;
  private streams = new Map<number, string[]>();
  private fpOf = new Map<number, string>();
  private groups = new Map<string, Set<number>>();

  constructor(o: { minGroup?: number; minChanges?: number; binMs?: number } = {}) {
    this.minGroup = o.minGroup ?? 8;
    this.minChanges = o.minChanges ?? 12;
    this.binMs = o.binMs ?? 25;
  }

  /** Records a change; returns the sockets to flag now (empty almost always). */
  observe(id: number, bits: number, nowMs: number): number[] {
    let s = this.streams.get(id);
    if (!s) { s = []; this.streams.set(id, s); }
    s.push(`${bits}@${Math.floor(nowMs / this.binMs)}`);
    if (s.length > this.minChanges) s.shift();
    this.unlink(id);
    if (s.length < this.minChanges) return [];
    const fp = s.join(',');
    let g = this.groups.get(fp);
    if (!g) { g = new Set(); this.groups.set(fp, g); }
    g.add(id);
    this.fpOf.set(id, fp);
    return g.size >= this.minGroup ? [...g] : [];
  }

  forget(id: number): void {
    this.unlink(id);
    this.streams.delete(id);
  }

  private unlink(id: number): void {
    const fp = this.fpOf.get(id);
    if (fp === undefined) return;
    const g = this.groups.get(fp);
    g?.delete(id);
    if (g && g.size === 0) this.groups.delete(fp);
    this.fpOf.delete(id);
  }
}
