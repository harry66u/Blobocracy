import { describe, expect, test } from 'vitest';
import {
  CRUMBLE_S, DT, PHYS, cloneDynamics, createBody, createDynamics, crumbleGone, nearbyCrumbles, parseLevel, stepBody,
  type Body, type Cause, type Control, type Dynamics, type EntitySpec, type Level,
} from '../src/index';

/** An 18-row room `w` wide with solid ground from row 13 down, plus [x, y, ch] marks. */
function room(w: number, marks: [number, number, string][]): string[] {
  const rows = Array.from({ length: 18 }, (_, r) => (r >= 13 ? '#'.repeat(w) : '.'.repeat(w)).split(''));
  for (const [x, y, ch] of marks) rows[y]![x] = ch;
  return rows.map((r) => r.join(''));
}
function level(w: number, marks: [number, number, string][], entities?: Record<string, EntitySpec>): Level {
  const rows = room(w, [...marks, [w - 1, 12, 'G']]);
  return parseLevel(1, 1, [{ name: 'z', sky: 'blue', rooms: [entities ? { rows, entities } : rows] }]);
}
/** Columns x0..x1 of rows y0..y1 set to `ch`. */
function box(x0: number, x1: number, y0: number, y1: number, ch: string): [number, number, string][] {
  const out: [number, number, string][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y, ch]);
  return out;
}

const STAND: Control = { move: 0, jumpHeld: false };
const RIGHT: Control = { move: 1, jumpHeld: false };

/** Steps up to `seconds`; stops early on death. */
function run(L: Level, c: Control | ((i: number) => Control), seconds: number, b: Body = createBody(L), d: Dynamics = createDynamics()) {
  let cause: Cause | null = null;
  let minY = b.y;
  const n = Math.round(seconds / DT);
  let i = 0;
  for (; i < n && !cause; i++) {
    cause = stepBody(b, typeof c === 'function' ? c(i) : c, L, d);
    minY = Math.min(minY, b.y);
  }
  return { b, d, cause, minY, seconds: i * DT };
}

describe('dynamics state', () => {
  test('starts at time zero with nothing crumbled or chasing', () => {
    expect(createDynamics()).toEqual({ t: 0, crumbles: new Map(), chompStart: null });
  });

  test('clones are independent', () => {
    const d = createDynamics();
    d.crumbles.set(3, 0.25);
    const c = cloneDynamics(d);
    c.crumbles.set(4, 1);
    c.t = 9;
    expect(d.crumbles.size).toBe(1);
    expect(d.t).toBe(0);
  });

  test('stepBody advances the clock one step per call', () => {
    const L = level(10, [[1, 12, '@']]);
    const { d } = run(L, STAND, 1);
    expect(d.t).toBeCloseTo(1, 9);
  });
});

describe('crumble', () => {
  // Crumble floor under the spawn, a pit beneath it.
  const L = level(12, [[5, 12, '@'], ...box(4, 6, 13, 13, '~'), ...box(4, 6, 14, 17, '.')]);
  const idx = (tx: number) => 13 * L.width + tx;

  test('holds, then gives way 0.5 s after being stood on, and stays gone', () => {
    const b = createBody(L);
    const d = createDynamics();
    const held = run(L, STAND, CRUMBLE_S - 2 * DT, b, d);
    expect(held.cause).toBeNull();
    expect(b.grounded).toBe(true);
    expect(b.y).toBe(12.4);
    const first = d.crumbles.get(idx(5));
    expect(first).toBeCloseTo(DT, 9);
    expect(d.crumbles.get(idx(4))).toBe(first);
    expect(crumbleGone(d, idx(5))).toBe(false);

    run(L, STAND, 3 * DT, b, d);
    expect(crumbleGone(d, idx(5))).toBe(true);
    expect(b.y).toBeGreaterThan(12.4);
    expect(d.crumbles.get(idx(5))).toBe(first); // recorded once

    const fall = run(L, STAND, 2, b, d);
    expect(fall.cause).toBe('pit');
    d.t += 1000;
    expect(crumbleGone(d, idx(5))).toBe(true);
  });

  test('is solid without dynamics too (it just never gives way)', () => {
    const b = createBody(L);
    for (let i = 0; i < 120; i++) expect(stepBody(b, STAND, L)).toBeNull();
    expect(b.y).toBe(12.4);
  });
});

describe('spring', () => {
  const L = level(12, [[5, 6, '@'], [5, 13, '*']]);
  const peak = (c: Control | ((i: number) => Control)) => {
    const r = run(L, c, 3);
    return 13 - (r.minY + PHYS.halfH);
  };

  test('landing on it launches about 5.5 tiles high with jump released', () => {
    // First let the drop land on the spring; the peak after the bounce is what counts.
    const b = createBody(L);
    const d = createDynamics();
    let launched = false;
    for (let i = 0; i < 120 && !launched; i++) {
      stepBody(b, STAND, L, d);
      launched = b.vy < 0;
    }
    expect(launched).toBe(true);
    expect(b.vy).toBe(-PHYS.springVelocity);
    expect(b.rising).toBe(false);
    const r = run(L, STAND, 1.5, b, d);
    const h = 13 - (r.minY + PHYS.halfH);
    expect(h).toBeGreaterThan(5.3);
    expect(h).toBeLessThan(5.7);
  });

  test('the bounce height does not depend on jump input', () => {
    const released = peak(STAND);
    const held = peak({ move: 0, jumpHeld: true });
    const tapped = peak((i) => ({ move: 0, jumpHeld: i % 20 < 3 }));
    expect(held).toBeCloseTo(released, 6);
    expect(tapped).toBeCloseTo(released, 6);
  });
});

