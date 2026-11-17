import { describe, expect, test } from 'vitest';
import { parseLevel, type StateFrame } from '@blobocracy/shared';
import { predict, smooth } from '../src/predict';

const rows = Array.from({ length: 18 }, (_, r) => (r === 12 ? '.@' + '.'.repeat(37) + 'G' : r >= 13 ? '#'.repeat(40) : '.'.repeat(40)));
const LEVEL = parseLevel(1, 1, [{ name: 'flat', sky: 'blue', rooms: [rows] }]);

function frame(over: Partial<StateFrame> = {}): StateFrame {
  return {
    tick: 0, run: 1, x: 5, y: 12.4, vx: 7, vy: 0, grounded: true, facing: 1, phase: 'running',
    pull: 1, pressure: 0, strain: 0, jumpHeld: false, online: 1, active: 1,
    dots: new Uint8Array(0), dotJump: new Uint8Array(0), ...over,
  };
}

describe('predict', () => {
  test('predicting 0.1 s at full pull on flat ground moves forward about vx * 0.1', () => {
    const b = predict(frame(), LEVEL, 0.1);
    expect(b.x).toBeGreaterThan(5 + 0.6);
    expect(b.x).toBeLessThan(5 + 0.75);
  });

  test('a dying frame is returned unchanged', () => {
    const b = predict(frame({ phase: 'dying' }), LEVEL, 0.1);
    expect(b.x).toBe(5);
    expect(b.y).toBe(12.4);
  });

  test('look-ahead is clamped to 0.15 s', () => {
    const a = predict(frame(), LEVEL, 0.5);
    const b = predict(frame(), LEVEL, 0.15);
    expect(a.x).toBeCloseTo(b.x, 6);
  });
});

describe('smooth', () => {
  test('snaps when the gap is over 3 tiles', () => {
    expect(smooth({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.016)).toEqual({ x: 4, y: 0 });
  });

  test('closes half the gap in 60 ms', () => {
    const p = smooth({ x: 0, y: 0 }, { x: 2, y: 0 }, 0.06);
    expect(p.x).toBeCloseTo(1, 2);
  });
});
