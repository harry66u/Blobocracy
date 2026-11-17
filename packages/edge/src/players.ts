import { ACTIVE_WINDOW_S, BLEND, IN_JUMP, IN_LEFT, IN_RIGHT, type RelaySummary, type SampleEntry } from '@blobocracy/shared';
import { ipKey } from './ip';
import { IdenticalStreams, RateLimiter, TimingMonitor } from './limits';

export type FlagReason = 'rate' | 'regular' | 'identical';

export interface CrowdOptions {
  /** All connections from one IP together weigh at most this many votes (§8, default 4). */
  ipVoteCap: number;
  /** Input changes per second per connection (§8, default 20). */
  rateLimit: number;
  /** How many players this relay samples for the crowd dots (the sim may change it). */
  sampleQuota: number;
  /** A sampled player gives its dot to a waiting one after this long (when others are waiting). */
  rotateMs?: number;
  identical?: { minGroup?: number; minChanges?: number };
}

interface Player {
  id: number;
  ipk: string;
  sid: string | undefined;
  watcher: boolean;
  bits: number;
  changedAt: number;
  jumpAt: number;
  everPressed: boolean;
  /** Latest state held back by the rate limit, applied once allowed (-1: none). */
  pending: number;
  rate: RateLimiter;
  timing: TimingMonitor;
  flag: FlagReason | null;
  sampleId: number;
}

const ACTIVE_MS = ACTIVE_WINDOW_S * 1000;
const FRESH_MS = BLEND.freshS * 1000;
/** Shadow-ban memory per session id, so reconnecting does not wash a flag off. */
const FLAG_MEMORY_MS = 3600_000;

/**
 * Everyone connected to one relay: their inputs, abuse weighting (§8), and the summary the
 * relay sends the sim each tick. Flagged players keep their socket and keep seeing the game,
 * but weigh 0 and never appear as a crowd dot (shadow-ignored).
 */
export class EdgeCrowd {
  private players = new Map<number, Player>();
  /** Sampled players in the order they got their dot (oldest first). */
  private sampled = new Map<number, Player>();
  private sampleIds = new Set<number>();
  /** Eligible players waiting for a dot, first come first served. */
  private waiting = new Set<number>();
  private lastRotate = -Infinity;
  private flagsBySid = new Map<string, { reason: FlagReason; at: number }>();
  private identical: IdenticalStreams;
  private ipActive = new Map<string, number>();
  private oldestInput = 0;
  private quota: number;
  private counters = { rateLimitedInputs: 0, influenceCappedIps: 0, flagged: { rate: 0, regular: 0, identical: 0 } };

  constructor(private o: CrowdOptions) {
    this.quota = o.sampleQuota;
    this.identical = new IdenticalStreams(o.identical);
  }

  add(id: number, ip: string, sid?: string, watcher = false): void {
    const p: Player = {
      id, ipk: ipKey(ip), sid, watcher, bits: 0, changedAt: -Infinity, jumpAt: -Infinity, everPressed: false,
      pending: -1, rate: new RateLimiter(this.o.rateLimit), timing: new TimingMonitor(), flag: null, sampleId: -1,
    };
    const remembered = sid ? this.flagsBySid.get(sid) : undefined;
    if (remembered && Date.now() - remembered.at < FLAG_MEMORY_MS) p.flag = remembered.reason;
    this.players.set(id, p);
    if (!p.flag) this.waiting.add(id);
  }

  remove(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.unsample(p);
    this.waiting.delete(id);
    this.identical.forget(id);
    this.players.delete(id);
  }

  has(id: number): boolean {
    return this.players.has(id);
  }

  /** A player's input changed to `bits` at `nowMs`. */
  input(id: number, bits: number, nowMs: number): void {
    const p = this.players.get(id);
    if (!p) return;
    bits &= 7;
    if (bits === (p.pending >= 0 ? p.pending : p.bits)) return;
    if (!p.rate.allow(nowMs)) {
      this.counters.rateLimitedInputs++;
      p.pending = bits;
      if (p.rate.flagged) this.flag(id, 'rate');
      return;
    }
    p.pending = -1;
    this.apply(p, bits, nowMs);
    if (p.timing.record(nowMs)) this.flag(id, 'regular');
    for (const other of this.identical.observe(id, bits, nowMs)) this.flag(other, 'identical');
  }

  private apply(p: Player, bits: number, nowMs: number): void {
    if (bits === p.bits) return;
    if (bits & IN_JUMP && !(p.bits & IN_JUMP)) p.jumpAt = nowMs;
    p.bits = bits;
    p.changedAt = nowMs;
    if (bits) p.everPressed = true;
    if (!this.oldestInput || nowMs < this.oldestInput) this.oldestInput = nowMs;
  }

