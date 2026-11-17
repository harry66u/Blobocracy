import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { LEVEL1, levelHash, type VoteCounts } from '@blobocracy/shared';
import { FileLiveStore, LiveWriter, MemoryLiveStore, type LiveSnapshot, type LiveStore } from '../src/live';
import { startServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { World } from '../src/world';

const RIGHT: VoteCounts = { left: 0, right: 1, jump: 0, active: 1 };
const JUMPY: VoteCounts = { left: 0, right: 3, jump: 2, active: 3, fresh: 1 };

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv | null = null;
afterEach(async () => { await srv?.stop(); srv = null; });
const quiet = () => {};

describe('World snapshot', () => {
  test('a restored world carries on exactly where it was (JSON round trip)', () => {
    const a = new World(LEVEL1, { deaths: 41, record: { progress: 0.5, run: 12 } });
    for (let i = 0; i < 90; i++) a.step(i % 50 < 30 ? JUMPY : RIGHT);
    expect(a.phase).toBe('running');
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as ReturnType<World['snapshot']>;
    const b = new World(LEVEL1);
    b.restore(snap);
    expect(b.run).toBe(42);
    for (let i = 0; i < 600; i++) { a.step(i % 40 < 20 ? JUMPY : RIGHT); b.step(i % 40 < 20 ? JUMPY : RIGHT); }
    expect(b.body).toEqual(a.body);
    expect(b.tick).toBe(a.tick);
    expect([...b.dyn.crumbles]).toEqual([...a.dyn.crumbles]);
    expect(b.maxProgress).toBe(a.maxProgress);
    expect(b.deaths).toBe(a.deaths);
  });

  test('a run caught in its death hold resumes as the next run (the death already counted)', () => {
    const a = new World(LEVEL1, { deaths: 3, record: null });
    const s = { ...a.snapshot(), phase: 'dying' as const, run: 4, deaths: 4, maxProgress: 0.2 };
    const b = new World(LEVEL1);
    b.restore(s);
    expect(b).toMatchObject({ run: 5, deaths: 4, phase: 'running', maxProgress: 0, runTick: 0 });
  });
});

describe('live stores', () => {
  test('file store round-trips atomically; missing or junk files load as null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blob-live-'));
    const f = new FileLiveStore(join(dir, 'sub', 'live.json'));
    expect(await f.load()).toBeNull();
    const snap = { v: 1, levelId: 1, version: 1, world: new World(LEVEL1).snapshot(), recordVersion: null, runStartedAt: 5, runPeak: 2, runMaxX: 4, peakPlayers: 9, bans: [], savedAt: 1 } satisfies LiveSnapshot;
    await f.save(snap);
    expect(await f.load()).toEqual(snap);
  });

  test('the writer never overlaps writes and keeps only the newest pending one', async () => {
    const saved: number[] = [];
    let release: (() => void) | null = null;
    const slow: LiveStore = {
      load: async () => null, close: async () => {},
      save: (s) => new Promise<void>((r) => { saved.push(s.savedAt); release = r; }),
    };
    const w = new LiveWriter(slow, quiet);
    const snap = (n: number) => ({ savedAt: n } as LiveSnapshot);
    w.save(snap(1)); w.save(snap(2)); w.save(snap(3));
    expect(saved).toEqual([1]);
    release!();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toEqual([1, 3]);
    release!();
    await w.flush();
  });

  test('a failing store is logged once and never throws', async () => {
    const logs: string[] = [];
    const w = new LiveWriter({ load: async () => null, close: async () => {}, save: async () => { throw new Error('redis down'); } }, (m) => logs.push(m));
    w.save({ savedAt: 1 } as LiveSnapshot);
    w.save({ savedAt: 2 } as LiveSnapshot);
    await w.flush();
    w.save({ savedAt: 3 } as LiveSnapshot);
    await w.flush();
    expect(logs.filter((l) => l.includes('failed'))).toHaveLength(1);
  });
});

