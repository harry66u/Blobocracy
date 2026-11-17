import { describe, expect, test } from 'vitest';
import {
  LEVEL1, LEVEL2, LEVELS, T_CONVEYOR_L, T_CONVEYOR_R, T_CRUMBLE, T_EMPTY, T_ONEWAY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, T_SPRING,
  gravityAt, tileAt, type Entity, type Level,
} from '../src/index';
import { solve } from './helpers/solver';

const FLOORS = new Set([T_SOLID, T_ONEWAY, T_CRUMBLE, T_SPRING, T_CONVEYOR_R, T_CONVEYOR_L]);
const L = LEVEL2;
const LOW_G = 0.7;

/** Per column: the floor surface row (first floor tile below any ceiling), or null for a gap. */
function floorRow(level: Level, x: number): number | null {
  let r = 0;
  while (r < level.height && tileAt(level, x, r) === T_SOLID) r++;
  while (r < level.height && tileAt(level, x, r) === T_SPIKE_DOWN) r++;
  for (; r < level.height; r++) if (FLOORS.has(tileAt(level, x, r))) return r;
  return null;
}
function ceilingSpikeRow(level: Level, x: number): number | null {
  for (let r = 0; r < level.height; r++) if (tileAt(level, x, r) === T_SPIKE_DOWN) return r;
  return null;
}
function cols(level: Level, keep: (e: Entity) => [number, number] | null): Set<number> {
  const out = new Set<number>();
  for (const e of level.entities) {
    const r = keep(e);
    if (r) for (let x = r[0]; x <= r[1]; x++) out.add(x);
  }
  return out;
}
/** Columns a moving platform sweeps over (it bridges gaps and lifts the blob up). */
const moverSpan = (level: Level) => cols(level, (e) => (e.kind === 'mover'
  ? [Math.floor(Math.min(e.x, e.x + e.dx)) - 1, Math.ceil(Math.max(e.x, e.x + e.dx) + e.w) + 1] : null));
/** Columns under a tailwind (a gust pushing right carries a jump ~2 tiles further). */
const tailwind = (level: Level) => cols(level, (e) => (e.kind === 'wind' && e.push > 0 ? [e.x, e.x + e.w - 1] : null));
/** Columns within reach of a spring (~5.5 rows up, more in low gravity). */
function springReach(level: Level): Set<number> {
  const out = new Set<number>();
  for (let x = 0; x < level.width; x++) for (let y = 0; y < level.height; y++) {
    if (tileAt(level, x, y) === T_SPRING) for (let d = -1; d <= 9; d++) out.add(x + d);
  }
  return out;
}