describe('conveyors', () => {
  const belt = (ch: string) => level(80, [[2, 12, '@'], ...box(0, 78, 13, 13, ch)]);

  test('a right conveyor speeds up a walker going right', () => {
    const plain = run(belt('#'), RIGHT, 1);
    const fast = run(belt('>'), RIGHT, 1);
    expect(plain.b.vx).toBeCloseTo(PHYS.runSpeed, 6);
    expect(fast.b.vx).toBeCloseTo(PHYS.runSpeed + PHYS.conveyorSpeed, 6);
    expect(fast.b.x).toBeGreaterThan(plain.b.x + 2);
  });

  test('a standing blob drifts with the belt', () => {
    const r = run(belt('>'), STAND, 2);
    expect(r.b.vx).toBeCloseTo(PHYS.conveyorSpeed, 6);
    expect(r.b.x).toBeGreaterThan(2.5 + 5);
    const l = run(level(80, [[40, 12, '@'], ...box(0, 78, 13, 13, '<')]), STAND, 2);
    expect(l.b.x).toBeLessThan(40.5 - 5);
  });
});

describe('mover', () => {
  test('carries a blob standing on it along', () => {
    const L = level(30, [[6, 9, '@'], [5, 10, 'M']], { M: { kind: 'mover', w: 3, dx: 8, dy: 0, period: 4 } });
    const r = run(L, STAND, 2);
    expect(r.cause).toBeNull();
    expect(r.b.grounded).toBe(true);
    expect(r.b.y).toBeCloseTo(9.4, 6);
    expect(r.b.x).toBeCloseTo(6.5 + 8, 2);
    const back = run(L, STAND, 2, r.b, r.d);
    expect(back.b.x).toBeCloseTo(6.5, 2);
  });

  test('carries it up and down', () => {
    const L = level(30, [[6, 9, '@'], [5, 10, 'M']], { M: { kind: 'mover', w: 3, dx: 0, dy: -4, period: 4 } });
    const up = run(L, STAND, 2);
    expect(up.b.y).toBeCloseTo(9.4 - 4, 3);
    expect(up.b.grounded).toBe(true);
    const down = run(L, STAND, 2, up.b, up.d);
    expect(down.b.y).toBeCloseTo(9.4, 3);
    expect(down.b.grounded).toBe(true);
  });

  test('is one-way: a blob jumping from below passes up through it', () => {
    const L = level(30, [[6, 12, '@'], [5, 11, 'M']], { M: { kind: 'mover', w: 3, dx: 0, dy: 0, period: 4 } });
    const r = run(L, (i) => ({ move: 0, jumpHeld: i < 30 }), 0.3);
    expect(r.b.y + PHYS.halfH).toBeLessThan(11);
    const land = run(L, STAND, 1.5, r.b, r.d);
    expect(land.b.grounded).toBe(true);
    expect(land.b.y).toBeCloseTo(11 - PHYS.halfH, 6);
  });
});

describe('crusher', () => {
  // Raised block over the spawn whose teeth reach the floor when it slams (waits 1.15 s first).
  const spec: EntitySpec = { kind: 'crusher', w: 3, h: 2.3, drop: 13 - 2 - 2.3 - 0.42, period: 3 };

  test('a blob standing under it when it slams is pressed', () => {
    const L = level(20, [[5, 12, '@'], [4, 2, 'A']], { A: spec });
    const r = run(L, STAND, 3);
    expect(r.cause).toBe('press');
    expect(r.seconds).toBeGreaterThan(1.15);
    expect(r.seconds).toBeLessThan(1.15 + 0.25);
  });

  test('standing on top of a waiting crusher is safe', () => {
    const L = level(20, [[5, 1, '@'], [4, 2, 'A']], { A: spec });
    const r = run(L, STAND, 1.1);
    expect(r.cause).toBeNull();
    expect(r.b.grounded).toBe(true);
    expect(r.b.y).toBeCloseTo(2 - PHYS.halfH, 9);
  });

  test('a waiting crusher is solid from the side', () => {
    const L = level(30, [[2, 12, '@'], [10, 11, 'B']], { B: { kind: 'crusher', w: 2, h: 2, drop: 0.5, period: 100 } });
    const r = run(L, RIGHT, 2);
    expect(r.cause).toBeNull();
    expect(r.b.x).toBeCloseTo(10 - PHYS.halfW, 9);
  });

  test('walking into a slamming crusher is deadly', () => {
    // Already slammed down and holding (until 3.5 s) when the blob walks into its side.
    const L = level(30, [[2, 12, '@'], [10, 4, 'B']], { B: { kind: 'crusher', w: 2, h: 2, drop: 13 - 4 - 2 - 0.42, period: 4, phase: 0.1, holdS: 3.5, downS: 0.1, upS: 0.1 } });
    const r = run(L, RIGHT, 2);
    expect(r.cause).toBe('press');
    expect(r.b.x).toBeLessThan(10);
  });
});

