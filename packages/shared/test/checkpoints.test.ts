import { describe, expect, test } from 'vitest';
import { CHECKPOINT_STEP, LEVELS, PHYS, checkpointsOf, padIsSafe, parseLevel, progressOf, startOf, tileAt, T_SOLID } from '../src/index';

describe('checkpoints', () => {
  for (const level of LEVELS) {
    describe(`level ${level.id}`, () => {
      const cps = checkpointsOf(level);

      test('has one every 20% (data is fresh for the level geometry)', () => {
        expect(cps.map((c) => c.index)).toEqual([1, 2, 3, 4]);
        cps.forEach((c, i) => {
          const target = (i + 1) * CHECKPOINT_STEP;
          expect(c.progress, `checkpoint ${c.index}`).toBeGreaterThanOrEqual(target - 0.005);
          expect(c.progress, `checkpoint ${c.index}`).toBeLessThanOrEqual(target + 0.08);
          expect(c.progress).toBeCloseTo(progressOf(level, c.x), 12);
        });
      });

      test('each respawn pad is flat, solid, roomy and clear of hazards', () => {
        for (const c of cps) {
          expect(padIsSafe(level, c.x, c.y), `checkpoint ${c.index} at x=${c.x}`).toBe(true);
          expect(tileAt(level, Math.floor(c.x), Math.round(c.y + PHYS.halfH))).toBe(T_SOLID);
        }
      });

      test('startOf gives the spawn for 0 and the pad otherwise', () => {
        expect(startOf(level, 0)).toEqual(level.spawn);
        expect(startOf(level, 2)).toEqual({ x: cps[1]!.x, y: cps[1]!.y });
      });
    });
  }

  test('a level without data (or with stale data) has no checkpoints', () => {
    const lvl = parseLevel(98, 1, [{ name: 'A', sky: 'blue', rooms: [Array.from({ length: 18 }, (_, r) => (r === 12 ? '.@........G' : r >= 13 ? '###########' : '...........'))] }]);
    expect(checkpointsOf(lvl)).toEqual([]);
    expect(startOf(lvl, 3)).toEqual(lvl.spawn);
  });
});
