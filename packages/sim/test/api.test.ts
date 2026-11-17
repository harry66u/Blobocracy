import { afterEach, describe, expect, test } from 'vitest';
import { LEVEL1 } from '@blobocracy/shared';
import { clipTitle, createApi, intParam } from '../src/api';
import { History } from '../src/history';
import { startServer } from '../src/server';
import { MemoryStore, type Store } from '../src/store';
import { fakeRuns, hazardSpots, seedDemoRuns } from '../src/store/seed';

const NOW = Date.UTC(2026, 10, 17, 12);
const counter = () => ({ deaths: 2000, run: 2001, record: { progress: 0.8, run: 1900 }, online: 42 });

async function seeded(opts: { beaten?: boolean } = {}) {
  const store = new MemoryStore();
  await seedDemoRuns(store, { runs: 300, level: LEVEL1, now: NOW, clipReplay: new Uint8Array([66, 76, 82, 80]), beaten: opts.beaten });
  return store;
}
const body = (r: { body: string | Uint8Array }) => JSON.parse(String(r.body));

describe('API', () => {
  test('runs: newest first, 25 a page, best filter, clamped params', async () => {
    const api = createApi({ store: await seeded(), level: LEVEL1, levelName: 'Level 1', counter });
    const r1 = await api('/api/runs', '');
    expect(r1.status).toBe(200);
    expect(r1.cache).toContain('max-age');
    const p1 = body(r1);
    expect(p1).toMatchObject({ page: 1, pages: 12, total: 300, pageSize: 25, best: false });
    expect(p1.runs).toHaveLength(25);
    expect(p1.runs[0].run).toBe(300);
    expect(Object.keys(p1.runs[0]).sort()).toEqual(['cause', 'clipId', 'durationMs', 'endedAt', 'peakPlayers', 'progress', 'run', 'startedAt', 'version', 'zone']);
    const last = body(await api('/api/runs', 'page=12'));
    expect(last.runs).toHaveLength(0 + 300 - 11 * 25);
    const best = body(await api('/api/runs', 'best=1&page=1'));
    const ps = best.runs.map((r: { progress: number }) => r.progress);
    expect(ps).toEqual([...ps].sort((a: number, b: number) => b - a));
    expect(best.runs.some((r: { clipId: string | null }) => r.clipId)).toBe(true); // the best runs set records → clips
    expect(body(await api('/api/runs', 'page=-4&size=9999'))).toMatchObject({ page: 1, pageSize: 100 });
    expect(body(await api('/api/runs', 'page=abc'))).toMatchObject({ page: 1 });
  });

  test('summary: counters, zones, chart series and record steps', async () => {
    const api = createApi({ store: await seeded(), level: LEVEL1, levelName: 'Level 1', counter, maxPoints: 100 });
    const s = body(await api('/api/summary', ''));
    expect(s).toMatchObject({ levelId: 1, levelName: 'Level 1', deaths: 2000, online: 42, attempts: 300, bucket: 3 });
    expect(s.zones).toHaveLength(6);
    expect(s.zones[0]).toMatchObject({ index: 0, name: 'Welcome Mat', sky: 'blue', start: 0 });
    expect(s.zoneReach[0]).toBe(300);
    expect(s.series).toHaveLength(100);
    expect(s.records.length).toBeGreaterThan(3);
    // the internet gets better: later runs get further on average
    const avg = (a: number[][]) => a.reduce((t, p) => t + p[1]!, 0) / a.length;
    expect(avg(s.series.slice(-30))).toBeGreaterThan(avg(s.series.slice(0, 30)));
  });

  test('hall: empty state carries the current level and its deaths; a beaten level shows', async () => {
    const empty = body(await createApi({ store: await seeded(), level: LEVEL1, levelName: 'Level 1', counter })('/api/hall', ''));
    expect(empty).toEqual({
      entries: [], current: { levelId: 1, name: 'Level 1', deaths: 2000, record: { progress: 0.8, run: 1900 }, encore: false },
      next: null, comingSoon: false,
    });
    const won = body(await createApi({ store: await seeded({ beaten: true }), level: LEVEL1, levelName: 'Level 1', counter })('/api/hall', ''));
    expect(won.entries).toHaveLength(1);
    expect(won.entries[0]).toMatchObject({ levelId: 1, track: 1, encore: false, levelName: 'Level 1', deathCount: 299, run: 300 });
    expect(won.comingSoon).toBe(true); // level 1 is the only level here: a new one is coming
    expect(won.entries[0].clipId).toMatch(/^demo/);
  });

  test('clips: bytes with a long cache, meta for previews, og image, 404s', async () => {
    const store = await seeded();
    await store.saveClip({ id: 'abcDEF12', levelId: 1, levelVersion: 1, run: 4812, kind: 'near_miss', createdAt: NOW, progress: 0.78, cause: 'press', deaths: 4812, replay: new Uint8Array([1, 2, 3]), og: new Uint8Array([137, 80]) });
    const api = createApi({ store, level: LEVEL1, levelName: 'Level 1', counter });
    const bin = await api('/api/clips/abcDEF12', '');
    expect(bin).toMatchObject({ status: 200, type: 'application/octet-stream', cache: 'public, max-age=31536000, immutable' });
    expect([...(bin.body as Uint8Array)]).toEqual([1, 2, 3]);
    const meta = body(await api('/api/clips/abcDEF12/meta', ''));
    expect(meta).toMatchObject({ id: 'abcDEF12', run: 4812, kind: 'near_miss', progress: 0.78, hasOg: true, title: 'So close. Run 4,812 made it 78%…' });
    expect(meta.description).toMatch(/^Run 4,812 made it 78% of the way, then the Big Press/);
    expect(meta.replay).toBeUndefined();
    expect((await api('/api/clips/abcDEF12/og.png', '')).type).toBe('image/png');
    expect((await api('/api/clips/nope', '')).status).toBe(404);
    expect((await api('/api/clips/bad%20id', '')).status).toBe(404);
    expect((await api('/api/clips/../../etc', '')).status).toBe(404);
    expect((await api('/api/what', '')).status).toBe(404);
  });

  test('a clip still being made is waited for', async () => {
    const store = new MemoryStore();
    const history = new History({ store, level: LEVEL1, log: () => {} });
    let resolve!: (v: unknown) => void;
    (history as unknown as { making: Map<string, Promise<unknown>> }).making.set('soon1', new Promise((r) => { resolve = r; }));
    const api = createApi({ store, level: LEVEL1, levelName: 'Level 1', counter, history });
    const res = api('/api/clips/soon1', '');
    const row = { id: 'soon1', levelId: 1, levelVersion: 1, run: 2, kind: 'record', createdAt: 0, progress: 0.2, cause: 'pit', deaths: 2, replay: new Uint8Array([7]), og: null };
    setTimeout(() => resolve(row), 20);
    expect((await res).status).toBe(200);
  });

  test('a broken store answers 503, never throws', async () => {
    const broken = new Proxy(new MemoryStore(), { get: () => async () => { throw new Error('db down'); } }) as unknown as Store;
    const api = createApi({ store: broken, level: LEVEL1, levelName: 'Level 1', counter });
    const r = await api('/api/runs', '');
    expect(r.status).toBe(503);
    expect(body(r).error).toMatch(/catching its breath/);
  });

  test('helpers', () => {
    expect(intParam('7', 1, 1, 10)).toBe(7);
    expect(intParam('70', 1, 1, 10)).toBe(10);
    expect(intParam('2.5', 1, 1, 10)).toBe(1);
    expect(intParam(null, 3, 1, 10)).toBe(3);
    expect(clipTitle({ kind: 'record', run: 3940, progress: 0.834 })).toBe('New record! Run 3,940 made it 83%…');
    expect(clipTitle({ kind: 'win', run: 9000, progress: 1 })).toBe('Run 9,000 beat Blobocracy!');
  });
});

