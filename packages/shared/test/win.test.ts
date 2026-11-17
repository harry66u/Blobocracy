import { describe, expect, test } from 'vitest';
import {
  CELEBRATE_S, ENCORE_TRACK, LEVEL1, LEVEL2, LEVELS, decodeServer, encodeState, isServerEvent, levelTitle, parseLevel, trackId, trackOf,
  type ServerEvent, type StateFrame,
} from '../src/index';

const frame = (phase: StateFrame['phase']): StateFrame => ({
  tick: 99, run: 4812, x: 10, y: 12.4, vx: 0, vy: -3, grounded: false, facing: 1, phase,
  pull: 0, pressure: 0, strain: 0, jumpHeld: true, online: 12408, active: 0,
  dots: new Uint8Array(8), dotJump: new Uint8Array(8), runTime: 494.5, chompStart: null, crumbles: [],
});

describe('win and level progression (protocol)', () => {
  test("the 'celebrating' phase round-trips on the wire; every phase stays distinct", () => {
    for (const phase of ['running', 'dying', 'paused', 'celebrating'] as const) {
      const d = decodeServer(encodeState(frame(phase)).buffer) as StateFrame;
      expect(d.phase).toBe(phase);
    }
  });

  test('an unknown phase code is rejected (strict validation)', () => {
    const bytes = encodeState(frame('running'));
    bytes[25] = (bytes[25]! & 0b111) | (3 << 3); // 'celebrating' is the last valid code
    expect((decodeServer(bytes.buffer) as StateFrame).phase).toBe('celebrating');
    bytes[25] = bytes[25]! | (1 << 5); // a bit above the phase field
    expect(decodeServer(bytes.buffer)).toBeNull();
  });

  test('win and level events are well-formed ServerEvents; junk is not', () => {
    const win: ServerEvent = { t: 'win', levelId: 1, run: 4812, deaths: 4811, durationS: 494.2, peakPlayers: 12408, clipId: 'Zx9_-a' };
    const level: ServerEvent = { t: 'level', levelId: 2, version: 1, name: 'Storm Peaks', encore: false };
    for (const e of [win, { ...win, clipId: null }, level, { ...level, encore: true }]) {
      expect(isServerEvent(JSON.parse(JSON.stringify(e)))).toBe(true);
    }
    expect(isServerEvent({ ...win, clipId: 'no spaces' })).toBe(false);
    expect(isServerEvent({ ...win, durationS: -1 })).toBe(false);
    expect(isServerEvent({ ...level, name: 'x'.repeat(200) })).toBe(false);
    expect(isServerEvent({ ...level, encore: 'yes' })).toBe(false);
  });

  test('a welcome may say which level, whether it is an encore, and the celebration in progress', () => {
    const base = { t: 'welcome', levelId: 2, version: 1, deaths: 0, record: null, run: 1, zone: 0, online: 3 };
    expect(isServerEvent(base)).toBe(true);
    expect(isServerEvent({ ...base, name: 'Storm Peaks', encore: true })).toBe(true);
    const win = { t: 'win', levelId: 1, run: 9, deaths: 8, durationS: 60, peakPlayers: 5, clipId: null };
    expect(isServerEvent({ ...base, celebrating: { win, ageS: 3.5 } })).toBe(true);
    expect(isServerEvent({ ...base, celebrating: { win: { t: 'death' }, ageS: 3.5 } })).toBe(false);
    expect(isServerEvent({ ...base, encore: 1 })).toBe(false);
  });
});

describe('levels', () => {
  test('every built level has a name; a level without one is called by its number', () => {
    expect(LEVELS).toEqual([LEVEL1, LEVEL2]);
    for (const l of LEVELS) expect(l.name).toMatch(/\w/);
    expect(levelTitle(LEVEL1)).toBe(LEVEL1.name);
    const room = Array.from({ length: 18 }, (_, r) => (r === 12 ? '@......G' : r >= 13 ? '########' : '........'));
    expect(levelTitle(parseLevel(7, 1, [{ name: 'A', sky: 'blue', rooms: [room] }]))).toBe('Level 7');
    expect(parseLevel(7, 1, [{ name: 'A', sky: 'blue', rooms: [room] }], 'Tiny').name).toBe('Tiny');
  });

  test('an encore keeps its own counters under its own track id', () => {
    expect(trackId(2, false)).toBe(2);
    expect(trackId(2, true)).toBe(ENCORE_TRACK + 2);
    expect(trackOf(ENCORE_TRACK + 2)).toEqual({ levelId: 2, encore: true });
    expect(trackOf(1)).toEqual({ levelId: 1, encore: false });
    expect(CELEBRATE_S).toBeGreaterThanOrEqual(20);
  });
});
