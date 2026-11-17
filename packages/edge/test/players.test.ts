import { afterEach, describe, expect, test, vi } from 'vitest';
import { EdgeCrowd } from '../src/players';

const L = 1, R = 2, J = 4;
const opts = { ipVoteCap: 4, rateLimit: 20, sampleQuota: 32 };

describe('edge crowd: weighted counts', () => {
  test('one player holding right is one full vote; fresh jump presses are counted', () => {
    const c = new EdgeCrowd(opts);
    c.add(1, '1.1.1.1');
    c.input(1, R | J, 1000);
    const s = c.summarize(1100);
    expect(s.weighted).toEqual({ left: 0, right: 1, jump: 1, active: 1, fresh: 1 });
    expect(c.summarize(1400).weighted.fresh).toBe(0); // older than 0.25 s
    expect(s.buckets[R | J]).toBe(1);
  });

  test('all connections from one IP together weigh at most 4 votes, split among them', () => {
    const c = new EdgeCrowd(opts);
    for (let i = 1; i <= 10; i++) { c.add(i, '6.6.6.6'); c.input(i, R, 1000 + i); }
    c.add(99, '7.7.7.7'); c.input(99, L, 1000);
    const w = c.summarize(1100).weighted;
    expect(w.right).toBeCloseTo(4, 6);
    expect(w.left).toBe(1);
    expect(w.active).toBeCloseTo(5, 6);
    expect(c.summarize(1100).buckets[R]).toBe(10); // raw buckets stay unweighted
  });

  test('IPv6: nested caps per /64 (4), /56 (8) and /48 (16), all applied (I3)', () => {
    const c = new EdgeCrowd(opts);
    // 40 sockets, each in its own /64, spread over the /56s of one /48: a free /48 holds 65,536 /64s
    for (let i = 0; i < 40; i++) { c.add(i + 1, `2001:db8:1:${(i % 5) * 256 + i}::1`); c.input(i + 1, R, 1000); }
    expect(c.summarize(1100).weighted.right).toBeCloseTo(16, 6);
    const d = new EdgeCrowd(opts);
    // 12 /64s in one /56: at most 8 votes
    for (let i = 0; i < 12; i++) { d.add(i + 1, `2001:db8:2:${i}::1`); d.input(i + 1, R, 1000); }
    expect(d.summarize(1100).weighted.right).toBeCloseTo(8, 6);
    // a few households in a /48 are untouched
    const e = new EdgeCrowd(opts);
    for (let i = 0; i < 3; i++) { e.add(i + 1, `2001:db8:3:${i * 256}::1`); e.input(i + 1, R, 1000); }
    e.add(9, '2001:db8:3:1::1'); e.input(9, L, 1000);
    expect(e.summarize(1100).weighted).toMatchObject({ right: 3, left: 1, active: 4 });
    expect(c.stats().influenceCappedIps).toBeGreaterThanOrEqual(1);
  });

  test('a shared IP with few active players still gives each a full vote', () => {
    const c = new EdgeCrowd(opts);
    for (let i = 1; i <= 20; i++) c.add(i, '5.5.5.5'); // a school: 20 tabs, 3 playing
    for (let i = 1; i <= 3; i++) c.input(i, R, 1000);
    expect(c.summarize(1100).weighted.right).toBe(3);
  });

  test('idle players (nothing pressed for 3 s) do not count, like the sim', () => {
    const c = new EdgeCrowd(opts);
    c.add(1, '1.1.1.1');
    c.input(1, R, 0);
    c.input(1, 0, 1000);
    expect(c.summarize(3900).weighted.active).toBe(1);
    expect(c.summarize(4100).weighted.active).toBe(0);
  });

  test('flagged players are shadow-ignored: weight 0, still connected, not sampled', () => {
    const c = new EdgeCrowd(opts);
    c.add(1, '1.1.1.1', 'sid-1'); c.add(2, '2.2.2.2');
    c.input(1, R, 1000); c.input(2, L, 1000);
    c.flag(1, 'regular');
    const s = c.summarize(1100);
    expect(s.weighted).toMatchObject({ right: 0, left: 1, active: 1 });
    expect(s.connections).toBe(2);
    expect(s.sample.map((e) => e.bits)).toEqual([L]);
    // Reconnecting with the same session keeps the flag.
    c.remove(1);
    c.add(3, '1.1.1.1', 'sid-1');
    c.input(3, R, 2000);
    expect(c.summarize(2100).weighted.right).toBe(0);
    c.resetFlags();
    expect(c.summarize(2100).weighted.right).toBe(1);
  });

  test('spam beyond 20 changes/s is ignored, then the sender is flagged; the last state is kept', () => {
    const c = new EdgeCrowd(opts);
    c.add(1, '1.1.1.1');
    let t = 1000;
    let seed = 3;
    const jitter = (_i: number) => { seed = (seed * 16807) % 2147483647; return (seed % 1000) / 100; }; // a sloppy script: the timing check stays quiet
    for (let i = 0; i < 25; i++) c.input(1, i % 2 ? R : L, (t += 10 + jitter(i)));
    expect(c.stats().rateLimitedInputs).toBe(5);
    c.input(1, J, t);
    expect(c.summarize(t + 1200).buckets[J]).toBe(1); // coalesced: applied once allowed
    for (let i = 0; i < 200; i++) c.input(1, i % 2 ? R : L, (t += 15 + jitter(i)));
    expect(c.isFlagged(1)).toBe(true);
    expect(c.stats().flagged.rate).toBe(1);
  });

  test('watchers vote like players and are counted separately', () => {
    const c = new EdgeCrowd(opts);
    c.add(1, '1.1.1.1', undefined, true);
    c.input(1, R, 1000);
    const s = c.summarize(1100);
    expect(s.weighted.right).toBe(1);
    expect([s.connections, s.watchers]).toEqual([1, 1]);
  });
});

