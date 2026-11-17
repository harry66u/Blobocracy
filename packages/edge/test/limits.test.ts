import { describe, expect, test } from 'vitest';
import { IdenticalStreams, RateLimiter, TimingMonitor } from '../src/limits';

describe('input rate limit (20 changes/s)', () => {
  test('allows 20 changes in any second, ignores the rest', () => {
    const r = new RateLimiter(20);
    let ok = 0;
    for (let i = 0; i < 30; i++) if (r.allow(1000 + i * 10)) ok++;
    expect(ok).toBe(20);
    expect(r.allow(2001)).toBe(true); // a second later the window has moved on
  });

  test('a human mashing (an occasional burst over the limit) is not flagged; sustained spam is', () => {
    const r = new RateLimiter(20);
    for (let i = 0; i < 25; i++) r.allow(i * 40); // one burst second
    expect(r.flagged).toBe(false);
    const s = new RateLimiter(20);
    for (let i = 0; i < 300; i++) s.allow(i * 20); // 50/s for 6 s
    expect(s.flagged).toBe(true);
    expect(s.dropped).toBeGreaterThan(100);
  });
});

describe('inhumanly regular timing', () => {
  test('a metronome is flagged, a jittery human is not', () => {
    const bot = new TimingMonitor();
    let flagged = false;
    for (let i = 0; i < 20; i++) flagged = bot.record(i * 250 + (i % 2) * 0.4) || flagged;
    expect(flagged).toBe(true);

    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const human = new TimingMonitor();
    let t = 0, hf = false;
    for (let i = 0; i < 200; i++) { t += 120 + rand() * 300; hf = human.record(t) || hf; }
    expect(hf).toBe(false);
  });

  test('a press-release rhythm with two alternating intervals is still regular', () => {
    const m = new TimingMonitor();
    let t = 0, f = false;
    for (let i = 0; i < 24; i++) { t += i % 2 ? 300 : 100; f = m.record(t) || f; }
    expect(f).toBe(true);
  });
});

describe('identical input streams across sockets', () => {
  test('many sockets replaying the same stream at the same time are flagged together', () => {
    const d = new IdenticalStreams({ minGroup: 5, minChanges: 6 });
    const flagged = new Set<number>();
    for (let step = 0; step < 10; step++) {
      for (let id = 1; id <= 8; id++) {
        const t = 1000 + step * 333 + id * 0.1; // same instant, a fraction of a ms apart
        for (const f of d.observe(id, step % 2 ? 2 : 6, t)) flagged.add(f);
      }
    }
    expect([...flagged].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('a few people doing the obvious thing at slightly different times are not', () => {
    const d = new IdenticalStreams({ minGroup: 5, minChanges: 6 });
    const flagged: number[] = [];
    for (let step = 0; step < 10; step++) {
      for (let id = 1; id <= 8; id++) flagged.push(...d.observe(id, step % 2 ? 2 : 6, 1000 + step * 500 + id * 137));
    }
    expect(flagged).toEqual([]);
  });

  test('a big crowd reacting to the same cues with human reaction times is not flagged (defaults)', () => {
    const d = new IdenticalStreams();
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const flagged = new Set<number>();
    for (let cue = 0; cue < 12; cue++) {
      const at = 10_000 + cue * 1500;
      const events: [number, number, number][] = [];
      for (let id = 1; id <= 3000; id++) {
        const press = at + 150 + rand() * 250;
        events.push([press, id, 6], [press + 250 + rand() * 350, id, 2]);
      }
      events.sort((a, b) => a[0] - b[0]);
      for (const [t, id, bits] of events) for (const f of d.observe(id, bits, t)) flagged.add(f);
    }
    expect(flagged.size).toBe(0);
  });

  test('forget() drops a closed socket', () => {
    const d = new IdenticalStreams({ minGroup: 2, minChanges: 1 });
    d.observe(1, 2, 1000);
    d.forget(1);
    expect(d.observe(2, 2, 1000)).toEqual([]);
  });
});
