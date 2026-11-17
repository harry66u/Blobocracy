import { describe, expect, test } from 'vitest';
import {
  DT, PHYS, WIND_RAMP_S, createBody, createDynamics, entityState, gravityAt, parseLevel, stepBody, windPush,
  type Body, type Cause, type Control, type Dynamics, type EntitySpec, type Level, type Wind, type ZoneDef,
} from '../src/index';

/** An 18-row room `w` wide with solid ground from row 13 down, plus [x, y, ch] marks. */
function room(w: number, marks: [number, number, string][]): string[] {
  const rows = Array.from({ length: 18 }, (_, r) => (r >= 13 ? '#'.repeat(w) : '.'.repeat(w)).split(''));
  for (const [x, y, ch] of marks) rows[y]![x] = ch;
  return rows.map((r) => r.join(''));
}

const STAND: Control = { move: 0, jumpHeld: false };
const RIGHT: Control = { move: 1, jumpHeld: false };
const JUMP: Control = { move: 0, jumpHeld: true };
const JUMP_RIGHT: Control = { move: 1, jumpHeld: true };

/** Steps up to `seconds`, stopping on death; `d: null` steps without dynamics. */
function run(L: Level, c: Control | ((i: number) => Control), seconds: number, b: Body = createBody(L), dyn: Dynamics | null = createDynamics()) {
  const d = dyn ?? undefined;
  let cause: Cause | null = null;
  let minY = b.y;
  let airSteps = 0;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !cause; i++) {
    cause = stepBody(b, typeof c === 'function' ? c(i) : c, L, d);
    minY = Math.min(minY, b.y);
    if (!b.grounded) airSteps++;
  }
  return { b, d, cause, minY, airSteps };
}

describe('low gravity (per-zone gravity multiplier)', () => {
  const flat = (gravity?: number): Level => {
    const z: ZoneDef = { name: 'z', sky: 'sunset', rooms: [room(40, [[3, 12, '@'], [39, 12, 'G']])] };
    if (gravity !== undefined) z.gravity = gravity;
    return parseLevel(2, 1, [z]);
  };

  test('zones carry their gravity; zones without one have none and read as 1', () => {
    const low = flat(0.6), normal = flat();
    expect(low.zones[0]!.gravity).toBe(0.6);
    expect('gravity' in normal.zones[0]!).toBe(false);
    expect(gravityAt(low, 10)).toBe(0.6);
    expect(gravityAt(normal, 10)).toBe(1);
  });

  test('a full jump goes 1/g higher and stays up 1/g longer', () => {
    const normal = run(flat(), JUMP, 2.5);
    const low = run(flat(0.6), JUMP, 2.5);
    const hN = normal.b.y - normal.minY, hL = low.b.y - low.minY;
    expect(hN).toBeCloseTo(3.2, 0);
    expect(hL / hN).toBeGreaterThan(1 / 0.6 - 0.05);
    expect(hL / hN).toBeLessThan(1 / 0.6 + 0.05);
    // a held jump fires once (no re-jump on landing), so the airtime is one arc
    expect(low.airSteps / normal.airSteps).toBeGreaterThan(1 / 0.6 - 0.06);
    expect(low.airSteps / normal.airSteps).toBeLessThan(1 / 0.6 + 0.06);
  });

  test('applies without dynamics too (it is level geometry, not a timed feature)', () => {
    const low = run(flat(0.6), JUMP, 2.5, undefined, null);
    expect(low.b.y - low.minY).toBeGreaterThan(5);
  });

  test('a spring bounce also goes 1/g higher', () => {
    const springy = (gravity?: number) => {
      const z: ZoneDef = { name: 'z', sky: 'sunset', rooms: [room(20, [[5, 4, '@'], [5, 13, '*'], [19, 12, 'G']])] };
      if (gravity !== undefined) z.gravity = gravity;
      const L = parseLevel(2, 1, [z]);
      const b = createBody(L), d = createDynamics();
      for (let i = 0; i < 200 && b.vy >= 0; i++) stepBody(b, STAND, L, d);
      expect(b.vy).toBe(-PHYS.springVelocity);
      return 13 - (run(L, STAND, 3, b, d).minY + PHYS.halfH);
    };
    expect(springy(0.6) / springy()).toBeCloseTo(1 / 0.6, 1);
  });

  test('gravity follows the zone the blob is in', () => {
    const L = parseLevel(2, 1, [
      { name: 'a', sky: 'blue', rooms: [room(20, [[2, 12, '@']])] },
      { name: 'b', sky: 'sunset', gravity: 0.5, rooms: [room(20, [[19, 12, 'G']])] },
    ]);
    expect(gravityAt(L, 19.9)).toBe(1);
    expect(gravityAt(L, 20)).toBe(0.5);
    const b = createBody(L);
    b.x = 30.5;
    const r = run(L, JUMP, 2.5, b);
    expect(r.b.y - r.minY).toBeGreaterThan(6);
  });
});

