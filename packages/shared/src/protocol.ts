import type { Cause } from './physics';

/** Binary message type bytes. Client → server: input, ping. Server → client: state, pong. */
export const MSG_INPUT = 1, MSG_PING = 2, MSG_STATE = 10, MSG_PONG = 12;

/** Input bits a client may hold. */
export const IN_LEFT = 1, IN_RIGHT = 2, IN_JUMP = 4;

/** Per-slot crowd dot codes (2 bits each on the wire). */
export const DOT_NONE = 0, DOT_LEFT = 1, DOT_RIGHT = 2;

/** One authoritative world snapshot, broadcast at 20 Hz. */
export interface StateFrame {
  tick: number; run: number;
  x: number; y: number; vx: number; vy: number;
  grounded: boolean; facing: 1 | -1; phase: 'running' | 'dying' | 'paused';
  pull: number; pressure: number; strain: number; jumpHeld: boolean;
  online: number; active: number;
  /** Per crowd slot: a DOT_* code. */
  dots: Uint8Array;
  /** Per crowd slot: 1 if holding jump, else 0. */
  dotJump: Uint8Array;
}

/** JSON text-frame events from the server. */
export type ServerEvent =
  | { t: 'welcome'; levelId: number; version: number; deaths: number; record: { progress: number; run: number } | null; run: number; zone: number; online: number }
  | { t: 'death'; run: number; cause: Cause; progress: number; deaths: number; zone: number; nearRecord: boolean }
  | { t: 'zone'; run: number; index: number; name: string }
  | { t: 'record'; run: number; progress: number }
  | { t: 'reset'; run: number };

const PHASES = ['running', 'dying', 'paused'] as const;
const STATE_HEADER = 38;
const F_GROUNDED = 1, F_FACING_RIGHT = 2, F_JUMP = 4, PHASE_SHIFT = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function typeAndU32(type: number, v: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(5);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, v >>> 0, true);
  return out;
}

/** `[MSG_INPUT, bits]`. */
export function encodeInput(bits: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array([MSG_INPUT, bits & 7]);
}

/** `[MSG_PING, u32 t]`; the server echoes `t` in a pong. */
export function encodePing(t: number): Uint8Array<ArrayBuffer> {
  return typeAndU32(MSG_PING, t);
}

/** `[MSG_PONG, u32 t]`. */
export function encodePong(t: number): Uint8Array<ArrayBuffer> {
  return typeAndU32(MSG_PONG, t);
}

/** Decodes a client message; null for anything that is not exactly a valid input or ping. */
export function decodeClient(buf: ArrayBuffer): { type: 'input'; bits: number } | { type: 'ping'; t: number } | null {
  const u8 = new Uint8Array(buf);
  if (u8.length === 2 && u8[0] === MSG_INPUT && u8[1]! <= 7) return { type: 'input', bits: u8[1]! };
  if (u8.length === 5 && u8[0] === MSG_PING) return { type: 'ping', t: new DataView(buf).getUint32(1, true) };
  return null;
}

const stateSize = (slots: number) => STATE_HEADER + Math.ceil(slots / 4) + Math.ceil(slots / 8);

/** Encodes a state frame in the little-endian layout of plan Task 5 (≤ 86 bytes for 128 slots). */
export function encodeState(f: StateFrame): Uint8Array<ArrayBuffer> {
  const n = f.dots.length;
  if (n > 255 || f.dotJump.length !== n) throw new Error(`bad slot count ${n}/${f.dotJump.length}`);
  const out = new Uint8Array(stateSize(n));
  const dv = new DataView(out.buffer);
  dv.setUint8(0, MSG_STATE);
  dv.setUint32(1, f.tick >>> 0, true);
  dv.setUint32(5, f.run >>> 0, true);
  dv.setFloat32(9, f.x, true);
  dv.setFloat32(13, f.y, true);
  dv.setFloat32(17, f.vx, true);
  dv.setFloat32(21, f.vy, true);
  const flags = (f.grounded ? F_GROUNDED : 0) | (f.facing === 1 ? F_FACING_RIGHT : 0)
    | (f.jumpHeld ? F_JUMP : 0) | (PHASES.indexOf(f.phase) << PHASE_SHIFT);
  dv.setUint8(25, flags);
  dv.setInt8(26, Math.round(clamp(f.pull, -1, 1) * 127));
  dv.setUint8(27, Math.round(clamp(f.pressure, 0, 1) * 255));
  dv.setUint8(28, Math.round(clamp(f.strain, 0, 1) * 255));
  dv.setUint32(29, f.online >>> 0, true);
  dv.setUint32(33, f.active >>> 0, true);
  dv.setUint8(37, n);
  const jumpAt = STATE_HEADER + Math.ceil(n / 4);
  for (let i = 0; i < n; i++) {
    out[STATE_HEADER + (i >> 2)]! |= (f.dots[i]! & 3) << ((i & 3) * 2);
    if (f.dotJump[i]) out[jumpAt + (i >> 3)]! |= 1 << (i & 7);
  }
  return out;
}

function decodeState(buf: ArrayBuffer): StateFrame | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < STATE_HEADER) return null;
  const dv = new DataView(buf);
  const n = dv.getUint8(37);
  if (u8.length !== stateSize(n)) return null;
  const flags = dv.getUint8(25);
  const phase = PHASES[(flags >> PHASE_SHIFT) & 3];
  if (!phase) return null;
  const dots = new Uint8Array(n);
  const dotJump = new Uint8Array(n);
  const jumpAt = STATE_HEADER + Math.ceil(n / 4);
  for (let i = 0; i < n; i++) {
    const dot = (u8[STATE_HEADER + (i >> 2)]! >> ((i & 3) * 2)) & 3;
    if (dot > DOT_RIGHT) return null;
    dots[i] = dot;
    dotJump[i] = (u8[jumpAt + (i >> 3)]! >> (i & 7)) & 1;
  }
  return {
    tick: dv.getUint32(1, true),
    run: dv.getUint32(5, true),
    x: dv.getFloat32(9, true),
    y: dv.getFloat32(13, true),
    vx: dv.getFloat32(17, true),
    vy: dv.getFloat32(21, true),
    grounded: (flags & F_GROUNDED) !== 0,
    facing: flags & F_FACING_RIGHT ? 1 : -1,
    phase,
    pull: Math.max(-1, dv.getInt8(26) / 127),
    pressure: dv.getUint8(27) / 255,
    strain: dv.getUint8(28) / 255,
    jumpHeld: (flags & F_JUMP) !== 0,
    online: dv.getUint32(29, true),
    active: dv.getUint32(33, true),
    dots,
    dotJump,
  };
}

/** Decodes a binary server message; null for anything malformed. */
export function decodeServer(buf: ArrayBuffer): StateFrame | { type: 'pong'; t: number } | null {
  const u8 = new Uint8Array(buf);
  if (u8[0] === MSG_STATE) return decodeState(buf);
  if (u8.length === 5 && u8[0] === MSG_PONG) return { type: 'pong', t: new DataView(buf).getUint32(1, true) };
  return null;
}
