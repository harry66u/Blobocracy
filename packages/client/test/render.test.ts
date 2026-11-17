import { makeEntity, type Entity } from '@blobocracy/shared';
import { describe, expect, test } from 'vitest';
import { dangerAhead } from '../src/render/blob.ts';
import { crumbleGone, type DangerWorld } from '../src/render/danger.ts';
import { chompCameraShift, crusherAnger } from '../src/render/entities.ts';
import { homeOffset } from '../src/render/crowd.ts';
import { traceLoops } from '../src/render/level.ts';
import type { SceneLevel } from '../src/render/scene.ts';
import { hitTouchZone, touchButtons, TouchTracker } from '../src/render/touch.ts';

function level(rows: string[]): SceneLevel {
  const codes: Record<string, number> = { '.': 0, '#': 1, '-': 2, '^': 3, v: 4, '~': 5, '*': 6, '>': 7, '<': 8 };
  return {
    width: rows[0]!.length,
    height: rows.length,
    tileAt: (x, y) => codes[rows[y]?.[x] ?? '.'] ?? 0,
    zones: [],
    entities: [],
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

describe('dangerAhead with moving things', () => {
  const rows = ['....................', '....................', '....................', '....................', '####################'];
  const lv = level(rows);
  const blob = { x: 4.5, y: 3.4, vx: 5, facing: 1 as const };
  const world = (entities: Entity[], extra: Partial<DangerWorld> = {}): DangerWorld => ({ entities, runTime: 0, chompStart: null, crumbles: [], ...extra });

  test('a saw just ahead is danger, one far behind is not', () => {
    const saw = makeEntity({ kind: 'saw', r: 0.8 }, 0, 6, 3);
    expect(dangerAhead(lv, blob, world([saw]))).toBe(true);
    const behind = makeEntity({ kind: 'saw', r: 0.8 }, 0, 0, 3);
    expect(dangerAhead(lv, blob, world([behind]))).toBe(false);
  });
  test('a crusher ahead is danger while slamming or holding, not while waiting up top', () => {
    // period 4: wait 0..2.15, down 2.15..2.4, hold 2.4..3.0, up 3.0..4.0
    const c = makeEntity({ kind: 'crusher', w: 2, drop: 1.5, period: 4 }, 0, 6, 0);
    expect(dangerAhead(lv, blob, world([c], { runTime: 1 }))).toBe(false);
    expect(dangerAhead(lv, blob, world([c], { runTime: 2.3 }))).toBe(true);
    expect(dangerAhead(lv, blob, world([c], { runTime: 2.7 }))).toBe(true);
  });
  test('the chomp within six tiles behind is danger, farther back is not', () => {
    const ch = makeEntity({ kind: 'chomp', speed: 2 }, 0, -10, 0);
    expect(dangerAhead(lv, blob, world([ch]))).toBe(false);
    expect(dangerAhead(lv, blob, world([ch], { chompStart: 0, runTime: 5 }))).toBe(true); // front at x = 0
  });
  test('a chomp still asleep in its lair ahead is no danger', () => {
    const lair = makeEntity({ kind: 'chomp', speed: 2 }, 0, 40, 0);
    expect(dangerAhead(lv, blob, world([lair]))).toBe(false);
  });
  test('crumble, spring and conveyor tiles are floor; a crumble being stood on is danger', () => {
    const m = level(['..........', '..........', '###~~*><##']);
    const b = { x: 1.5, y: 1.4, vx: 5, facing: 1 as const };
    expect(dangerAhead(m, b, world([]))).toBe(false);
    expect(dangerAhead(m, { ...b, x: 3.5 }, world([], { runTime: 1, crumbles: [{ tx: 3, ty: 2, at: 0.8 }] }))).toBe(true);
  });
  test('a crumble that already broke is a gap', () => {
    const m = level(['..........', '..........', '###~~#####']);
    const b = { x: 1.5, y: 1.4, vx: 5, facing: 1 as const };
    const crumbles = [{ tx: 3, ty: 2, at: 0 }, { tx: 4, ty: 2, at: 0 }];
    expect(crumbleGone(crumbles, 3, 2, 2)).toBe(true);
    expect(crumbleGone(crumbles, 3, 2, 0.3)).toBe(false);
    expect(crumbleGone(crumbles, 5, 2, 2)).toBe(false);
    expect(dangerAhead(m, b, world([], { runTime: 5, crumbles }))).toBe(true);
  });
  test('a mover bridging a gap keeps the blob calm', () => {
    const g = level(['..........', '..........', '..........', '#####..###']);
    const b = { x: 2.5, y: 2.4, vx: 5, facing: 1 as const };
    expect(dangerAhead(g, b, world([]))).toBe(true);
    const mover = makeEntity({ kind: 'mover', w: 3, dx: 0, dy: 0, period: 2 }, 0, 4, 3);
    expect(dangerAhead(g, b, world([mover]))).toBe(false);
  });
});

describe('chompCameraShift', () => {
  test('on a phone a close chomp slides the view left, but keeps the blob within 60% of it', () => {
    const s = chompCameraShift(10.3, 3.4, 2.6);
    expect(s).toBeGreaterThan(2);
    expect(3.4 + s).toBeLessThanOrEqual(0.6 * 10.3 + 1e-9);
  });
  test('no shift when far away, or on a wide view that already shows it', () => {
    expect(chompCameraShift(10.3, 3.4, 20)).toBe(0);
    expect(chompCameraShift(28.4, 9.6, 3)).toBe(0);
  });
  test('eases in continuously as the chomp approaches', () => {
    let prev = chompCameraShift(10.3, 3.4, 9.5);
    for (let d = 9.5; d >= 0; d -= 0.05) {
      const s = chompCameraShift(10.3, 3.4, d);
      expect(Math.abs(s - prev)).toBeLessThan(0.2);
      prev = s;
    }
  });
});

describe('crusherAnger', () => {
  const c = makeEntity({ kind: 'crusher', w: 2, drop: 3, period: 4 }, 0, 0, 0);
  if (c.kind !== 'crusher') throw new Error('not a crusher');
  test('grumpy while waiting, furious while slamming, winding up just before', () => {
    expect(crusherAnger(c, 0.5)).toBe(0);
    expect(crusherAnger(c, 2.0)).toBeGreaterThan(0.3);
    expect(crusherAnger(c, 2.3)).toBe(1);
    expect(crusherAnger(c, 3.9)).toBeLessThan(0.1);
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
