import type { Redis } from 'ioredis';
import type { FlagReason } from './players';

/**
 * Abuse state shared by every relay (spec §9 Redis "per-IP connection counts, flags, bans").
 * Bans already come from the sim. Without Redis each relay keeps its own counts and flags
 * (LocalAbuseShare); with REDIS_URL the per-IP socket cap covers all relays together and a
 * flagged session stays flagged when it reconnects to another relay.
 */
export interface AbuseShare {
  /** Sockets other relays hold for this IP key (refreshed every couple of seconds). */
  remoteConns(ipk: string): number;
  flag(sid: string, reason: FlagReason): void;
  /** A flag another relay set for this session (null: none, or no Redis). */
  lookupFlag(sid: string): Promise<FlagReason | null>;
  /** Admin "reset flags": forget every shared flag. */
  resetFlags(): void;
  close(): void;
}

export class LocalAbuseShare implements AbuseShare {
  remoteConns(_ipk: string) { return 0; }
  flag(_sid: string, _reason: FlagReason) {}
  async lookupFlag(_sid: string): Promise<FlagReason | null> { return null; }
  resetFlags() {}
  close() {}
}

const REASONS: readonly FlagReason[] = ['rate', 'regular', 'identical'];
const FLAG_TTL_S = 3600;

/**
 * Each relay publishes its per-IP socket counts as a hash `abuse:conns:<relay>` (expiring, so a
 * relay that dies stops counting) and reads everyone else's. Flags are `abuse:flag:<gen>:<sid>`
 * for an hour; "reset flags" bumps `abuse:flaggen`, which retires them all at once.
 */
export class RedisAbuseShare implements AbuseShare {
  private remote = new Map<string, number>();
  private timer: ReturnType<typeof setInterval>;
  private gen = '0';

  constructor(private redis: Redis, private name: string, private local: () => Map<string, number>, everyMs = 2000) {
    this.timer = setInterval(() => { void this.sync().catch(() => { this.remote.clear(); }); }, everyMs);
    void this.sync().catch(() => {});
  }

  remoteConns(ipk: string): number { return this.remote.get(ipk) ?? 0; }

  async sync(): Promise<void> {
    const key = `abuse:conns:${this.name}`;
    const counts = this.local();
    const m = this.redis.multi().del(key);
    if (counts.size) m.hset(key, Object.fromEntries(counts));
    m.expire(key, 10).sadd('abuse:relays', this.name).get('abuse:flaggen');
    const res = await m.exec();
    this.gen = String(res?.at(-1)?.[1] ?? '0');
    const relays = (await this.redis.smembers('abuse:relays')).filter((r) => r !== this.name);
    const next = new Map<string, number>();
    for (const r of relays) {
      const h = await this.redis.hgetall(`abuse:conns:${r}`);
      if (!Object.keys(h).length) {
        if (!(await this.redis.exists(`abuse:conns:${r}`))) await this.redis.srem('abuse:relays', r);
        continue;
      }
      for (const [ipk, n] of Object.entries(h)) next.set(ipk, (next.get(ipk) ?? 0) + Number(n));
    }
    this.remote = next;
  }

  flag(sid: string, reason: FlagReason): void {
    void this.redis.set(`abuse:flag:${this.gen}:${sid}`, reason, 'EX', FLAG_TTL_S).catch(() => {});
  }

  async lookupFlag(sid: string): Promise<FlagReason | null> {
    try {
      const gen = (await this.redis.get('abuse:flaggen')) ?? '0';
      this.gen = gen;
      const v = await this.redis.get(`abuse:flag:${gen}:${sid}`);
      return REASONS.includes(v as FlagReason) ? v as FlagReason : null;
    } catch {
      return null;
    }
  }

  resetFlags(): void { void this.redis.incr('abuse:flaggen').catch(() => {}); }

  close(): void {
    clearInterval(this.timer);
    void this.redis.del(`abuse:conns:${this.name}`).catch(() => {});
  }
}
