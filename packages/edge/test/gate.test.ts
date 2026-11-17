import { describe, expect, test } from 'vitest';
import { FrameGate, LoadMonitor, admit } from '../src/gate';

describe('frame gate: degraded relays and watchers skip frames', () => {
  test('normal: players get every frame, watchers every other', () => {
    const g = new FrameGate();
    const out = Array.from({ length: 8 }, () => g.next(false));
    expect(out.map((o) => o.play)).toEqual([true, true, true, true, true, true, true, true]);
    expect(out.filter((o) => o.watch).length).toBe(4);
  });

  test('degraded: players get every other frame, watchers every fourth', () => {
    const g = new FrameGate();
    const out = Array.from({ length: 8 }, () => g.next(true));
    expect(out.filter((o) => o.play).length).toBe(4);
    expect(out.filter((o) => o.watch).length).toBe(2);
    // never two skipped frames in a row for players
    for (let i = 1; i < out.length; i++) expect(out[i]!.play || out[i - 1]!.play).toBe(true);
  });
});

describe('load monitor', () => {
  test('degrades on high CPU or backpressure, recovers only after 3 calm seconds', () => {
    const m = new LoadMonitor({ cpuHigh: 0.85, cpuLow: 0.6, bpHigh: 0.2, bpLow: 0.05, calmMs: 3000 });
    expect(m.sample(0.5, 0, 0)).toBe(false);
    expect(m.sample(0.9, 0, 1000)).toBe(true);
    expect(m.sample(0.5, 0, 2000)).toBe(true);
    expect(m.sample(0.5, 0, 4000)).toBe(true);
    expect(m.sample(0.5, 0, 5000)).toBe(false);
    expect(m.sample(0.1, 0.3, 6000)).toBe(true);
  });
});

describe('admission under the budget tiers', () => {
  const p = (tier: 0 | 70 | 90 | 100) => ({ tier, alwaysOn: true, capacity: 100 });
  test('below 90% everyone plays', () => {
    expect(admit(p(70), 5000)).toBe('player');
    expect(admit({ ...p(0), alwaysOn: false }, 0)).toBe('player');
  });
  test('at 90% players beyond always-on capacity become watchers', () => {
    expect(admit(p(90), 99)).toBe('player');
    expect(admit(p(90), 100)).toBe('watcher');
    expect(admit({ ...p(90), alwaysOn: false }, 0)).toBe('watcher');
  });
  test('at 100% capacity is held at the always-on relays; extra visitors are told it is packed', () => {
    expect(admit(p(100), 99)).toBe('player');
    expect(admit(p(100), 100)).toBe('packed');
    expect(admit({ ...p(100), alwaysOn: false }, 0)).toBe('packed');
  });
});
