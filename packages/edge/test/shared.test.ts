import { describe, expect, test } from 'vitest';
import { LocalAbuseShare, RedisAbuseShare } from '../src/shared';

describe('abuse share', () => {
  test('without Redis: nothing is shared', async () => {
    const s = new LocalAbuseShare();
    s.flag('sid', 'rate');
    expect(s.remoteConns('1.2.3.4')).toBe(0);
    expect(await s.lookupFlag('sid')).toBeNull();
  });

  // TEST_REDIS_URL=redis://localhost:6379/15 npm test
  test.skipIf(!process.env.TEST_REDIS_URL)('with Redis: per-IP counts add up across relays, flags follow the session', async () => {
    const { Redis } = await import('ioredis');
    const r = new Redis(process.env.TEST_REDIS_URL!);
    await r.flushdb();
    const a = new RedisAbuseShare(r, 'relay-a', () => new Map([['198.51.100.1', 5]]), 60_000);
    const b = new RedisAbuseShare(r, 'relay-b', () => new Map([['198.51.100.1', 2], ['2001:db8::/64', 1]]), 60_000);
    await a.sync(); await b.sync(); await a.sync();
    expect(a.remoteConns('198.51.100.1')).toBe(2);
    expect(a.remoteConns('2001:db8::/64')).toBe(1);
    expect(b.remoteConns('198.51.100.1')).toBe(5);
    a.flag('sess-1', 'identical');
    await new Promise((res) => setTimeout(res, 50));
    expect(await b.lookupFlag('sess-1')).toBe('identical');
    b.resetFlags();
    await new Promise((res) => setTimeout(res, 50));
    expect(await a.lookupFlag('sess-1')).toBeNull();
    b.close();
    await new Promise((res) => setTimeout(res, 50));
    await a.sync();
    expect(a.remoteConns('198.51.100.1')).toBe(0); // a relay that leaves stops counting
    a.close();
    r.disconnect();
  });
});
