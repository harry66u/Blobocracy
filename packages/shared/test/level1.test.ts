import { describe, expect, test } from 'vitest';
import { LEVEL1, T_ONEWAY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, tileAt, type Level } from '../src/index';
import { solve } from './helpers/solver';

/** Per column: the floor surface row (solid or one-way top below any ceiling), or null for a gap. */
function floorRow(level: Level, x: number): number | null {
  let r = 0;
  while (r < level.height && tileAt(level, x, r) === T_SOLID) r++;
  while (r < level.height && tileAt(level, x, r) === T_SPIKE_DOWN) r++;
  for (; r < level.height; r++) {
    const t = tileAt(level, x, r);
    if (t === T_SOLID || t === T_ONEWAY) return r;
  }
  return null;
}
function ceilingSpikeRow(level: Level, x: number): number | null {
  for (let r = 0; r < level.height; r++) if (tileAt(level, x, r) === T_SPIKE_DOWN) return r;
  return null;
}

describe('level 1', () => {
  test('zones are in order with the planned names and widths', () => {
    expect(LEVEL1.zones.map((z) => z.name)).toEqual(['Welcome Mat', 'Pointy Meadow']);
    const [z1, z2] = LEVEL1.zones;
    expect(z1!.endX - z1!.startX).toBeGreaterThanOrEqual(280);
    expect(z1!.endX - z1!.startX).toBeLessThanOrEqual(320);
    expect(z2!.endX - z2!.startX).toBeGreaterThanOrEqual(360);
    expect(z2!.endX - z2!.startX).toBeLessThanOrEqual(400);
  });

  describe('beatability lint', () => {
    const W = LEVEL1.width;
    test('no gap wider than 5 tiles', () => {
      let run = 0;
      for (let x = 0; x < W; x++) {
        run = floorRow(LEVEL1, x) === null ? run + 1 : 0;
        expect(run, `gap ending at column ${x}`).toBeLessThanOrEqual(5);
      }
    });
    test('no rise steeper than 3 rows between neighbouring landings', () => {
      let prev: number | null = null;
      for (let x = 0; x < W; x++) {
        const f = floorRow(LEVEL1, x);
        if (f === null) continue;
        if (prev !== null) expect(prev - f, `rise at column ${x}`).toBeLessThanOrEqual(3);
        prev = f;
      }
    });
    test('no floor spike run wider than 3 (a full jump clears ~4.4 tiles above spike height)', () => {
      let run = 0;
      for (let x = 0; x < W; x++) {
        const f = floorRow(LEVEL1, x);
        run = f !== null && tileAt(LEVEL1, x, f - 1) === T_SPIKE_UP ? run + 1 : 0;
        expect(run, `spikes ending at column ${x}`).toBeLessThanOrEqual(3);
      }
    });
    test('ceiling spikes are at least 3 rows above the floor beneath them', () => {
      for (let x = 0; x < W; x++) {
        const c = ceilingSpikeRow(LEVEL1, x);
        const f = floorRow(LEVEL1, x);
        if (c !== null && f !== null) expect(f - c, `ceiling at column ${x}`).toBeGreaterThanOrEqual(4);
      }
    });
  });

  test('a player with 100 ms inputs can beat zones 1 and 2 from spawn to the goal', () => {
    const r = solve(LEVEL1, LEVEL1.goalX - 0.5);
    expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
    // Running flat out is ~7 tiles/s; a perfect run should be close to that.
    expect(r.seconds).toBeLessThan(160);
  }, 120_000);
});
