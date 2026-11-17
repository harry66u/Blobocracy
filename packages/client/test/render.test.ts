import { describe, expect, test } from 'vitest';
import { dangerAhead } from '../src/render/blob.ts';
import { homeOffset } from '../src/render/crowd.ts';
import { traceLoops } from '../src/render/level.ts';
import type { SceneLevel } from '../src/render/scene.ts';
import { hitTouchZone, touchButtons, TouchTracker } from '../src/render/touch.ts';

function level(rows: string[]): SceneLevel {
  const codes: Record<string, number> = { '.': 0, '#': 1, '-': 2, '^': 3, v: 4 };
  return {
    width: rows[0]!.length,
    height: rows.length,
    tileAt: (x, y) => codes[rows[y]?.[x] ?? '.'] ?? 0,
    zones: [],
  };
}

describe('TouchTracker (two thumbs, sliding)', () => {
  function make() {
    const sent: string[] = [];
    const t = new TouchTracker({ touch: (z, d) => sent.push(`${z}:${d ? 'down' : 'up'}`) });
    return { t, sent };
  }
  test('right thumb held while the other thumb taps jump registers both', () => {
    const { t, sent } = make();
    t.set(1, 'right');
    t.set(2, 'jump');
    t.up(2);
    expect(sent).toEqual(['right:down', 'jump:down', 'jump:up']);
  });
  test('sliding a finger from left onto right switches without lifting', () => {
    const { t, sent } = make();
    t.set(1, 'left');
    t.set(1, null); // the gap between the buttons
    t.set(1, 'right');
    expect(sent).toEqual(['left:down', 'left:up', 'right:down']);
  });
  test('direct slide presses the new zone before releasing the old', () => {
    const { t, sent } = make();
    t.set(1, 'left');
    t.set(1, 'right');
    expect(sent).toEqual(['left:down', 'right:down', 'left:up']);
  });
  test('two fingers on one button: lifting one keeps it held', () => {
    const { t, sent } = make();
    t.set(1, 'jump');
    t.set(2, 'jump');
    t.up(1);
    expect(sent).toEqual(['jump:down']);
    t.releaseAll();
    expect(sent).toEqual(['jump:down', 'jump:up']);
  });
});

describe('hitTouchZone', () => {
  const b = touchButtons(390, 844);
  test('hits each button at its center and nothing far away', () => {
    for (const btn of b) expect(hitTouchZone(btn.cx, btn.cy, b)).toBe(btn.zone);
    expect(hitTouchZone(195, 100, b)).toBeNull();
  });
  test('between left and right picks the nearer one', () => {
    const [l, r] = [b[0]!, b[1]!];
    expect(hitTouchZone(l.cx + l.r * 1.05, l.cy, b)).toBe('left');
    expect(hitTouchZone(r.cx - r.r * 0.9, r.cy, b)).toBe('right');
  });
});

describe('dangerAhead', () => {
  const lv = level([
    '....................',
    '..........^.........',
    '####################',
  ].map((r) => r).concat([]));
  const flat = { y: 0.4, vx: 5, facing: 1 as const };
  test('a spike 3 tiles ahead is danger, behind is not', () => {
    expect(dangerAhead(lv, { ...flat, x: 7.5 })).toBe(true);
    expect(dangerAhead(lv, { ...flat, x: 13.5 })).toBe(false);
    expect(dangerAhead(lv, { ...flat, x: 13.5, vx: -5, facing: -1 })).toBe(true);
  });
  test('far from anything is calm', () => {
    expect(dangerAhead(lv, { ...flat, x: 2.5 })).toBe(false);
  });
  test('a gap ahead is danger', () => {
    const g = level(['..........', '..........', '#####..###']);
    expect(dangerAhead(g, { x: 2.5, y: 0.4, vx: 5, facing: 1 })).toBe(true);
    expect(dangerAhead(g, { x: 2.5, y: 0.4, vx: -5, facing: -1 })).toBe(false);
  });
});

describe('traceLoops', () => {
  const grid = (rows: string[]) => (x: number, y: number) => rows[y]?.[x] === '#';
  test('a contiguous region is one loop with only its true corners', () => {
    const loops = traceLoops(grid(['###.', '####', '####']), 0, 0, 4, 3);
    expect(loops.length).toBe(1);
    expect(loops[0]!.length / 2).toBe(6); // L-ish shape: 6 corners
  });
  test('cells touching only at a corner stay separate shapes', () => {
    const loops = traceLoops(grid(['#.', '.#']), 0, 0, 2, 2);
    expect(loops.length).toBe(2);
    for (const l of loops) expect(l.length / 2).toBe(4);
  });
  test('a hole gives an outer and an inner loop', () => {
    const loops = traceLoops(grid(['###', '#.#', '###']), 0, 0, 3, 3);
    expect(loops.length).toBe(2);
  });
});

describe('crowd home offsets', () => {
  const h = { dx: 0, dy: 0 };
  test('left-pushers settle left, right-pushers right, jumpers higher', () => {
    expect(homeOffset(0, 0, -1, false, false, h).dx).toBeLessThan(-1.5);
    expect(homeOffset(0, 0, 1, false, false, h).dx).toBeGreaterThan(1.5);
    const jy = homeOffset(0, 0, 0, true, false, h).dy;
    const ry = homeOffset(0, 0, 1, false, false, h).dy;
    expect(jy).toBeLessThan(ry - 1);
  });
  test('nobody sits on top of the blob', () => {
    for (const g1 of [-0.5, 0, 0.5]) for (const g2 of [-0.5, 0, 0.5]) {
      const o = homeOffset(g1, g2, 0, false, false, h);
      expect(Math.hypot(o.dx, o.dy * 1.2)).toBeGreaterThanOrEqual(1.55 - 1e-9);
    }
  });
});
