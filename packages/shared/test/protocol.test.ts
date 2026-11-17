import { describe, expect, test } from 'vitest';
import {
  encodeInput, encodePing, encodePong, decodeClient, encodeState, decodeServer,
  MSG_INPUT, MSG_PING, MSG_STATE, MSG_PONG, IN_LEFT, IN_RIGHT, IN_JUMP,
  DOT_NONE, DOT_LEFT, DOT_RIGHT, MAX_FRAME_CRUMBLES, type StateFrame,
} from '../src/protocol';

const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe('client messages', () => {
  test('input round-trips for every bit combination', () => {
    for (let bits = 0; bits <= 7; bits++) {
      const enc = encodeInput(bits);
      expect([...enc]).toEqual([MSG_INPUT, bits]);
      expect(decodeClient(enc.buffer)).toEqual({ type: 'input', bits });
    }
    expect(IN_LEFT | IN_RIGHT | IN_JUMP).toBe(7);
  });

  test('ping round-trips a u32', () => {
    for (const t of [0, 1, 123456, 0xffffffff]) {
      const enc = encodePing(t);
      expect(enc.length).toBe(5);
      expect(enc[0]).toBe(MSG_PING);
      expect(decodeClient(enc.buffer)).toEqual({ type: 'ping', t });
    }
  });

  test('garbage decodes to null', () => {
    expect(decodeClient(new ArrayBuffer(0))).toBeNull();
    expect(decodeClient(bytes(99, 1))).toBeNull(); // unknown type
    expect(decodeClient(bytes(MSG_STATE, 1))).toBeNull(); // server type from a client
    expect(decodeClient(bytes(MSG_INPUT))).toBeNull(); // too short
    expect(decodeClient(bytes(MSG_INPUT, 1, 0))).toBeNull(); // too long
    expect(decodeClient(bytes(MSG_PING, 1, 2, 3))).toBeNull();
    expect(decodeClient(bytes(MSG_PING, 1, 2, 3, 4, 5))).toBeNull();
    expect(decodeClient(bytes(MSG_INPUT, 8))).toBeNull(); // bits > 7
    expect(decodeClient(bytes(MSG_INPUT, 255))).toBeNull();
    expect(decodeClient(new ArrayBuffer(4096))).toBeNull();
  });
});

