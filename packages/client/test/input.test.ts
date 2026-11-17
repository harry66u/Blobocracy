import { describe, expect, test } from 'vitest';
import { InputState } from '../src/input.ts';

function make() {
  const sent: number[] = [];
  const input = new InputState((b) => sent.push(b));
  return { input, sent };
}

describe('InputState keyboard', () => {
  test('right sends 2, plus jump sends 6, releasing right sends 4', () => {
    const { input, sent } = make();
    input.key('ArrowRight', true);
    input.key('Space', true);
    input.key('ArrowRight', false);
    expect(sent).toEqual([2, 6, 4]);
    expect(input.bits).toBe(4);
  });

  test('repeated keydown events do not resend', () => {
    const { input, sent } = make();
    input.key('KeyD', true);
    input.key('KeyD', true);
    input.key('KeyD', true);
    expect(sent).toEqual([2]);
  });

  test('all bindings map to the right bits', () => {
    const cases: [string, number][] = [
      ['ArrowLeft', 1], ['KeyA', 1], ['ArrowRight', 2], ['KeyD', 2], ['ArrowUp', 4], ['KeyW', 4], ['Space', 4],
    ];
    for (const [code, bit] of cases) {
      const { input, sent } = make();
      input.key(code, true);
      expect(sent).toEqual([bit]);
    }
  });

  test('unbound keys are ignored', () => {
    const { input, sent } = make();
    input.key('KeyQ', true);
    expect(sent).toEqual([]);
  });

  test('two keys for the same bit: releasing one keeps the bit held', () => {
    const { input, sent } = make();
    input.key('ArrowLeft', true);
    input.key('KeyA', true);
    input.key('ArrowLeft', false);
    expect(sent).toEqual([1]);
    input.key('KeyA', false);
    expect(sent).toEqual([1, 0]);
  });
});

describe('InputState touch', () => {
  test('left down, then right down (finger slid), then left up sends 1, 3, 2', () => {
    const { input, sent } = make();
    input.touch('left', true);
    input.touch('right', true);
    input.touch('left', false);
    expect(sent).toEqual([1, 3, 2]);
  });

  test('two zones held at once both count (right thumb + jump thumb)', () => {
    const { input, sent } = make();
    input.touch('right', true);
    input.touch('jump', true);
    expect(input.bits).toBe(6);
    input.touch('jump', false);
    expect(sent).toEqual([2, 6, 2]);
  });
});

describe('InputState releaseAll', () => {
  test('sends 0 once', () => {
    const { input, sent } = make();
    input.key('ArrowRight', true);
    input.touch('jump', true);
    input.releaseAll();
    input.releaseAll();
    expect(sent).toEqual([2, 6, 0]);
    expect(input.bits).toBe(0);
  });

  test('keys held before releaseAll do not stick afterwards', () => {
    const { input, sent } = make();
    input.key('ArrowRight', true);
    input.releaseAll();
    input.key('ArrowLeft', true);
    input.key('ArrowLeft', false);
    expect(sent).toEqual([2, 0, 1, 0]);
  });
});
