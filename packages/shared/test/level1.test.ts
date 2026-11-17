import { describe, expect, test } from 'vitest';
import { LEVEL1, T_CONVEYOR_L, T_CONVEYOR_R, T_CRUMBLE, T_ONEWAY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, T_SPRING, tileAt, type Level } from '../src/index';

const FLOORS = new Set([T_SOLID, T_ONEWAY, T_CRUMBLE, T_SPRING, T_CONVEYOR_R, T_CONVEYOR_L]);

/** Columns a moving platform sweeps over (it bridges gaps and lifts the blob up). */
function moverSpan(level: Level): Set<number> {
  const cols = new Set<number>();
  for (const e of level.entities) {
    if (e.kind !== 'mover') continue;
    const lo = Math.floor(Math.min(e.x, e.x + e.dx)) - 1, hi = Math.ceil(Math.max(e.x, e.x + e.dx) + e.w) + 1;
    for (let x = lo; x <= hi; x++) cols.add(x);
  }
  return cols;
}
/** Columns within reach of a spring (it launches the blob ~5.5 rows up). */
function springReach(level: Level): Set<number> {
  const cols = new Set<number>();
  for (let x = 0; x < level.width; x++) for (let y = 0; y < level.height; y++) {
    if (tileAt(level, x, y) === T_SPRING) for (let d = -1; d <= 8; d++) cols.add(x + d);
  }
  return cols;
}
import { solve } from './helpers/solver';

/** Per column: the floor surface row (solid or one-way top below any ceiling), or null for a gap. */
function floorRow(level: Level, x: number): number | null {
  let r = 0;
  while (r < level.height && tileAt(level, x, r) === T_SOLID) r++;
  while (r < level.height && tileAt(level, x, r) === T_SPIKE_DOWN) r++;
  for (; r < level.height; r++) {
    if (FLOORS.has(tileAt(level, x, r))) return r;
  }
  return null;
}
function ceilingSpikeRow(level: Level, x: number): number | null {
  for (let r = 0; r < level.height; r++) if (tileAt(level, x, r) === T_SPIKE_DOWN) return r;
  return null;
}

describe('level 1', () => {
  test('six zones in order with the planned names and skies', () => {
    expect(LEVEL1.zones.map((z) => z.name)).toEqual(['Welcome Mat', 'Pointy Meadow', 'The Grinder', 'Sundown Steps', 'Purple Panic', 'The Last Inch']);
    expect(LEVEL1.zones.map((z) => z.sky)).toEqual(['blue', 'blue', 'sunset', 'sunset', 'purple', 'purple']);
  });

  test('the Big Chomp lives in the last zone', () => {
    const chomps = LEVEL1.entities.filter((e) => e.kind === 'chomp');
    expect(chomps).toHaveLength(1);
    expect(chomps[0]!.x).toBeGreaterThanOrEqual(LEVEL1.zones[5]!.startX);
  });

  describe('beatability lint', () => {
    const W = LEVEL1.width;
    const bridged = moverSpan(LEVEL1);
    const sprung = springReach(LEVEL1);
    test('no gap wider than 5 tiles, unless a moving platform spans it', () => {
      let run = 0;
      for (let x = 0; x < W; x++) {
        run = floorRow(LEVEL1, x) === null && !bridged.has(x) ? run + 1 : 0;
        expect(run, `gap ending at column ${x}`).toBeLessThanOrEqual(5);
      }
    });
    test('no rise steeper than 3 rows between neighbouring landings', () => {
      let prev: number | null = null;
      for (let x = 0; x < W; x++) {
        const f = floorRow(LEVEL1, x);
        if (f === null) continue;
        if (prev !== null && !sprung.has(x) && !bridged.has(x)) expect(prev - f, `rise at column ${x}`).toBeLessThanOrEqual(3);
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

  // The whole level (and its 8-12 minute perfect-run time) is proven by the slow suite:
  // `npm run test:level`. Here, a quick check that the first two zones stay beatable.
  test('a player with 100 ms inputs can beat zones 1 and 2', () => {
    const r = solve(LEVEL1, LEVEL1.zones[1]!.endX);
    expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
  }, 120_000);
});
