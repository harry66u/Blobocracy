import { describe, expect, test } from 'vitest';
import { parseLevel, tileAt, T_CRUMBLE, T_SPRING, T_CONVEYOR_R, T_CONVEYOR_L } from '../src/index';
import { entityState as stateOf, type Entity } from '../src/entities';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entityState = (e: Entity, t: number, c: number | null = null) => stateOf(e, t, c) as any;

const blank = (w: number) => Array.from({ length: 18 }, (_, r) => (r >= 13 ? '#'.repeat(w) : '.'.repeat(w)));
function room(w: number, marks: [number, number, string][]): string[] {
  const rows = blank(w).map((r) => r.split(''));
  for (const [x, y, ch] of marks) rows[y]![x] = ch;
  return rows.map((r) => r.join(''));
}

describe('new tiles', () => {
  test("'~' crumble, '*' spring, '>' and '<' conveyors parse", () => {
    const L = parseLevel(1, 1, [{ name: 'z', sky: 'blue', rooms: [room(10, [[1, 12, '@'], [2, 13, '~'], [3, 13, '*'], [4, 13, '>'], [5, 13, '<'], [9, 12, 'G']])] }]);
    expect(tileAt(L, 2, 13)).toBe(T_CRUMBLE);
    expect(tileAt(L, 3, 13)).toBe(T_SPRING);
    expect(tileAt(L, 4, 13)).toBe(T_CONVEYOR_R);
    expect(tileAt(L, 5, 13)).toBe(T_CONVEYOR_L);
  });
});

describe('entities', () => {
  const L = parseLevel(1, 1, [
    { name: 'a', sky: 'blue', rooms: [room(10, [[1, 12, '@']])] },
    {
      name: 'b', sky: 'sunset', rooms: [{
        rows: room(20, [[2, 5, 'A'], [8, 11, 'B'], [12, 9, 'C'], [15, 0, 'D'], [19, 12, 'G']]),
        entities: {
          A: { kind: 'crusher', w: 2.4, drop: 5.7, period: 3 },
          B: { kind: 'mover', w: 3, dx: 4, dy: 0, period: 4 },
          C: { kind: 'saw', r: 0.8, dx: 0, dy: 3, period: 2 },
          D: { kind: 'chomp', speed: 3 },
        },
      }],
    },
  ]);

  test('markers become entities at world coordinates, in order, and leave empty tiles', () => {
    expect(L.entities.map((e) => e.kind)).toEqual(['crusher', 'mover', 'saw', 'chomp']);
    const [crusher, mover, saw, chomp] = L.entities as Entity[];
    expect(crusher).toMatchObject({ id: 0, x: 12, y: 5, w: 2.4, drop: 5.7 });
    expect(mover).toMatchObject({ id: 1, x: 18, y: 11 });
    expect(saw).toMatchObject({ id: 2, x: 22.5, y: 9.5 });
    expect(chomp).toMatchObject({ id: 3, x: 25 });
    expect(tileAt(L, 12, 5)).toBe(0);
  });

  test('a marker without a declared entity throws', () => {
    expect(() => parseLevel(1, 1, [{ name: 'a', sky: 'blue', rooms: [{ rows: room(10, [[1, 12, '@'], [3, 3, 'A'], [9, 12, 'G']]), entities: {} }] }]))
      .toThrow(/marker 'A'/);
  });

  test('crusher waits raised, slams down fast, holds, then rises', () => {
    const c = L.entities[0]!;
    // defaults: downS 0.25, holdS 0.6, upS 1.0; period 3 -> waits 1.15 s first
    expect(entityState(c, 0)).toMatchObject({ y: 5, moving: 'wait' });
    expect(entityState(c, 1.15 + 0.25 + 0.3)).toMatchObject({ y: 5 + 5.7, moving: 'hold' });
    const mid = entityState(c, 1.15 + 0.125);
    expect(mid.moving).toBe('down');
    expect(mid.y).toBeGreaterThan(5);
    expect(mid.y).toBeLessThan(10.7);
    expect(entityState(c, 3).y).toBeCloseTo(5, 6); // periodic
  });

  test('mover ping-pongs smoothly between its ends', () => {
    const m = L.entities[1]!;
    expect(entityState(m, 0)).toMatchObject({ x: 18, y: 11 });
    expect(entityState(m, 2).x).toBeCloseTo(22, 6);
    expect(entityState(m, 4).x).toBeCloseTo(18, 6);
  });

  test('saw moves along its rail', () => {
    const s = L.entities[2]!;
    expect(entityState(s, 1).y).toBeCloseTo(12.5, 6);
    expect(entityState(s, 1).x).toBeCloseTo(22.5, 6);
  });

  test('chomp waits until triggered, then advances at its speed', () => {
    const ch = L.entities[3]!;
    expect(entityState(ch, 10, null).x).toBe(25);
    expect(entityState(ch, 10, 8).x).toBeCloseTo(25 + 3 * 2, 6);
  });

  test('same inputs give identical states (deterministic)', () => {
    for (const e of L.entities) expect(entityState(e, 1.234, 0.5)).toEqual(entityState(e, 1.234, 0.5));
  });
});