describe('crash recovery (spec §10)', () => {
  test('a restarted sim resumes the run in progress from the snapshot: not a death', async () => {
    const live = new MemoryLiveStore();
    const store = new MemoryStore();
    srv = await startServer({ port: null, virtualPlayers: 0, live, store, log: quiet });
    // play a bit of a run directly on the world
    for (let i = 0; i < 60; i++) srv.world.step(RIGHT);
    expect(srv.world.phase).toBe('running');
    srv.world.deaths = 17; srv.world.run = 18; srv.world.record = { progress: 0.31, run: 9 };
    const before = srv.world.snapshot();
    await srv.snapshotNow();
    await srv.stop();
    srv = await startServer({ port: null, virtualPlayers: 0, live, store, log: quiet });
    expect(srv.world.run).toBe(18);
    expect(srv.world.deaths).toBe(17);
    expect(srv.world.record).toEqual({ progress: 0.31, run: 9 });
    // the paused world (nobody connected) did not move between the snapshot and now
    expect(srv.world.body.x).toBeCloseTo(before.body.x, 6);
    expect(srv.world.maxProgress).toBeCloseTo(before.maxProgress, 9);
  });

  test('without a snapshot the counters come from the database world row', async () => {
    const store = new MemoryStore();
    await store.ensureLevel({ id: 1, name: 'Level 1', version: 1, geometryHash: levelHash(LEVEL1) });
    await store.saveWorld({ levelId: 1, deaths: 4811, record: { progress: 0.83, run: 3940, version: 1 }, peakPlayers: 12408 });
    srv = await startServer({ port: null, virtualPlayers: 0, store, log: quiet });
    expect(srv.world).toMatchObject({ deaths: 4811, run: 4812, record: { progress: 0.83, run: 3940 } });
    expect(srv.history.peakPlayers).toBe(12408);
  });

  test('booted with the database down and no snapshot: its counters are carried forward when it returns', async () => {
    const mem = new MemoryStore();
    await mem.saveWorld({ levelId: 1, deaths: 4811, record: { progress: 0.83, run: 3940, version: 1 }, peakPlayers: 9 });
    let down = true;
    const flaky = new Proxy(mem, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' && k !== 'close' ? async (...a: unknown[]) => { if (down) throw new Error('ECONNREFUSED'); return (v as (...x: unknown[]) => unknown).apply(t, a); } : v;
      },
    });
    const { ResilientStore } = await import('../src/store');
    srv = await startServer({ port: null, virtualPlayers: 0, store: new ResilientStore(flaky, { retryMinMs: 10, log: quiet }), log: quiet, worldRetryMs: 20 });
    expect(srv.world.run).toBe(1);
    srv.world.deaths = 2; srv.world.run = 3; // two deaths during the outage
    down = false;
    await new Promise((r) => setTimeout(r, 120));
    expect(srv.world).toMatchObject({ deaths: 4813, run: 4814, record: { progress: 0.83, run: 3940 } });
  });

  test('a snapshot older than the database (deaths behind) is ignored', async () => {
    const live = new MemoryLiveStore();
    const old = new World(LEVEL1, { deaths: 3, record: null });
    await live.save({ v: 1, levelId: 1, version: 1, world: old.snapshot(), recordVersion: null, runStartedAt: 0, runPeak: 0, runMaxX: 0, peakPlayers: 0, bans: ['203.0.113.0/24'], savedAt: 0 });
    const store = new MemoryStore();
    await store.saveWorld({ levelId: 1, deaths: 10, record: null, peakPlayers: 0 });
    srv = await startServer({ port: null, virtualPlayers: 0, store, live, log: quiet });
    expect(srv.world.run).toBe(11);
  });
});

describe('a restart while a clip was being made (M6)', () => {
  test('the announced clip is marked lost: its link says so instead of 404 forever', async () => {
    const live = new MemoryLiveStore();
    const store = new MemoryStore();
    const w = new World(LEVEL1, { deaths: 3, record: null });
    const snap: LiveSnapshot = {
      v: 1, levelId: 1, version: LEVEL1.version, world: { ...w.snapshot(), phase: 'dying', run: 4, deaths: 4, maxProgress: 0.3 },
      recordVersion: 1, runStartedAt: 5, runPeak: 2, runMaxX: 4, peakPlayers: 9, bans: [], savedAt: 1,
      pendingClip: { id: 'Lost_1', kind: 'record', run: 4, progress: 0.3, cause: 'pit', deaths: 4 },
    };
    await live.save(snap);
    srv = await startServer({ port: null, virtualPlayers: 0, store, live, log: quiet });
    await srv.store.drained();
    const r = await srv.api('/api/clips/Lost_1', '');
    expect(r.status).toBe(410);
    expect(JSON.parse(String(r.body))).toMatchObject({ lost: true });
    expect((await srv.api('/api/clips/Lost_1/meta', '')).status).toBe(410);
    expect((await srv.api('/api/clips/Nope_1', '')).status).toBe(404);
  });
});
