import { describe, expect, test } from 'vitest';
import { Voters } from '../src/crowd';
import { SAMPLE_SLOTS } from '@blobocracy/shared';

const L = 1, R = 2, J = 4;

describe('Voters', () => {
  test('holding left and right together counts as neither direction', () => {
    const v = new Voters();
    v.join(1);
    v.setInput(1, L | R, 0);
    expect(v.counts(0)).toMatchObject({ left: 0, right: 0, jump: 0, active: 1 });
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
    expect(v.counts(3.1)).toMatchObject({ left: 0, right: 1, jump: 0, active: 1 });
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
    expect(v.counts(0)).toMatchObject({ left: 0, right: 0, jump: 0, active: 0 });
    expect(v.size()).toBe(0);
  });

  test('inputs for unknown ids are ignored', () => {
    const v = new Voters();
    v.setInput(99, R, 0);
    expect(v.counts(0).active).toBe(0);
  });

  test('fresh counts voters whose jump press began in the last 0.25 s', () => {
    const v = new Voters();
    v.join(1); v.join(2); v.join(3);
    v.setInput(1, R | J, 0);
    v.setInput(2, R | J, 0.2);
    v.setInput(3, R, 0.2);
    expect(v.counts(0.22).fresh).toBe(2);
    expect(v.counts(0.4).fresh).toBe(1);
    v.setInput(2, R, 0.5); // release keeps it out of fresh
    expect(v.counts(0.5).fresh).toBe(0);
  });

  test('empty slots are DOT_EMPTY, including a slot freed by someone leaving', () => {
    const v = new Voters();
    v.join(1); v.join(2);
    const slot = v.slotOf(2);
    expect(v.sample().dots[SAMPLE_SLOTS - 1]).toBe(3);
    v.leave(2);
    expect(v.sample().dots[slot]).toBe(3);
    expect(v.sample().dots[v.slotOf(1)]).toBe(0); // present but idle
  });
});

describe('Voters merging relay summaries', () => {
  const W = (o: Partial<{ left: number; right: number; jump: number; active: number; fresh: number }> = {}) =>
    ({ left: 0, right: 0, jump: 0, active: 0, fresh: 0, ...o });
  const sample = (from: number, n: number, bits = R) => Array.from({ length: n }, (_, i) => ({ id: from + i, bits }));

  test('relay weighted counts add to local voters, including fresh bursts', () => {
    const v = new Voters();
    v.join(1); v.setInput(1, R | J, 0);
    v.setRelay(1, { weighted: W({ right: 2.5, jump: 1, active: 3, fresh: 1 }), connections: 10, sample: [] });
    v.setRelay(2, { weighted: W({ left: 1, active: 2 }), connections: 4, sample: [] });
    expect(v.counts(0.1)).toEqual({ left: 1, right: 3.5, jump: 2, active: 6, fresh: 2 });
    expect(v.size()).toBe(15);
  });

  test('a newer summary replaces the old one; dropping a relay removes its votes and players', () => {
    const v = new Voters();
    v.setRelay(1, { weighted: W({ right: 5, active: 5 }), connections: 5, sample: [] });
    v.setRelay(1, { weighted: W({ left: 2, active: 2 }), connections: 3, sample: [] });
    expect(v.counts(0)).toMatchObject({ left: 2, right: 0, active: 2 });
    v.dropRelay(1);
    expect(v.counts(0)).toEqual({ left: 0, right: 0, jump: 0, active: 0, fresh: 0 });
    expect(v.size()).toBe(0);
  });

  test('sampled relay players become crowd dots but are not counted twice', () => {
    const v = new Voters();
    v.setRelay(1, { weighted: W({ left: 1, active: 1 }), connections: 1, sample: [{ id: 9, bits: L | J }] });
    const slot = v.relaySlotOf(1, 9);
    expect(slot).toBeGreaterThanOrEqual(0);
    const s = v.sample();
    expect(s.dots[slot]).toBe(1);
    expect(s.dotJump[slot]).toBe(1);
    expect(v.counts(0).active).toBe(1);
    expect(v.size()).toBe(1);
  });

  test('slots stay stable across summaries and are shared between relays', () => {
    const v = new Voters();
    v.setRelay(1, { weighted: W(), connections: 64, sample: sample(0, 64) });
    v.setRelay(2, { weighted: W(), connections: 64, sample: sample(0, 64, L) });
    const a = v.relaySlotOf(1, 10), b = v.relaySlotOf(2, 10);
    expect(a).not.toBe(b);
    v.setRelay(1, { weighted: W(), connections: 64, sample: sample(0, 64, J) });
    expect(v.relaySlotOf(1, 10)).toBe(a);
    const s = v.sample();
    expect([...s.dots].filter((d) => d === 3).length).toBe(0); // all 128 filled
    expect(s.dots[b]).toBe(1);
    expect(s.dotJump[a]).toBe(1);
  });

  test('a player leaving the relay sample frees its slot for the next waiting entry (DOT_EMPTY meanwhile)', () => {
    const v = new Voters();
    v.setRelay(1, { weighted: W(), connections: 128, sample: sample(0, 128) });
    v.setRelay(2, { weighted: W(), connections: 1, sample: [{ id: 5, bits: L }] });
    expect(v.relaySlotOf(2, 5)).toBe(-1);
    const freed = v.relaySlotOf(1, 7);
    v.setRelay(1, { weighted: W(), connections: 127, sample: sample(0, 128).filter((e) => e.id !== 7) });
    v.sample();
    expect(v.relaySlotOf(1, 7)).toBe(-1);
    expect(v.relaySlotOf(2, 5)).toBe(freed);
    v.dropRelay(1);
    const s = v.sample();
    expect([...s.dots].filter((d) => d === 3).length).toBe(127);
    expect(s.dots[freed]).toBe(1);
  });
});