describe('wind gusts', () => {
  // A 20-wide wind region from column 10, rows 0..17, gusting right at 4 tiles/s for 1.5 s of every 4 s.
  const SPEC: EntitySpec = { kind: 'wind', w: 20, push: 4, period: 4, gustS: 1.5 };
  const windy = (spec: EntitySpec = SPEC, at: [number, number] = [10, 0]) =>
    parseLevel(2, 1, [{ name: 'z', sky: 'blue', rooms: [{ rows: room(60, [[3, 12, '@'], [at[0], at[1], 'W'], [59, 12, 'G']]), entities: { W: spec } }] }]);

  test('parses into a region (defaults: down to the bottom of the level, calm between gusts)', () => {
    const L = windy();
    const w = L.entities[0] as Wind;
    expect(w).toMatchObject({ kind: 'wind', id: 0, x: 10, y: 0, w: 20, h: 18, push: 4, period: 4, phase: 0, gustS: 1.5, base: 0 });
    const L2 = windy({ kind: 'wind', w: 5, h: 6, push: -3, period: 3 }, [4, 7]);
    expect(L2.entities[0]).toMatchObject({ x: 4, y: 7, w: 5, h: 6, push: -3, gustS: 1.5, base: 0 });
  });

  test('pulses on a deterministic schedule: eases in, blows, eases out, then calm', () => {
    const w = windy().entities[0] as Wind;
    expect(windPush(w, 0)).toBe(0);
    expect(windPush(w, WIND_RAMP_S / 2)).toBeGreaterThan(0.5);
    expect(windPush(w, WIND_RAMP_S / 2)).toBeLessThan(3.5);
    expect(windPush(w, 0.75)).toBe(4);
    expect(windPush(w, 1.5 - WIND_RAMP_S / 2)).toBeLessThan(3.5);
    expect(windPush(w, 2.5)).toBe(0);
    expect(windPush(w, 4.75)).toBe(4); // next period
    expect(entityState(w, 0.75)).toEqual({ kind: 'wind', x: 10, y: 0, w: 20, h: 18, push: 4 });
    const shifted: Wind = { ...w, phase: 0.5, base: 0.25 };
    expect(windPush(shifted, 0.75)).toBe(1); // calm part of its cycle blows at base strength
    expect(windPush(shifted, 2.75)).toBe(4);
  });

  test('a standing blob drifts with a gust and stops when it is calm', () => {
    const L = windy();
    const b = createBody(L);
    b.x = 15.5;
    // t 0..1.5 gust (full strength from 0.3 to 1.2), then calm until 4.
    const g = run(L, STAND, 1.1, b);
    expect(g.b.vx).toBeCloseTo(4, 6);
    expect(g.b.x - 15.5).toBeGreaterThan(4 * (1.1 - WIND_RAMP_S) - 0.3);
    expect(g.b.x - 15.5).toBeLessThan(4 * 1.1);
    const x1 = g.b.x;
    const calm = run(L, STAND, 1.5, g.b, g.d);
    expect(calm.b.vx).toBe(0);
    expect(calm.b.x - x1).toBeLessThan(1.2);
    const still = run(L, STAND, 1.4, calm.b, calm.d); // t 2.6..4: calm
    expect(still.b.x).toBe(calm.b.x);
  });

  test('a blob outside the region, or without dynamics, feels nothing', () => {
    const L = windy();
    expect(run(L, STAND, 1.4).b.x).toBe(createBody(L).x);
    const b = createBody(L);
    b.x = 15.5;
    expect(run(L, STAND, 1.4, b, null).b.x).toBe(15.5);
    const high = windy({ ...SPEC, h: 4 } as EntitySpec);
    const b2 = createBody(high);
    b2.x = 15.5;
    expect(run(high, STAND, 1.4, b2).b.x).toBe(15.5);
  });

  test('a gust carries a jumping blob further with it and shortens a jump against it', () => {
    const jumpFrom = (spec: EntitySpec | null) => {
      const L = spec ? windy(spec) : windy({ ...SPEC, push: 0 } as EntitySpec);
      const b = createBody(L);
      b.x = 12.5;
      const d = createDynamics();
      d.t = 0.4; // mid-gust
      const r = run(L, (i) => (i < 30 ? JUMP_RIGHT : RIGHT), 0.75, b, d);
      return r.b.x - 12.5;
    };
    const calm = jumpFrom(null);
    const tail = jumpFrom(SPEC);
    const head = jumpFrom({ ...SPEC, push: -4 } as EntitySpec);
    expect(tail).toBeGreaterThan(calm + 1.5);
    expect(head).toBeLessThan(calm - 1.5);
  });

  test('identical inputs in wind and low gravity stay bit-identical', () => {
    const L = parseLevel(2, 1, [{
      name: 'z', sky: 'sunset', gravity: 0.7,
      rooms: [{ rows: room(60, [[3, 12, '@'], [8, 2, 'W'], [30, 0, 'V'], [59, 12, 'G']]), entities: {
        W: { kind: 'wind', w: 15, push: 3, period: 2.5, gustS: 1 },
        V: { kind: 'wind', w: 10, push: -5, period: 3, phase: 0.3, base: 0.2 },
      } }],
    }]);
    const inputs = (i: number): Control => ({ move: [1, 1, 0.4, -0.3, 1][(i >> 4) % 5]!, jumpHeld: (i * 7) % 53 < 9 });
    const a = run(L, inputs, 15), b = run(L, inputs, 15);
    expect(b.b).toEqual(a.b);
    expect(b.d).toEqual(a.d);
  });
});
