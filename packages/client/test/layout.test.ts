import { describe, expect, test } from 'vitest';
import { camera, computeLayout } from '../src/layout.ts';

describe('computeLayout', () => {
  test('1600x900 is desktop with a 56.25 px tile', () => {
    const l = computeLayout(1600, 900, 1);
    expect(l.phone).toBe(false);
    expect(l.tile).toBeCloseTo(56.25, 5);
    expect(l.groundY).toBeCloseTo(0.733 * 900, 5);
    expect(l.lookAhead).toBeCloseTo(9.6, 5);
  });

  test('390x844 is phone with a tile of about 37.9 px', () => {
    const l = computeLayout(390, 844, 3);
    expect(l.phone).toBe(true);
    expect(l.tile).toBeCloseTo(37.86, 1);
    expect(l.groundY).toBeCloseTo(0.715 * 844, 5);
    expect(l.lookAhead).toBeCloseTo(3.4, 5);
  });

  test('a rotated phone (844x390) is laid out as desktop', () => {
    const l = computeLayout(844, 390, 3);
    expect(l.phone).toBe(false);
    expect(l.tile).toBeCloseTo(390 / 16, 5);
  });

  test('dpr is carried through', () => {
    expect(computeLayout(1600, 900, 2).dpr).toBe(2);
    expect(computeLayout(390, 844, 3).dpr).toBe(3);
    expect(computeLayout(390, 844, 1).w).toBe(390);
    expect(computeLayout(390, 844, 1).h).toBe(844);
  });
});

describe('camera', () => {
  const focus = { x: 40, y: 12.4 };

  test('with no previous position it returns focus minus lookAhead', () => {
    const l = computeLayout(1600, 900, 1);
    const c = camera(l, focus, null, 1 / 60);
    expect(c.x).toBeCloseTo(40 - 9.6, 5);
    expect(Number.isFinite(c.y)).toBe(true);
  });

  test('with a previous position it moves only part-way per frame', () => {
    const l = computeLayout(1600, 900, 1);
    const target = camera(l, focus, null, 1 / 60);
    const prev = { x: target.x - 5, y: target.y };
    const c = camera(l, focus, prev, 1 / 60);
    expect(c.x).toBeGreaterThan(prev.x);
    expect(c.x).toBeLessThan(target.x);
    expect(c.x - prev.x).toBeLessThan(2.5);
  });

  test('converges on the target over time', () => {
    const l = computeLayout(1600, 900, 1);
    const target = camera(l, focus, null, 1 / 60);
    let c = { x: target.x - 5, y: target.y + 2 };
    for (let i = 0; i < 300; i++) c = camera(l, focus, c, 1 / 60);
    expect(c.x).toBeCloseTo(target.x, 2);
    expect(c.y).toBeCloseTo(target.y, 2);
  });

  test('after rotating 390x844 to 844x390 the camera moves less than 1 tile in one frame', () => {
    const before = computeLayout(390, 844, 3);
    const after = computeLayout(844, 390, 3);
    const prev = camera(before, focus, null, 1 / 60);
    const c = camera(after, focus, prev, 1 / 60);
    expect(Math.abs(c.x - prev.x)).toBeLessThan(1);
    expect(Math.abs(c.y - prev.y)).toBeLessThan(1);
  });

  test('a huge frame gap still does not teleport more than a few tiles', () => {
    const l = computeLayout(1600, 900, 1);
    const target = camera(l, focus, null, 1 / 60);
    const c = camera(l, focus, { x: target.x - 50, y: target.y }, 5);
    expect(c.x).toBeLessThanOrEqual(target.x);
  });
});
