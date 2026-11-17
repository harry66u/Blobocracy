import { describe, expect, test } from 'vitest';
import { Analytics, RateLimit, addDays, etDay } from '../src/analytics';

const at = (iso: string) => Date.parse(iso);
const visit = (o: Record<string, unknown>) => JSON.stringify({ e: 'visit', isNew: false, daily: true, firstReturn: false, daysSince: 0, cohort: '2026-11-20', firstSrc: 'hn', src: 'hn', ...o });

describe('analytics aggregation', () => {
  test('days are US Eastern', () => {
    expect(etDay(at('2026-11-21T03:30:00Z'))).toBe('2026-11-20'); // 10:30 pm ET
    expect(etDay(at('2026-11-21T05:30:00Z'))).toBe('2026-11-21');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('where from, how long, came back: an HN cohort over two days', () => {
    const a = new Analytics();
    const d1 = at('2026-11-20T15:00:00Z'), d2 = at('2026-11-21T15:00:00Z');
    // three new HN visitors, one reload, one from a share link
    for (let i = 0; i < 3; i++) a.ingest(visit({ isNew: true }), d1);
    a.ingest(visit({ daily: false }), d1);
    a.ingest(visit({ isNew: true, src: 'share', firstSrc: 'share' }), d1);
    a.ingest(JSON.stringify({ e: 'play', src: 'hn' }), d1);
    a.ingest(JSON.stringify({ e: 'stay', src: 'hn', s: 30 }), d1);
    a.ingest(JSON.stringify({ e: 'stay', src: 'hn', s: 120 }), d1);
    a.ingest(JSON.stringify({ e: 'share', src: 'hn', kind: 'image', how: 'sheet' }), d1);
    // next day: one HN visitor returns via a share link (credit goes to their first source)
    a.ingest(visit({ src: 'share', daysSince: 1, firstReturn: true }), d2);

    const s = a.summary('2026-11-20', '2026-11-21');
    const hn = s.sources.find((x) => x.source === 'hn')!;
    expect(hn).toMatchObject({ loads: 4, visitors: 3, fresh: 3, played: 1, shares: 1, cohort: 3, nextDay: 1, week: 1, cohortMature: 3 });
    expect(hn.stay).toEqual([1, 1, 0, 0]);
    expect(s.sources.find((x) => x.source === 'share')).toMatchObject({ visitors: 2, fresh: 1, cohort: 1 });
    expect(s.shares).toEqual({ 'image:sheet': 1 });
    expect(s.daily.map((d) => d.visitors)).toEqual([4, 1]);
  });

  test('malformed or hostile beacons change nothing', () => {
    const a = new Analytics();
    const now = at('2026-11-20T15:00:00Z');
    for (const bad of [
      'nope', '{}', JSON.stringify({ e: 'visit', src: 'Bad Tag!' }), JSON.stringify({ e: 'stay', src: 'hn', s: 31 }),
      JSON.stringify({ e: 'share', src: 'hn', kind: 'virus', how: 'sheet' }), JSON.stringify({ e: 'drop', src: 'hn' }),
      visit({ cohort: '20-11-2026' }), visit({ daysSince: -1 }), 'x'.repeat(1000),
    ]) expect(a.ingest(bad, now)).toBe(false);
    expect(a.data.days).toEqual({});
    expect(a.dirty).toBe(false);
  });

  test('tags named like Object.prototype members are counted safely or rejected, never crash', () => {
    const a = new Analytics();
    const now = at('2026-11-20T15:00:00Z');
    expect(a.ingest(JSON.stringify({ e: 'stay', s: 30, src: 'constructor' }), now)).toBe(true);
    expect(a.ingest(JSON.stringify({ e: 'play', src: 'tostring' }), now)).toBe(true);
    expect(a.ingest(JSON.stringify({ e: 'play', src: '__proto__' }), now)).toBe(false);
    expect(a.ingest(visit({ isNew: true, src: 'hasownproperty', firstSrc: '__proto__' }), now)).toBe(false);
    expect(a.data.days['2026-11-20']!['constructor' as string]!.stay).toEqual([1, 0, 0, 0]);
    expect(({} as Record<string, unknown>).loads).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('played');
    expect(a.summary('2026-11-20', '2026-11-20').sources.map((s) => s.source).sort()).toEqual(['constructor', 'tostring']);
  });

  test('new visitors are put in the server\'s day, so forged dates create nothing; future days are pruned', () => {
    const a = new Analytics();
    const now = at('2026-11-20T15:00:00Z');
    a.ingest(visit({ isNew: true, cohort: '9999-01-01' }), now);
    expect(Object.keys(a.data.cohorts)).toEqual(['2026-11-20']);
    a.data.days['9999-01-01'] = {};
    a.prune(now);
    expect(Object.keys(a.data.days)).toEqual(['2026-11-20']);
  });

  test('a forged far-away cohort is not credited with returns', () => {
    const a = new Analytics();
    a.ingest(visit({ cohort: '2020-01-01', daysSince: 1, firstReturn: true }), at('2026-11-20T15:00:00Z'));
    expect(a.data.cohorts).toEqual({});
  });

  test('the number of distinct sources a day is capped', () => {
    const a = new Analytics();
    const now = at('2026-11-20T15:00:00Z');
    for (let i = 0; i < 400; i++) a.ingest(JSON.stringify({ e: 'play', src: `s${i}` }), now);
    expect(Object.keys(a.data.days['2026-11-20']!).length).toBe(101);
    expect(a.data.days['2026-11-20']!.other!.played).toBe(300);
  });

  test('old days are pruned; data round-trips through JSON', () => {
    const a = new Analytics();
    a.ingest(JSON.stringify({ e: 'play', src: 'hn' }), at('2025-01-01T15:00:00Z'));
    a.ingest(JSON.stringify({ e: 'play', src: 'hn' }), at('2026-11-20T15:00:00Z'));
    a.prune(at('2026-11-20T15:00:00Z'));
    const b = new Analytics(JSON.parse(JSON.stringify(a.data)));
    expect(Object.keys(b.data.days)).toEqual(['2026-11-20']);
    expect(new Analytics({ garbage: true }).data.days).toEqual({});
  });

  test('rate limit per key per minute', () => {
    const r = new RateLimit(2);
    expect([r.allow('a', 0), r.allow('a', 1), r.allow('a', 2), r.allow('b', 3)]).toEqual([true, true, false, true]);
    expect(r.allow('a', 60_001)).toBe(true);
  });
});