describe('server messages', () => {
  test('pong round-trips', () => {
    const enc = encodePong(987654321);
    expect(enc[0]).toBe(MSG_PONG);
    expect(decodeServer(enc.buffer)).toEqual({ type: 'pong', t: 987654321 });
  });

  function frame(slots: number): StateFrame {
    const dots = new Uint8Array(slots);
    const dotJump = new Uint8Array(slots);
    for (let i = 0; i < slots; i++) {
      dots[i] = [DOT_NONE, DOT_LEFT, DOT_RIGHT][i % 3]!;
      dotJump[i] = i % 5 === 0 ? 1 : 0;
    }
    return {
      tick: 4_000_000_123, run: 3940,
      x: Math.fround(123.456), y: Math.fround(14.4), vx: Math.fround(-6.25), vy: Math.fround(17.37),
      grounded: true, facing: -1, phase: 'dying',
      pull: -0.6, pressure: 0.42, strain: 0.8, jumpHeld: true,
      online: 21_345, active: 18_002, dots, dotJump,
      runTime: Math.fround(83.35), chompStart: null, crumbles: [],
    };
  }

  function expectRoundTrip(f: StateFrame) {
    const enc = encodeState(f);
    expect(enc[0]).toBe(MSG_STATE);
    const dec = decodeServer(enc.buffer);
    if (!dec || 'type' in dec) throw new Error('expected a state frame');
    const { pull, pressure, strain, ...rest } = dec;
    const { pull: p0, pressure: q0, strain: s0, ...rest0 } = f;
    expect(rest).toEqual(rest0);
    expect(Math.abs(pull - p0)).toBeLessThanOrEqual(1 / 127);
    expect(Math.abs(pressure - q0)).toBeLessThanOrEqual(1 / 127);
    expect(Math.abs(strain - s0)).toBeLessThanOrEqual(1 / 127);
    return enc;
  }

  test('a 128-slot state frame without crumbles round-trips in at most 100 bytes', () => {
    const enc = expectRoundTrip(frame(128));
    expect(enc.length).toBeLessThanOrEqual(100);
  });

  test('run time, chomp start and touched crumbles round-trip', () => {
    const crumbles = Array.from({ length: MAX_FRAME_CRUMBLES }, (_, i) => ({ tile: 70_000 + i * 18, at: Math.fround(i * 0.4) }));
    const enc = expectRoundTrip({ ...frame(128), chompStart: Math.fround(61.5), crumbles });
    expect(enc.length).toBe(encodeState(frame(128)).length + 8 * MAX_FRAME_CRUMBLES);
    expectRoundTrip({ ...frame(3), chompStart: 0, crumbles: crumbles.slice(0, 1) });
  });

  test('more than MAX_FRAME_CRUMBLES crumbles is refused', () => {
    const crumbles = Array.from({ length: MAX_FRAME_CRUMBLES + 1 }, (_, i) => ({ tile: i, at: 0 }));
    expect(() => encodeState({ ...frame(4), crumbles })).toThrow(/crumbles/);
  });

  test('a 0-slot state frame round-trips', () => {
    expectRoundTrip(frame(0));
  });

  test('every phase and flag combination round-trips', () => {
    for (const phase of ['running', 'dying', 'paused'] as const) {
      for (const facing of [1, -1] as const) {
        expectRoundTrip({ ...frame(7), phase, facing, grounded: false, jumpHeld: false, pull: 1, pressure: 0, strain: 1 });
      }
    }
  });

  test('garbage decodes to null', () => {
    const good = encodeState(frame(128));
    expect(decodeServer(new ArrayBuffer(0))).toBeNull();
    expect(decodeServer(bytes(77, 1, 2))).toBeNull();
    expect(decodeServer(good.slice(0, good.length - 1).buffer)).toBeNull();
    expect(decodeServer(bytes(MSG_PONG, 1, 2))).toBeNull();
    // crumble count must match the length exactly, and stay within the cap
    const withOne = encodeState({ ...frame(8), crumbles: [{ tile: 5, at: 1 }] });
    expect(decodeServer(withOne.slice(0, withOne.length - 1).buffer)).toBeNull();
    const extra = new Uint8Array(withOne.length + 1);
    extra.set(withOne);
    expect(decodeServer(extra.buffer)).toBeNull();
    const plain = encodeState(frame(8));
    expect(decodeServer(plain.slice(0, plain.length - 1).buffer)).toBeNull();
    const tooMany = new Uint8Array(plain.length + 8 * 17);
    tooMany.set(plain);
    tooMany[plain.length - 1] = 17;
    expect(decodeServer(tooMany.buffer)).toBeNull();
  });
});

describe('empty crowd slots', () => {
  test('DOT_EMPTY (3) round-trips so clients can tell an empty slot from an idle player', async () => {
    const { DOT_EMPTY, encodeState, decodeServer } = await import('../src/protocol');
    expect(DOT_EMPTY).toBe(3);
    const dots = new Uint8Array([0, 1, 2, 3]);
    const f = decodeServer(encodeState({
      tick: 1, run: 1, x: 0, y: 0, vx: 0, vy: 0, grounded: true, facing: 1, phase: 'running',
      pull: 0, pressure: 0, strain: 0, jumpHeld: false, online: 0, active: 0, dots, dotJump: new Uint8Array(4),
      runTime: 0, chompStart: null, crumbles: [],
    }).buffer) as { dots: Uint8Array };
    expect([...f.dots]).toEqual([0, 1, 2, 3]);
  });
});