describe('saw', () => {
  const L = level(30, [[2, 12, '@'], [8, 12, 'S']], { S: { kind: 'saw', r: 0.5 } });

  test('touching a saw kills', () => {
    const r = run(L, RIGHT, 3);
    expect(r.cause).toBe('saw');
    expect(r.b.x + PHYS.halfW).toBeGreaterThan(8);
  });

  test('a blob that keeps clear is fine', () => {
    expect(run(L, STAND, 3).cause).toBeNull();
  });
});

describe('Big Chomp', () => {
  const chompAt = (spawnCol: number) => level(80, [[spawnCol, 12, '@'], [2, 5, 'C']], { C: { kind: 'chomp', speed: 3 } });

  test('waits until the blob passes chomp.x + 8', () => {
    const r = run(chompAt(5), STAND, 5);
    expect(r.cause).toBeNull();
    expect(r.d.chompStart).toBeNull();
  });

  test('catches a blob that stands still after triggering it', () => {
    const r = run(chompAt(10), STAND, 5);
    expect(r.d.chompStart).toBeCloseTo(DT, 9);
    expect(r.cause).toBe('chomp');
    // 10.5 - halfW - 2 = 7.95 tiles at 3 tiles/s
    expect(r.seconds).toBeGreaterThan(2.6);
    expect(r.seconds).toBeLessThan(2.7);
  });

  test('does not catch a blob running away at full speed', () => {
    const r = run(chompAt(10), RIGHT, 8);
    expect(r.cause).toBeNull();
    expect(r.d.chompStart).not.toBeNull();
  });
});

describe('determinism', () => {
  test('two runs with identical inputs end bit-identical', () => {
    const L = level(60, [
      [2, 12, '@'], ...box(8, 10, 13, 13, '~'), [14, 13, '*'], ...box(18, 24, 13, 13, '>'), ...box(25, 30, 13, 13, '<'),
      [32, 10, 'M'], [40, 2, 'A'], [46, 9, 'S'], [1, 4, 'C'],
    ], {
      M: { kind: 'mover', w: 3, dx: 3, dy: -2, period: 3.3 },
      A: { kind: 'crusher', w: 2, drop: 6, period: 2.7 },
      S: { kind: 'saw', r: 0.7, dx: 2, dy: 2, period: 1.9 },
      C: { kind: 'chomp', speed: 2 },
    });
    const inputs = (i: number): Control => ({ move: [1, 1, 0.4, -0.3, 1][(i >> 4) % 5]!, jumpHeld: (i * 7) % 53 < 9 });
    const a = run(L, inputs, 20);
    const b = run(L, inputs, 20);
    expect(a.d.t).toBeGreaterThan(1);
    expect(b.b).toEqual(a.b);
    expect(b.d).toEqual(a.d);
    expect(b.cause).toBe(a.cause);
  });
});

describe('nearbyCrumbles', () => {
  test('lists touched crumbles within range of x, nearest first, at most max', () => {
    const L = level(200, [[1, 12, '@']]);
    const d = createDynamics();
    for (let tx = 0; tx < 100; tx += 2) d.crumbles.set(13 * L.width + tx, tx / 100);
    const near = nearbyCrumbles(d, L, 50, 40, 16);
    expect(near).toHaveLength(16);
    const xs = near.map((c) => c.tile % L.width);
    for (const x of xs) expect(Math.abs(x + 0.5 - 50)).toBeLessThanOrEqual(16);
    expect(near.find((c) => c.tile % L.width === 50)!.at).toBe(0.5);
    expect(nearbyCrumbles(d, L, 160, 40, 16)).toEqual([]);
    expect(nearbyCrumbles(d, L, 130, 40, 16).map((c) => c.tile % L.width)).toEqual([98, 96, 94, 92, 90]);
  });
});

describe('solver with dynamics', () => {
  test('finds a way past a crusher, over a mover-bridged pit and across a crumble bridge', async () => {
    const { solve } = await import('./helpers/solver');
    const L = level(70, [
      [2, 12, '@'],
      [12, 2, 'A'],
      ...box(24, 33, 13, 17, '.'), [24, 12, 'M'],
      ...box(44, 52, 13, 17, '.'), ...box(44, 52, 13, 13, '~'),
    ], {
      A: { kind: 'crusher', w: 3, h: 2.3, drop: 13 - 2 - 2.3 - 0.42, period: 2.5, holdS: 1, downS: 0.2, upS: 0.8 },
      M: { kind: 'mover', w: 3, dx: 6, dy: 0, period: 4 },
    });
    const r = solve(L, 66, 120, 60);
    expect(r.ok).toBe(true);
  }, 30_000);
});
