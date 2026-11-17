import { describe, expect, test } from 'vitest';
import { blend } from '../src/blend';
import { BLEND } from '../src/constants';

const votes = (left: number, right: number, jump: number, active: number) => ({ left, right, jump, active });

describe('blend', () => {
  test('one voter holding right has full control', () => {
    const out = blend(votes(0, 1, 0, 1), false);
    expect(out.pull).toBe(1);
    expect(out.move).toBe(1);
    expect(out.strain).toBe(0);
    expect(out.jumpHeld).toBe(false);
  });

  test('one voter holding left and jump', () => {
    const out = blend(votes(1, 0, 1, 1), false);
    expect(out.move).toBe(-1);
    expect(out.pressure).toBe(1);
    expect(out.jumpHeld).toBe(true);
  });

  test('two voters pulling opposite ways strain in place', () => {
    const out = blend(votes(1, 1, 0, 2), false);
    expect(out.pull).toBe(0);
    expect(out.strain).toBe(1);
    expect(out.move).toBe(0);
  });

  test('a crowd that partly agrees moves partly', () => {
    const out = blend(votes(0, 6, 0, 10), false);
    expect(out.pull).toBeCloseTo(0.6, 10);
    expect(out.move).toBeCloseTo(Math.pow(0.6, BLEND.moveCurve), 10);
  });

  test('strain slows the blob', () => {
    const out = blend(votes(2, 6, 0, 10), false);
    expect(out.pull).toBeCloseTo(0.4, 10);
    expect(out.strain).toBeCloseTo(0.4, 10);
    expect(out.move).toBeCloseTo(Math.pow(0.4, BLEND.moveCurve) * (1 - BLEND.strainSlow * 0.4), 10);
  });

  test('nobody active means no pull, no pressure, no jump', () => {
    const out = blend(votes(0, 0, 0, 0), true);
    expect(out.pull).toBe(0);
    expect(out.pressure).toBe(0);
    expect(out.strain).toBe(0);
    expect(out.move).toBe(0);
    expect(out.jumpHeld).toBe(false);
  });

  test('jump turns on at 30% pressure', () => {
    expect(blend(votes(0, 0, 3, 10), false).jumpHeld).toBe(true);
    expect(blend(votes(0, 0, 29, 100), false).jumpHeld).toBe(false);
  });

  test('jump hysteresis between 15% and 30%', () => {
    expect(blend(votes(0, 0, 25, 100), false).jumpHeld).toBe(false);
    expect(blend(votes(0, 0, 25, 100), true).jumpHeld).toBe(true);
    expect(blend(votes(0, 0, 15, 100), true).jumpHeld).toBe(true);
    expect(blend(votes(0, 0, 14, 100), true).jumpHeld).toBe(false);
  });

  test('pull and pressure are clamped even if counts exceed active', () => {
    const right = blend(votes(0, 5, 9, 2), false);
    expect(right.pull).toBe(1);
    expect(right.move).toBe(1);
    expect(right.pressure).toBe(1);
    expect(blend(votes(7, 0, 0, 3), false).pull).toBe(-1);
    expect(blend(votes(4, 4, 0, 2), false).strain).toBe(1);
  });
});

describe('fresh jump bursts', () => {
  const v = (fresh: number, jump: number, active: number) => ({ left: 0, right: active, jump, active, fresh });
  test('a burst of fresh presses fires a jump even while jump is already held', () => {
    const out = blend(v(3, 8, 10), true, false);
    expect(out.jumpPressed).toBe(true);
    expect(out.freshHigh).toBe(true);
  });
  test('the same burst fires only once', () => {
    expect(blend(v(5, 8, 10), true, true).jumpPressed).toBe(false);
  });
  test('a burst hovering around the threshold does not fire again until it dies down', () => {
    const first = blend(v(3, 8, 10), true, false);
    expect(first.jumpPressed).toBe(true);
    const wobble = blend(v(2, 8, 10), true, first.freshHigh);
    expect(wobble.freshHigh).toBe(true);
    const again = blend(v(3, 8, 10), true, wobble.freshHigh);
    expect(again.jumpPressed).toBe(false);
    const calm = blend(v(1, 8, 10), true, again.freshHigh);
    expect(calm.freshHigh).toBe(false);
    expect(blend(v(3, 8, 10), true, calm.freshHigh).jumpPressed).toBe(true);
  });

  test('a small trickle of fresh presses does not fire', () => {
    expect(blend(v(2, 8, 10), true, false).jumpPressed).toBe(false);
  });
  test('without fresh counts nothing fires', () => {
    expect(blend({ left: 0, right: 1, jump: 1, active: 1 }, true).jumpPressed).toBe(false);
  });
});

describe('movement response curve', () => {
  // A mostly-agreeing crowd should feel decisive: speed = sign(pull) * |pull|^0.6.
  test('half the crowd agreeing moves at about two thirds speed', () => {
    const out = blend({ left: 0, right: 5, jump: 0, active: 10 }, false);
    expect(out.pull).toBeCloseTo(0.5);
    expect(out.move).toBeCloseTo(Math.pow(0.5, 0.6), 5);
  });
  test('the curve is symmetric for left', () => {
    expect(blend({ left: 5, right: 0, jump: 0, active: 10 }, false).move).toBeCloseTo(-Math.pow(0.5, 0.6), 5);
  });
  test('a lone player and a dead split are unchanged', () => {
    expect(blend({ left: 0, right: 1, jump: 0, active: 1 }, false).move).toBe(1);
    expect(blend({ left: 5, right: 5, jump: 0, active: 10 }, false).move).toBeCloseTo(0, 9);
  });
});
