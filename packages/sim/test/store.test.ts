import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MemoryStore, summarize, type RunRow, type Store } from '../src/store';

const run = (n: number, p: number, extra: Partial<RunRow> = {}): RunRow => ({
  levelId: 1, levelVersion: 1, run: n, startedAt: 1_700_000_000_000 + n * 60_000, endedAt: 1_700_000_000_000 + n * 60_000 + 30_000,
  durationMs: 30_000, maxProgress: p, maxX: 10 + p * 100, zoneReached: Math.min(5, Math.floor(p * 6)), cause: 'spikes', peakPlayers: 12, clipId: null, ...extra,
});

/** The same behaviour from every Store implementation. */
function contract(name: string, make: () => Promise<Store>, reset?: (s: Store) => Promise<void>) {
  describe(name, () => {
    let s: Store;
    beforeAll(async () => { s = await make(); await s.init(); await s.init(); /* migrations are idempotent */ });
    afterAll(async () => { await s.close(); });
    test('levels and versions', async () => {
      await reset?.(s);
      await s.ensureLevel({ id: 1, name: 'Level 1', version: 1, geometryHash: 'aaaa' });
      await s.ensureLevel({ id: 1, name: 'Level 1', version: 2, geometryHash: 'bbbb', notes: 'wider gap' });
      await s.ensureLevel({ id: 1, name: 'Level 1', version: 2, geometryHash: 'bbbb' });
      const [l] = await s.levels();
      expect(l).toMatchObject({ id: 1, name: 'Level 1', currentVersion: 2, beatenAt: null });
      const vs = await s.levelVersions(1);
      expect(vs.map((v) => [v.version, v.geometryHash, v.notes])).toEqual([[1, 'aaaa', ''], [2, 'bbbb', 'wider gap']]);
    });

    test('world row round-trips and never loses deaths', async () => {
      expect(await s.loadWorld(1)).toBeNull();
      await s.saveWorld({ levelId: 1, deaths: 5, record: { progress: 0.4, run: 3, version: 1 }, peakPlayers: 30 });
      expect(await s.loadWorld(1)).toEqual({ levelId: 1, deaths: 5, record: { progress: 0.4, run: 3, version: 1 }, peakPlayers: 30 });
      await s.saveWorld({ levelId: 1, deaths: 6, record: null, peakPlayers: 31 });
      expect((await s.loadWorld(1))?.deaths).toBe(6);
    });

    test('world row: the all-time record only ever goes up (a row from a sim that booted without the database never clobbers it)', async () => {
      await s.saveWorld({ levelId: 1, deaths: 9, record: { progress: 0.7, run: 8, version: 1 }, peakPlayers: 1 });
      await s.saveWorld({ levelId: 1, deaths: 2, record: { progress: 0.1, run: 2, version: 2 }, peakPlayers: 1 });
      expect((await s.loadWorld(1))?.record).toEqual({ progress: 0.7, run: 8, version: 1 });
      await s.saveWorld({ levelId: 1, deaths: 3, record: null, peakPlayers: 1 });
      expect(await s.loadWorld(1)).toMatchObject({ deaths: 9, record: { progress: 0.7, run: 8, version: 1 } });
      await s.saveWorld({ levelId: 1, deaths: 10, record: { progress: 0.8, run: 10, version: 2 }, peakPlayers: 1 });
      expect((await s.loadWorld(1))?.record).toEqual({ progress: 0.8, run: 10, version: 2 });
    });

    test('world row: the next run number is kept and never goes back', async () => {
      await s.saveWorld({ levelId: 2, deaths: 3, record: null, peakPlayers: 1, nextRun: 6 });
      expect((await s.loadWorld(2))?.nextRun).toBe(6);
      await s.saveWorld({ levelId: 2, deaths: 3, record: null, peakPlayers: 1, nextRun: 4 });
      expect((await s.loadWorld(2))?.nextRun).toBe(6);
    });

    test('runs: insert is idempotent, pagination, best filter, clip attach', async () => {
      for (let i = 1; i <= 23; i++) await s.recordRun(run(i, (i % 7) / 10 + i / 100));
      await s.recordRun(run(5, 0.12)); // a second write for run 5 never replaces the first
      await s.recordRun(run(7, 0.99));
      await s.attachClip(1, 7, 'abc123');
      await s.attachClip(1, 7, 'other1');
      const p1 = await s.listRuns({ levelId: 1, page: 1, pageSize: 10, best: false });
      expect(p1.total).toBe(23);
      expect(p1.pages).toBe(3);
      expect(p1.runs.map((r) => r.run)).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14]);
      const p3 = await s.listRuns({ levelId: 1, page: 3, pageSize: 10, best: false });
      expect(p3.runs.map((r) => r.run)).toEqual([3, 2, 1]);
      const best = await s.listRuns({ levelId: 1, page: 1, pageSize: 3, best: true });
      const ps = best.runs.map((r) => r.maxProgress);
      expect(ps).toEqual([...ps].sort((a, b) => b - a));
      expect(best.runs[0]!.run).toBe(20); // 20 % 7 = 6 → 0.6 + 0.2
      const seven = (await s.listRuns({ levelId: 1, page: 2, pageSize: 10, best: false })).runs.find((r) => r.run === 7)!;
      expect(seven.clipId).toBe('abc123');
      expect(seven).toMatchObject({ levelVersion: 1, durationMs: 30_000, cause: 'spikes', peakPlayers: 12, sessionId: null });
      expect(seven.startedAt).toBe(run(7, 0).startedAt);
      const five = (await s.listRuns({ levelId: 1, page: 2, pageSize: 10, best: false })).runs.find((r) => r.run === 5)!;
      expect(five.maxProgress).toBeCloseTo((5 % 7) / 10 + 5 / 100);
      expect(seven.maxProgress).toBeCloseTo(0.07);
    });

    test('summary: zone reach, bucketed series, record steps', async () => {
      const sum = await s.summary(1, 10, 6);
      expect(sum.attempts).toBe(23);
      expect(sum.bucket).toBe(3);
      expect(sum.series.length).toBe(8);
      const all = (await s.listRuns({ levelId: 1, page: 1, pageSize: 100, best: false })).runs.sort((a, b) => a.run - b.run);
      expect(sum).toEqual(summarize(1, all, 10, 6));
      // record steps strictly increase
      for (let i = 1; i < sum.records.length; i++) expect(sum.records[i]![1]).toBeGreaterThan(sum.records[i - 1]![1]);
      expect(sum.zoneReach[0]).toBe(23);
      expect(sum.zoneReach[0]! >= sum.zoneReach[1]!).toBe(true);
    });

    test('clips', async () => {
      const replay = new Uint8Array([1, 2, 3, 250]);
      await s.saveClip({ id: 'Zx9_-a', levelId: 1, levelVersion: 1, run: 7, kind: 'near_miss', createdAt: 1_700_000_100_000, progress: 0.42, cause: 'saw', deaths: 7, replay, og: null });
      const c = await s.getClip('Zx9_-a');
      expect(c).toMatchObject({ id: 'Zx9_-a', run: 7, kind: 'near_miss', progress: 0.42, cause: 'saw', deaths: 7, og: null, createdAt: 1_700_000_100_000 });
      expect([...c!.replay]).toEqual([1, 2, 3, 250]);
      expect(await s.getClip('nope')).toBeNull();
    });

    test('hall of fame', async () => {
      expect(await s.hallOfFame()).toEqual([]);
      await s.addHallOfFame({ levelId: 1, beatenAt: 1_700_000_200_000, deathCount: 23, peakPlayers: 40, run: 24, clipId: 'Zx9_-a' });
      await s.addHallOfFame({ levelId: 1, beatenAt: 1_700_000_900_000, deathCount: 99, peakPlayers: 1, run: 99, clipId: null });
      expect(await s.hallOfFame()).toEqual([{ levelId: 1, levelName: 'Level 1', beatenAt: 1_700_000_200_000, deathCount: 23, peakPlayers: 40, run: 24, clipId: 'Zx9_-a' }]);
      expect((await s.levels())[0]!.beatenAt).toBe(1_700_000_200_000);
    });
  });
}

