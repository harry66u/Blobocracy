import { describe, expect, test } from 'vitest';
import { parseLevel } from '@blobocracy/shared';
import { AudioCues } from '../src/audiocues';

const blank = (w: number) => Array.from({ length: 18 }, (_, r) => (r >= 13 ? '#'.repeat(w) : '.'.repeat(w)).split(''));
function level() {
  const rows = blank(40);
  rows[12]![1] = '@'; rows[12]![39] = 'G'; rows[5]![10] = 'A'; rows[11]![20] = 'B';
  return parseLevel(1, 1, [{ name: 'z', sky: 'blue', rooms: [{ rows: rows.map((r) => r.join('')), entities: {
    A: { kind: 'crusher', w: 2.4, drop: 5.28, period: 3 },
    B: { kind: 'saw', r: 0.8 },
  } }] }]);
}

describe('audio cues', () => {
  test('saw proximity is 1 touching, fades to 0 by 6 tiles', () => {
    const c = new AudioCues(level());
    expect(c.sawProximity(0, 20.5, 11.5)).toBeCloseTo(1, 1);
    expect(c.sawProximity(0, 30, 11.5)).toBe(0);
    const mid = c.sawProximity(0, 23.5, 11.5);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThan(1);
  });

  test('a press slam is reported once, when it first hits bottom, with its distance', () => {
    const c = new AudioCues(level());
    // wait 1.15 s, down 0.25 s: hold starts at 1.4 s
    expect(c.slams(1.0, 12)).toEqual([]);
    expect(c.slams(1.39, 12)).toEqual([]);
    const s = c.slams(1.42, 12);
    expect(s).toHaveLength(1);
    expect(s[0]).toBeCloseTo(0.8, 1); // press center 11.2 vs x 12
    expect(c.slams(1.5, 12)).toEqual([]);
    expect(c.slams(3.5, 12)).toEqual([]); // rising, then waiting again
    expect(c.slams(4.42, 12)).toHaveLength(1); // next cycle
  });

  test('new crumbles are reported once', () => {
    const c = new AudioCues(level());
    expect(c.newCrumbles([{ tile: 5, at: 1 }])).toBe(1);
    expect(c.newCrumbles([{ tile: 5, at: 1 }])).toBe(0);
    expect(c.newCrumbles([{ tile: 5, at: 1 }, { tile: 9, at: 2 }])).toBe(1);
    expect(c.newCrumbles([])).toBe(0); // a new run
    expect(c.newCrumbles([{ tile: 5, at: 0.5 }])).toBe(1);
  });

  test('a launch much faster than a jump is a spring', () => {
    expect(AudioCues.isSpring(-23)).toBe(true);
    expect(AudioCues.isSpring(-18)).toBe(false);
  });
});
