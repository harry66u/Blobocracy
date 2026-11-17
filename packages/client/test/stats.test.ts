import { describe, expect, test } from 'vitest';
import { StatsStore, dayKey, freshStats, noteDeath, notePlayed, parseStats } from '../src/stats.ts';

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

describe('personal stats', () => {
  test('dayKey uses the local calendar day', () => {
    expect(dayKey(new Date(2026, 10, 7, 23, 59))).toBe('2026-11-07');
  });

  test('a day counts once however much you play it', () => {
    let s = freshStats('2026-11-17');
    s = notePlayed(s, '2026-11-17');
    s = notePlayed(s, '2026-11-17');
    s = notePlayed(s, '2026-11-18');
    expect(s.days).toBe(2);
    expect(s.firstDay).toBe('2026-11-17');
  });

  test('deaths add up and the best run is the furthest one', () => {
    let s = freshStats('2026-11-17');
    s = noteDeath(s, { run: 10, progress: 0.2, deaths: 10 });
    s = noteDeath(s, { run: 11, progress: 0.41, deaths: 11 });
    s = noteDeath(s, { run: 12, progress: 0.05, deaths: 12 });
    expect(s.deaths).toBe(3);
    expect(s.best).toEqual({ run: 11, progress: 0.41, death: 11 });
  });

  test('garbage or a different version in storage starts fresh', () => {
    expect(parseStats('{nope', '2026-11-17')).toEqual(freshStats('2026-11-17'));
    expect(parseStats(JSON.stringify({ v: 2 }), '2026-11-17').deaths).toBe(0);
    expect(parseStats(JSON.stringify({ v: 1, firstDay: 'x', days: 1, deaths: 1 }), '2026-11-17').firstDay).toBe('2026-11-17');
    const bad = parseStats(JSON.stringify({ v: 1, firstDay: '2026-11-01', days: 3, deaths: 9, best: { run: 1, progress: 7, death: 1 } }), '2026-11-17');
    expect(bad).toMatchObject({ firstDay: '2026-11-01', days: 3, deaths: 9, best: null });
  });

  test('the store persists across visits and survives blocked storage', () => {
    const st = memStorage();
    const a = new StatsStore(st, new Date(2026, 10, 17));
    a.update((s) => noteDeath(notePlayed(s, '2026-11-17'), { run: 3, progress: 0.3, deaths: 3 }));
    const b = new StatsStore(st, new Date(2026, 10, 20));
    expect(b.stats).toMatchObject({ firstDay: '2026-11-17', days: 1, deaths: 1 });

    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const c = new StatsStore(throwing);
    c.update((s) => noteDeath(s, { run: 1, progress: 0.1, deaths: 1 }));
    expect(c.stats.deaths).toBe(1);
  });
});