describe('seed data', () => {
  test('deaths happen at real hazards, every cause shows up, progress grows', () => {
    const spots = hazardSpots(LEVEL1);
    expect(new Set(spots.map((s) => s.cause))).toEqual(new Set(['spikes', 'ceiling spikes', 'pit', 'press', 'saw', 'chomp']));
    const runs = fakeRuns({ runs: 2000, level: LEVEL1, now: NOW });
    expect(runs).toHaveLength(2000);
    expect(runs.at(-1)!.endedAt).toBeLessThan(NOW);
    const mean = (a: typeof runs) => a.reduce((t, r) => t + r.maxProgress, 0) / a.length;
    expect(mean(runs.slice(-300))).toBeGreaterThan(mean(runs.slice(0, 300)) * 2);
    expect(Math.max(...runs.map((r) => r.maxProgress))).toBeGreaterThan(0.7);
    for (let i = 1; i < runs.length; i++) expect(runs[i]!.startedAt).toBeGreaterThan(runs[i - 1]!.endedAt);
  });
});

describe('API over HTTP', () => {
  let srv: Awaited<ReturnType<typeof startServer>> | null = null;
  afterEach(async () => { await srv?.stop(); srv = null; });
  test('the local relay (npm run dev) serves /api/*', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0, store: await seeded(), log: () => {} });
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/summary`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('max-age');
    expect((await r.json()).attempts).toBe(300);
    const c = await fetch(`http://127.0.0.1:${srv.port}/api/counter`);
    expect(await c.json()).toMatchObject({ deaths: 300, run: 301 });
  });
});
