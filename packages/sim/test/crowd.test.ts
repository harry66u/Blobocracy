import { describe, expect, test } from 'vitest';
import { Voters } from '../src/crowd';
import { SAMPLE_SLOTS } from '@blobocracy/shared';

const L = 1, R = 2, J = 4;

describe('Voters', () => {
  test('holding left and right together counts as neither direction', () => {
    const v = new Voters();
    v.join(1);
    v.setInput(1, L | R, 0);
    expect(v.counts(0)).toEqual({ left: 0, right: 0, jump: 0, active: 1 });
  });

  test('a voter idle with no buttons for over 3 s is not active', () => {
    const v = new Voters();
    v.join(1);
    v.setInput(1, R, 0);
    v.setInput(1, 0, 1);
    expect(v.counts(4.1).active).toBe(0);
    expect(v.counts(3.9).active).toBe(1);
  });

  test('a voter holding a button stays active however long ago it changed', () => {
    const v = new Voters();
    v.join(1);
    v.setInput(1, R, 0);
    expect(v.counts(3.1)).toEqual({ left: 0, right: 1, jump: 0, active: 1 });
  });

  test('a voter who never pressed anything is not active', () => {
    const v = new Voters();
    v.join(1);
    expect(v.counts(0).active).toBe(0);
  });

  test('slots are stable across input changes', () => {
    const v = new Voters();
    v.join(1); v.join(2);
    v.setInput(2, R, 0);
    v.sample();
    const slot = v.slotOf(2);
    expect(slot).toBeGreaterThanOrEqual(0);
    v.setInput(2, L | J, 0.5);
    const s = v.sample();
    expect(v.slotOf(2)).toBe(slot);
    expect(s.dots[slot]).toBe(1);
    expect(s.dotJump[slot]).toBe(1);
  });

  test('after leave, the freed slot goes to the next unslotted voter', () => {
    const v = new Voters();
    for (let i = 0; i < SAMPLE_SLOTS + 1; i++) { v.join(i); v.setInput(i, R, 0); }
    expect(v.slotOf(SAMPLE_SLOTS)).toBe(-1);
    const freed = v.slotOf(5);
    v.leave(5);
    v.sample();
    expect(v.slotOf(SAMPLE_SLOTS)).toBe(freed);
  });

  test('200 voters fill exactly 128 slots', () => {
    const v = new Voters();
    for (let i = 0; i < 200; i++) { v.join(i); v.setInput(i, R, 0); }
    const s = v.sample();
    expect(s.dots.length).toBe(SAMPLE_SLOTS);
    expect([...s.dots].filter((d) => d === 2).length).toBe(128);
    expect(v.size()).toBe(200);
  });

  test('leaving removes the vote immediately', () => {
    const v = new Voters();
    v.join(1); v.setInput(1, R, 0);
    v.leave(1);
    expect(v.counts(0)).toEqual({ left: 0, right: 0, jump: 0, active: 0 });
    expect(v.size()).toBe(0);
  });

  test('inputs for unknown ids are ignored', () => {
    const v = new Voters();
    v.setInput(99, R, 0);
    expect(v.counts(0).active).toBe(0);
  });
});
