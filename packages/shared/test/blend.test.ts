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
    expect(out.move).toBeCloseTo(0.6, 10);
  });

  test('strain slows the blob', () => {
    const out = blend(votes(2, 6, 0, 10), false);
    expect(out.pull).toBeCloseTo(0.4, 10);
    expect(out.strain).toBeCloseTo(0.4, 10);
    expect(out.move).toBeCloseTo(0.4 * (1 - BLEND.strainSlow * 0.4), 10);
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
