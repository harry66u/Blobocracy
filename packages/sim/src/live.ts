import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Redis } from 'ioredis';
import type { WorldSnapshot } from './world';

/**
 * The live snapshot (spec §9 Redis `live:snapshot`): current level and version, the run in
 * progress (run number, run tick, body, dynamics incl. crumbles and the Big Chomp), death
 * count and record. Written every 2 s and on every event; on boot the sim resumes from it.
 */
export interface LiveSnapshot {
  v: 1;
  levelId: number;
  version: number;
  world: WorldSnapshot;
  /** Level version the record was set on. */
  recordVersion: number | null;
  /** Bookkeeping for the run row (epoch ms; peak players during the run; furthest x). */
  runStartedAt: number;
  runPeak: number;
  runMaxX: number;
  /** Most players online at once, ever. */
  peakPlayers: number;
  /** Banned IPs/CIDRs (admin), so a restart does not unban anyone. */
  bans: string[];
  savedAt: number;
}

export interface LiveStore {
  load(): Promise<LiveSnapshot | null>;
  save(s: LiveSnapshot): Promise<void>;
  close(): Promise<void>;
}

export const LIVE_KEY = 'live:snapshot';

const valid = (s: unknown): s is LiveSnapshot =>
  typeof s === 'object' && s !== null && (s as LiveSnapshot).v === 1 && typeof (s as LiveSnapshot).world?.run === 'number';

export class MemoryLiveStore implements LiveStore {
  private s: string | null = null;
  async load() { return this.s ? JSON.parse(this.s) as LiveSnapshot : null; }
  async save(s: LiveSnapshot) { this.s = JSON.stringify(s); }
  async close() {}
}

/** JSON on disk (e.g. the sim's Fly volume), written atomically. Used when REDIS_URL is unset and LIVE_STATE_FILE is set. */
export class FileLiveStore implements LiveStore {
  constructor(private path: string) {}
  async load(): Promise<LiveSnapshot | null> {
    try {
      const s: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      return valid(s) ? s : null;
    } catch {
      return null;
    }
  }
  async save(s: LiveSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, this.path);
  }
  async close() {}
}

export class RedisLiveStore implements LiveStore {
  constructor(private redis: Redis, private key = LIVE_KEY) {}
  async load(): Promise<LiveSnapshot | null> {
    const text = await this.redis.get(this.key);
    if (!text) return null;
    try {
      const s: unknown = JSON.parse(text);
      return valid(s) ? s : null;
    } catch {
      return null;
    }
  }
  async save(s: LiveSnapshot): Promise<void> { await this.redis.set(this.key, JSON.stringify(s)); }
  async close() {}
}

/**
 * Saves snapshots without ever blocking or throwing into the game loop: one write at a
 * time, and while one is in flight only the newest snapshot waits for its turn.
 */
export class LiveWriter {
  private inFlight: Promise<void> | null = null;
  private next: LiveSnapshot | null = null;
  private failing = false;
  writes = 0;

  constructor(private store: LiveStore, private log: (m: string) => void = console.log) {}

  save(s: LiveSnapshot): void {
    this.next = s;
    if (!this.inFlight) this.inFlight = this.pump();
  }

  private async pump(): Promise<void> {
    while (this.next) {
      const s = this.next;
      this.next = null;
      try {
        await this.store.save(s);
        this.writes++;
        if (this.failing) { this.failing = false; this.log('[live] snapshot store is back'); }
      } catch (e) {
        if (!this.failing) this.log(`[live] snapshot save failed: ${e instanceof Error ? e.message : String(e)}`);
        this.failing = true;
      }
    }
    this.inFlight = null;
  }

  /** Resolves when the newest snapshot has been written (or failed). */
  async flush(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }
}

/** A Redis client that fails fast instead of queueing forever when Redis is away. */
export async function connectRedis(url: string, name: string): Promise<Redis> {
  const { Redis: Ctor } = await import('ioredis');
  const r = new Ctor(url, { connectionName: name, maxRetriesPerRequest: 2, connectTimeout: 3000, enableAutoPipelining: true });
  let warned = false;
  r.on('error', (e: Error) => { if (!warned) { warned = true; console.warn(`[redis] ${e.message}`); } });
  r.on('ready', () => { warned = false; });
  return r;
}

/** Rejects after `ms` (so a dead store can't hold up boot). */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });
}
