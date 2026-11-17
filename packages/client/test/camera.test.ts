import { describe, expect, test } from 'vitest';
import { CameraRig, cameraTarget, deadzoneY, lookTarget, stepLook } from '../src/camera.ts';
import { camera, computeLayout } from '../src/layout.ts';

const desk = computeLayout(1600, 900, 1);
const phone = computeLayout(390, 844, 1);

describe('look-ahead', () => {
  test('looks the way the blob is clearly moving, and keeps looking there when it stops', () => {
    expect(lookTarget(5, -1)).toBe(1);
    expect(lookTarget(-5, 1)).toBe(-1);
    expect(lookTarget(0.2, -1)).toBe(-1);
    expect(lookTarget(-0.2, 1)).toBe(1);
  });
  test('turns around gradually, not in one frame', () => {
    const l = stepLook(1, -1, 1 / 60);
    expect(l).toBeLessThan(1);
    expect(l).toBeGreaterThan(0.9);
    let k = 1;
    for (let i = 0; i < 180; i++) k = stepLook(k, -1, 1 / 60);
    expect(k).toBeLessThan(-0.95);
  });
  test('looking right matches the classic framing; looking left mirrors it', () => {
    const f = { x: 40, y: 12.4 };
    expect(cameraTarget(desk, f, 1, f.y).x).toBeCloseTo(camera(desk, f, null, 0).x, 6);
    const viewW = desk.w / desk.tile;
    const right = cameraTarget(desk, f, 1, f.y).x, left = cameraTarget(desk, f, -1, f.y).x;
    // blob sits `lookAhead` from the left edge when looking right, from the right edge when looking left
    expect(f.x - right).toBeCloseTo(desk.lookAhead, 6);
    expect(left + viewW - f.x).toBeCloseTo(desk.lookAhead, 6);
    // centered half way
    expect(f.x - cameraTarget(desk, f, 0, f.y).x).toBeCloseTo(viewW / 2, 6);
  });
  test('the phone view keeps the blob well inside the screen either way', () => {
    const f = { x: 40, y: 12.4 };
    const viewW = phone.w / phone.tile;
    for (const look of [-1, 0, 1]) {
      const from = f.x - cameraTarget(phone, f, look, f.y).x;
      expect(from).toBeGreaterThan(2);
      expect(from).toBeLessThan(viewW - 2);
    }
  });
});

describe('vertical deadzone', () => {
  test('small hops do not move the reference height', () => {
    expect(deadzoneY(10, 10.8, 1.2)).toBe(10);
    expect(deadzoneY(10, 9.0, 1.2)).toBe(10);
  });
  test('beyond the zone the reference follows, keeping the blob at its edge', () => {
    expect(deadzoneY(10, 12, 1.2)).toBeCloseTo(10.8, 6);
    expect(deadzoneY(10, 6, 1.2)).toBeCloseTo(7.2, 6);
  });
});

describe('CameraRig', () => {
  test('first frame lands on target; later frames ease', () => {
    const rig = new CameraRig();
    const f = { x: 40, y: 12.4, vx: 0, vy: 0, grounded: true };
    const c0 = rig.update(desk, f, 1 / 60, false);
    expect(c0.x).toBeCloseTo(40 - desk.lookAhead, 5);
    const c1 = rig.update(desk, { ...f, x: 45 }, 1 / 60, false);
    expect(c1.x).toBeGreaterThan(c0.x);
    expect(c1.x).toBeLessThan(45 - desk.lookAhead);
  });
  test('a big landing shakes the view briefly; small ones and reduced motion do not', () => {
    const run = (reduced: boolean, vy: number) => {
      const rig = new CameraRig();
      const f = { x: 40, y: 12.4, vx: 0, vy, grounded: false };
      rig.update(desk, f, 1 / 60, reduced);
      rig.update(desk, { ...f, vy: 0, grounded: true }, 1 / 60, reduced);
      return rig.shakeOffset();
    };
    expect(Math.hypot(run(false, 21).x, run(false, 21).y)).toBeGreaterThan(0);
    expect(run(false, 8)).toEqual({ x: 0, y: 0 });
    expect(run(true, 21)).toEqual({ x: 0, y: 0 });
  });
  test('shake dies out', () => {
    const rig = new CameraRig();
    rig.kick(0.5, 0.3);
    const f = { x: 40, y: 12.4, vx: 0, vy: 0, grounded: true };
    for (let i = 0; i < 40; i++) rig.update(desk, f, 1 / 60, false);
    expect(rig.shakeOffset()).toEqual({ x: 0, y: 0 });
  });
});
