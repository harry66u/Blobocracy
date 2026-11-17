import type { ClipRow, HallRow, LevelInfo, RunRow, Store, WorldRow } from './types';

interface Op { label: string; key?: string; run: () => Promise<void> }

export interface ResilientOptions {
  retryMinMs?: number;
  retryMaxMs?: number;
  /** Writes held while the database is away; past this the oldest are dropped (logged). */
  maxQueue?: number;
  log?: (msg: string) => void;
}

/**
 * Spec §10 "Postgres unreachable: gameplay continues". Every write goes into an in-memory
 * queue that is written in order; when a write fails the queue waits (exponential backoff)
 * and retries, so runs, clips and the world row land once the database is back. Nothing
 * here ever throws into the game loop. Reads pass through (and fail while it is down),
 * except clips still waiting in the queue, which are served from memory.
 */
export class ResilientStore implements Store {
  private queue: Op[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoff: number;
  private ready = false;
  private closed = false;
  private pendingClips = new Map<string, ClipRow>();
  private waiters: (() => void)[] = [];
  healthy = true;
  lastError: string | null = null;
  dropped = 0;

  constructor(readonly inner: Store, private o: ResilientOptions = {}) {
    this.backoff = o.retryMinMs ?? 1000;
  }

  private log(msg: string) { (this.o.log ?? console.log)(`[store] ${msg}`); }

  /** Tries the inner init (migrations) now; if the database is down, keeps retrying in the background. */
  async init(): Promise<void> {
    try {
      await this.inner.init();
      this.ready = true;
    } catch (e) {
      this.fail(e);
      this.schedule();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.inner.close().catch(() => {});
  }

  status() {
    return { healthy: this.healthy, queued: this.queue.length, dropped: this.dropped, lastError: this.lastError };
  }

  /** Resolves once every queued write has been written (tests, shutdown). */
  drained(): Promise<void> {
    if (this.queue.length === 0 && !this.flushing) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  private fail(e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (this.healthy) this.log(`database unreachable (${msg}); queueing writes`);
    this.healthy = false;
    this.lastError = msg;
  }

  private enqueue(op: Op): Promise<void> {
    if (op.key) {
      // a newer world row replaces a queued older one (the in-flight one is at index 0 while flushing)
      const i = this.queue.findIndex((q, idx) => q.key === op.key && !(this.flushing && idx === 0));
      if (i >= 0) { this.queue[i] = op; return Promise.resolve(); }
    }
    this.queue.push(op);
    const max = this.o.maxQueue ?? 50_000;
    while (this.queue.length > max) {
      const gone = this.queue.splice(this.flushing ? 1 : 0, 1)[0];
      this.dropped++;
      if (gone) this.log(`queue full: dropped ${gone.label}`);
    }
    if (this.healthy && !this.timer) void this.flush();
    return Promise.resolve();
  }

  private schedule() {
    if (this.closed || this.timer) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.o.retryMaxMs ?? 30_000);
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.closed) return;
    this.flushing = true;
    try {
      if (!this.ready) { await this.inner.init(); this.ready = true; }
      while (this.queue.length) {
        await this.queue[0]!.run();
        this.queue.shift();
        if (!this.healthy) {
          this.healthy = true;
          this.log(`database is back; ${this.queue.length} queued writes left`);
        }
        this.backoff = this.o.retryMinMs ?? 1000;
      }
      this.healthy = true;
    } catch (e) {
      this.fail(e);
      this.flushing = false;
      this.schedule();
      return;
    }
    this.flushing = false;
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  // ---- writes: queued ----------------------------------------------------------------------
  ensureLevel(l: LevelInfo) { return this.enqueue({ label: `level ${l.id} v${l.version}`, run: () => this.inner.ensureLevel(l) }); }
  saveWorld(w: WorldRow) { const c = structuredClone(w); return this.enqueue({ label: `world ${w.levelId}`, key: `world:${w.levelId}`, run: () => this.inner.saveWorld(c) }); }
  recordRun(r: RunRow) { const c = { ...r }; return this.enqueue({ label: `run ${r.levelId}/${r.run}`, run: () => this.inner.recordRun(c) }); }
  attachClip(levelId: number, run: number, clipId: string) {
    return this.enqueue({ label: `clip link ${levelId}/${run}`, run: () => this.inner.attachClip(levelId, run, clipId) });
  }
  saveClip(c: ClipRow) {
    this.pendingClips.set(c.id, c);
    return this.enqueue({
      label: `clip ${c.id}`,
      run: async () => { await this.inner.saveClip(c); this.pendingClips.delete(c.id); },
    });
  }
  addHallOfFame(h: HallRow) { return this.enqueue({ label: `hall ${h.levelId}`, run: () => this.inner.addHallOfFame(h) }); }

  // ---- reads: straight through ---------------------------------------------------------------
  async getClip(id: string) { return this.pendingClips.get(id) ?? this.inner.getClip(id); }
  levels() { return this.inner.levels(); }
  levelVersions(levelId: number) { return this.inner.levelVersions(levelId); }
  loadWorld(levelId: number) { return this.inner.loadWorld(levelId); }
  listRuns(q: Parameters<Store['listRuns']>[0]) { return this.inner.listRuns(q); }
  summary(levelId: number, maxPoints: number, zones: number) { return this.inner.summary(levelId, maxPoints, zones); }
  hallOfFame() { return this.inner.hallOfFame(); }
}