  /** Shadow-ignore a player (weight 0). Remembered by session id for an hour. */
  flag(id: number, reason: FlagReason): void {
    const p = this.players.get(id);
    if (!p || p.flag) return;
    p.flag = reason;
    this.counters.flagged[reason]++;
    if (p.sid) this.flagsBySid.set(p.sid, { reason, at: Date.now() });
    this.unsample(p);
    this.waiting.delete(id);
  }

  isFlagged(id: number): boolean {
    return !!this.players.get(id)?.flag;
  }

  /** Admin: clear every flag (an incident turned out to be a false alarm). */
  resetFlags(): void {
    this.flagsBySid.clear();
    for (const p of this.players.values()) {
      if (!p.flag) continue;
      p.flag = null;
      p.rate = new RateLimiter(this.o.rateLimit);
      p.timing = new TimingMonitor();
      this.waiting.add(p.id);
    }
  }

  setSampleQuota(n: number): void {
    this.quota = Math.max(0, Math.min(128, Math.floor(n)));
  }

  /** The tick's summary for the sim (without seq and byte counters, which the link adds). */
  summarize(nowMs: number): Omit<RelaySummary, 'seq' | 'bytesSent'> {
    const ipActive = this.ipActive;
    ipActive.clear();
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0];
    let watchers = 0;
    for (const p of this.players.values()) {
      if (p.watcher) watchers++;
      if (p.pending >= 0 && p.rate.allow(nowMs)) { this.apply(p, p.pending, nowMs); p.pending = -1; }
      if (!this.isActive(p, nowMs)) continue;
      buckets[p.bits]!++;
      if (!p.flag) ipActive.set(p.ipk, (ipActive.get(p.ipk) ?? 0) + 1);
    }
    let left = 0, right = 0, jump = 0, active = 0, fresh = 0, capped = 0;
    for (const n of ipActive.values()) if (n > this.o.ipVoteCap) capped++;
    for (const p of this.players.values()) {
      if (p.flag || !this.isActive(p, nowMs)) continue;
      const w = Math.min(1, this.o.ipVoteCap / ipActive.get(p.ipk)!);
      active += w;
      const l = p.bits & IN_LEFT, r = p.bits & IN_RIGHT;
      if (l && !r) left += w;
      else if (r && !l) right += w;
      if (p.bits & IN_JUMP) {
        jump += w;
        if (nowMs - p.jumpAt <= FRESH_MS) fresh += w;
      }
    }
    this.counters.influenceCappedIps = capped;
    const oldestInputAt = this.oldestInput;
    this.oldestInput = 0;
    return {
      weighted: { left, right, jump, active, fresh },
      buckets,
      connections: this.players.size,
      watchers,
      oldestInputAt,
      sample: this.sample(nowMs),
    };
  }

  stats() {
    let flaggedNow = 0;
    for (const p of this.players.values()) if (p.flag) flaggedNow++;
    return {
      connections: this.players.size,
      flaggedNow,
      rateLimitedInputs: this.counters.rateLimitedInputs,
      influenceCappedIps: this.counters.influenceCappedIps,
      flagged: { ...this.counters.flagged },
    };
  }

  private isActive(p: Player, nowMs: number): boolean {
    return p.everPressed && (p.bits !== 0 || nowMs - p.changedAt <= ACTIVE_MS);
  }

  private sample(nowMs: number): SampleEntry[] {
    while (this.sampled.size > this.quota) this.evictOldest();
    const rotateMs = this.o.rotateMs ?? 2000;
    if (this.lastRotate === -Infinity) this.lastRotate = nowMs;
    if (this.waiting.size > 0 && this.sampled.size >= this.quota && this.quota > 0 && nowMs - this.lastRotate >= rotateMs) {
      this.lastRotate = nowMs;
      this.evictOldest();
    }
    for (const id of this.waiting) {
      if (this.sampled.size >= this.quota) break;
      const p = this.players.get(id)!;
      this.waiting.delete(id);
      let sid = p.id & 0xffff;
      while (this.sampleIds.has(sid)) sid = (sid + 1) & 0xffff;
      p.sampleId = sid;
      this.sampleIds.add(sid);
      this.sampled.set(id, p);
    }
    const out: SampleEntry[] = [];
    for (const p of this.sampled.values()) out.push({ id: p.sampleId, bits: p.bits });
    return out;
  }

  private evictOldest(): void {
    const first = this.sampled.values().next().value as Player | undefined;
    if (!first) return;
    this.unsample(first);
    this.waiting.add(first.id); // back of the queue
  }

  private unsample(p: Player): void {
    if (p.sampleId < 0) return;
    this.sampled.delete(p.id);
    this.sampleIds.delete(p.sampleId);
    p.sampleId = -1;
  }
}