describe('edge crowd: sample for the crowd dots', () => {
  test('at most the quota, with stable 16-bit ids while the player stays', () => {
    const c = new EdgeCrowd(opts);
    for (let i = 1; i <= 40; i++) { c.add(i, `9.9.9.${i}`); c.input(i, R, 1000); }
    const a = c.summarize(1100).sample;
    expect(a.length).toBe(32);
    expect(new Set(a.map((e) => e.id)).size).toBe(32);
    c.input(a[0]!.id, L, 1200);
    const b = c.summarize(1300).sample;
    expect(b.find((e) => e.id === a[0]!.id)?.bits).toBe(L);
  });

  test('rotates: over time players outside the sample get a turn', () => {
    const c = new EdgeCrowd({ ...opts, sampleQuota: 4 });
    for (let i = 1; i <= 8; i++) { c.add(i, `9.9.9.${i}`); c.input(i, R, 0); }
    const seen = new Set<number>();
    for (let t = 0; t < 40_000; t += 500) for (const e of c.summarize(t).sample) seen.add(e.id);
    expect(seen.size).toBe(8);
  });

  test('a player who leaves is replaced; the quota can change live', () => {
    const c = new EdgeCrowd({ ...opts, sampleQuota: 2 });
    for (let i = 1; i <= 3; i++) { c.add(i, `9.9.9.${i}`); c.input(i, R, 0); }
    const first = c.summarize(10).sample.map((e) => e.id);
    c.remove(first[0]!);
    const next = c.summarize(20).sample.map((e) => e.id);
    expect(next.length).toBe(2);
    expect(next).not.toContain(first[0]);
    c.setSampleQuota(1);
    expect(c.summarize(30).sample.length).toBe(1);
  });
});

describe('flag memory (M2)', () => {
  afterEach(() => { vi.useRealTimers(); });
  test('remembered flags older than an hour are pruned, so the map cannot grow without bound', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const c = new EdgeCrowd(opts);
    for (let i = 1; i <= 500; i++) { c.add(i, `10.0.${i >> 8}.${i & 255}`, `sid${i}`); c.flag(i, 'rate'); c.remove(i); }
    expect(c.flagMemory()).toBe(500);
    vi.setSystemTime(1_700_000_000_000 + 2 * 3600_000);
    c.add(1000, '10.9.9.9', 'fresh'); c.flag(1000, 'regular');
    c.summarize(Date.now());
    expect(c.flagMemory()).toBe(1);
    // a remembered flag still sticks within the hour
    c.add(1001, '10.9.9.9', 'fresh');
    expect(c.isFlagged(1001)).toBe(true);
  });
});
