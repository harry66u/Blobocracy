import { describe, expect, test } from 'vitest';
import { MemoryStore, ResilientStore, type RunRow, type Store } from '../src/store';

/** A store whose every call fails while `down` is true (a Postgres outage). */
function flaky(inner: Store) {
  const state = { down: false, calls: 0 };
  const proxy = new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || prop === 'close') return v;
      return async (...args: unknown[]) => {
        state.calls++;
        if (state.down) throw new Error('connect ECONNREFUSED');
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { store: proxy as Store, state };
}
const run = (n: number): RunRow => ({
  levelId: 1, levelVersion: 1, run: n, startedAt: n, endedAt: n + 1, durationMs: 1, maxProgress: n / 100, maxX: n, zoneReached: 0, cause: 'pit', peakPlayers: 1, clipId: null,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ResilientStore (Postgres outage)', () => {
  test('writes queue while the database is down and flush in order when it returns', async () => {
    const mem = new MemoryStore();
    const { store, state } = flaky(mem);
    const logs: string[] = [];
    const s = new ResilientStore(store, { retryMinMs: 5, retryMaxMs: 20, log: (m) => logs.push(m) });
    await s.init();
    state.down = true;
    await s.recordRun(run(1)); // never throws
    await s.recordRun(run(2));
    await s.saveClip({ id: 'c1', levelId: 1, levelVersion: 1, run: 2, kind: 'record', createdAt: 0, progress: 0.02, cause: 'pit', deaths: 2, replay: new Uint8Array([9]), og: null });
    await s.attachClip(1, 2, 'c1');
    await s.saveWorld({ levelId: 1, deaths: 1, record: null, peakPlayers: 1 });
    await s.saveWorld({ levelId: 1, deaths: 2, record: { progress: 0.02, run: 2, version: 1 }, peakPlayers: 3 });
    await sleep(40);
    expect(s.status()).toMatchObject({ healthy: false, queued: 5 }); // the two world rows coalesced
    expect(logs.some((l) => l.includes('unreachable'))).toBe(true);
    // the clip is still servable while it waits
    expect((await s.getClip('c1'))?.replay).toEqual(new Uint8Array([9]));
    await expect(s.listRuns({ levelId: 1, page: 1, pageSize: 10, best: false })).rejects.toThrow();

    state.down = false;
    await s.drained();
    expect(s.status()).toMatchObject({ healthy: true, queued: 0 });
    const page = await mem.listRuns({ levelId: 1, page: 1, pageSize: 10, best: false });
    expect(page.runs.map((r) => [r.run, r.clipId])).toEqual([[2, 'c1'], [1, null]]);
    expect((await mem.loadWorld(1))?.deaths).toBe(2);
    expect((await mem.getClip('c1'))?.kind).toBe('record');
    expect(logs.some((l) => l.includes('back'))).toBe(true);
  });

  test('a database that is down at boot: init does not throw, writes land later', async () => {
    const mem = new MemoryStore();
    const { store, state } = flaky(mem);
    state.down = true;
    const s = new ResilientStore(store, { retryMinMs: 5, retryMaxMs: 10, log: () => {} });
    await s.init();
    await s.recordRun(run(3));
    await sleep(30);
    expect(s.status().healthy).toBe(false);
    state.down = false;
    await s.drained();
    expect((await mem.listRuns({ levelId: 1, page: 1, pageSize: 5, best: false })).total).toBe(1);
  });

  test('the queue is bounded', async () => {
    const { store, state } = flaky(new MemoryStore());
    state.down = true;
    const s = new ResilientStore(store, { retryMinMs: 1000, maxQueue: 3, log: () => {} });
    for (let i = 1; i <= 6; i++) await s.recordRun(run(i));
    expect(s.status()).toMatchObject({ queued: 3, dropped: 3 });
    await s.close();
  });
});