contract('MemoryStore', async () => new MemoryStore());

const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  contract('PostgresStore', async () => {
    const { PostgresStore } = await import('../src/store/postgres');
    const s = new PostgresStore(pgUrl);
    await s.sql`DROP TABLE IF EXISTS runs, clips, hall_of_fame, world, level_versions, levels, players, schema_migrations CASCADE`;
    return s;
  });
} else {
  test.skip('PostgresStore (set TEST_DATABASE_URL to run)', () => {});
}

describe('MemoryStore limits (M7)', () => {
  test('the oldest clips and runs are dropped past the limits, so memory stays bounded', async () => {
    const s = new MemoryStore(Date.now, { maxClips: 2, maxRuns: 3 });
    for (const id of ['c1', 'c2', 'c3']) {
      await s.saveClip({ id, levelId: 1, levelVersion: 1, run: 1, kind: 'record', createdAt: 0, progress: 0.2, cause: 'pit', deaths: 1, replay: new Uint8Array([1]), og: null });
    }
    expect(await s.getClip('c1')).toBeNull();
    expect((await s.getClip('c3'))?.id).toBe('c3');
    for (let i = 1; i <= 5; i++) await s.recordRun(run(i, i / 10));
    const page = await s.listRuns({ levelId: 1, page: 1, pageSize: 10, best: false });
    expect(page.runs.map((r) => r.run)).toEqual([5, 4, 3]);
  });
});
