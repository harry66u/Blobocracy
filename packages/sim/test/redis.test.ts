import { describe, expect, test } from 'vitest';
import { LEVEL1 } from '@blobocracy/shared';
import { RedisCounterStore } from '../src/budget';
import { RedisLiveStore, connectRedis, type LiveSnapshot } from '../src/live';
import { World } from '../src/world';

const url = process.env.TEST_REDIS_URL;
// Runs only against a real Redis: TEST_REDIS_URL=redis://localhost:6379/15 npm test
describe.skipIf(!url)('Redis stores', () => {
  test('live snapshot and budget counters round-trip', async () => {
    const r = await connectRedis(url!, 'blobocracy-test');
    try {
      const key = `test:live:${process.pid}`;
      const live = new RedisLiveStore(r, key);
      expect(await live.load()).toBeNull();
      const snap: LiveSnapshot = { v: 1, levelId: 1, version: 1, world: new World(LEVEL1).snapshot(), recordVersion: 1, runStartedAt: 1, runPeak: 2, runMaxX: 3, peakPlayers: 4, bans: ['198.51.100.7'], savedAt: 5 };
      await live.save(snap);
      expect(await live.load()).toEqual(snap);
      await r.set(key, 'junk');
      expect(await live.load()).toBeNull();
      await r.del(key);
      const b = new RedisCounterStore(r, `test:budget:${process.pid}`);
      await b.save({ month: '2026-11', machineUsd: 1.5, egressBytes: 9, fired: ['$25 alert'], budgetUsd: null });
      expect(await b.load()).toMatchObject({ month: '2026-11', machineUsd: 1.5 });
      expect(await r.ttl(`test:budget:${process.pid}`)).toBeGreaterThan(0);
      await r.del(`test:budget:${process.pid}`);
    } finally {
      r.disconnect();
    }
  });
});