describe('level 2', () => {
  test('is listed after level 1', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2]);
    expect(LEVELS[0]).toBe(LEVEL1);
    expect(LEVELS[1]).toBe(L);
  });

  test('six zones, skies cycling blue, sunset, purple; the fourth has low gravity', () => {
    expect(L.zones.map((z) => z.name)).toEqual(['Breezy Bluffs', 'Bramble Gale', 'The Pistonworks', 'Moonbounce Mesa', 'Howling Hollow', 'Eye of the Storm']);
    expect(L.zones.map((z) => z.sky)).toEqual(['blue', 'blue', 'sunset', 'sunset', 'purple', 'purple']);
    expect(L.zones.map((z) => z.gravity ?? 1)).toEqual([1, 1, 1, 0.6, 1, 1]);
  });

  test('wind gusts blow in every zone', () => {
    for (const z of L.zones) {
      const winds = L.entities.filter((e) => e.kind === 'wind' && e.x >= z.startX && e.x < z.endX);
      expect(winds.length, z.name).toBeGreaterThan(0);
    }
  });

  test('every zone ends in a calm, flat, hazard-free stretch for its banner', () => {
    for (const z of L.zones.slice(0, -1)) {
      for (let x = z.endX - 12; x < z.endX; x++) {
        expect(floorRow(L, x), `${z.name} column ${x}`).toBe(13);
        for (let y = 0; y < 13; y++) expect(tileAt(L, x, y), `${z.name} (${x}, ${y})`).toBe(T_EMPTY);
      }
      const near = L.entities.filter((e) => e.kind !== 'chomp' && e.x + ('w' in e ? e.w : 0) > z.endX - 12 && e.x < z.endX);
      expect(near, z.name).toEqual([]);
    }
  });

  test('timings are tighter than level 1', () => {
    const avg = (level: Level, kind: 'crusher' | 'mover') => {
      const ps = level.entities.flatMap((e) => (e.kind === kind ? [e.period] : []));
      return ps.reduce((a, b) => a + b, 0) / ps.length;
    };
    expect(avg(L, 'crusher')).toBeLessThan(avg(LEVEL1, 'crusher') - 0.4);
    expect(avg(L, 'mover')).toBeLessThan(avg(LEVEL1, 'mover') - 1);
    const speed = (level: Level) => level.entities.find((e) => e.kind === 'chomp')!;
    const c1 = speed(LEVEL1), c2 = speed(L);
    expect(c1.kind === 'chomp' && c2.kind === 'chomp' && c2.speed > c1.speed).toBe(true);
    expect(c2.x).toBeGreaterThanOrEqual(L.zones[5]!.startX);
  });

  describe('beatability lint', () => {
    const W = L.width;
    const bridged = moverSpan(L);
    const sprung = springReach(L);
    const tail = tailwind(L);
    const low = (x: number) => gravityAt(L, x) <= LOW_G;
    test('no gap wider than 5 tiles; 7 under a tailwind or in low gravity; any width a mover spans', () => {
      let run = 0, helped = true;
      for (let x = 0; x < W; x++) {
        const gap = floorRow(L, x) === null && !bridged.has(x);
        helped = gap ? (run === 0 ? true : helped) && (tail.has(x) || low(x)) : true;
        run = gap ? run + 1 : 0;
        expect(run, `gap ending at column ${x}`).toBeLessThanOrEqual(helped ? 7 : 5);
      }
    });
    test('no rise steeper than 3 rows between neighbouring landings (5 in low gravity)', () => {
      let prev: number | null = null;
      for (let x = 0; x < W; x++) {
        const f = floorRow(L, x);
        if (f === null) continue;
        if (prev !== null && !sprung.has(x) && !bridged.has(x)) expect(prev - f, `rise at column ${x}`).toBeLessThanOrEqual(low(x) ? 5 : 3);
        prev = f;
      }
    });
    test('no floor spike run wider than 3', () => {
      let run = 0;
      for (let x = 0; x < W; x++) {
        const f = floorRow(L, x);
        run = f !== null && tileAt(L, x, f - 1) === T_SPIKE_UP ? run + 1 : 0;
        expect(run, `spikes ending at column ${x}`).toBeLessThanOrEqual(3);
      }
    });
    test('ceiling spikes are at least 4 rows above the floor beneath them (5 in low gravity)', () => {
      for (let x = 0; x < W; x++) {
        const c = ceilingSpikeRow(L, x);
        const f = floorRow(L, x);
        if (c !== null && f !== null) expect(f - c, `ceiling at column ${x}`).toBeGreaterThanOrEqual(low(x) ? 5 : 4);
      }
    });
    test('gusts never outrun the crowd: a full push always beats the strongest headwind', () => {
      for (const e of L.entities) if (e.kind === 'wind') expect(Math.abs(e.push), `wind at ${e.x}`).toBeLessThanOrEqual(3.5);
    });
  });

  // The whole level (and its 9-13 minute perfect-run time) is proven by the slow suite:
  // `npm run test:level`. Here, a quick check that the first two zones stay beatable.
  test('a player with 100 ms inputs can beat zones 1 and 2', () => {
    const r = solve(L, L.zones[1]!.endX);
    expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
  }, 120_000);
});
