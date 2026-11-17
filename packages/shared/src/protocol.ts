import type { Cause } from './physics';

/** Binary message type bytes. Client → server: input, ping. Server → client: state, pong. */
export const MSG_INPUT = 1, MSG_PING = 2, MSG_STATE = 10, MSG_PONG = 12;

/** Input bits a client may hold. */
export const IN_LEFT = 1, IN_RIGHT = 2, IN_JUMP = 4;

/** Per-slot crowd dot codes (2 bits each on the wire). */
/** Crowd slot codes: a present player pressing nothing / left / right, or an empty slot. */
export const DOT_NONE = 0, DOT_LEFT = 1, DOT_RIGHT = 2, DOT_EMPTY = 3;

/**
 * What the world is doing: a run in progress, the death hold, nobody playing, or the
 * celebration after a win (inputs ignored; then the next level unlocks).
 */
export type Phase = 'running' | 'dying' | 'paused' | 'celebrating';

/** One authoritative world snapshot, broadcast at 20 Hz. */
export interface StateFrame {
  tick: number; run: number;
  x: number; y: number; vx: number; vy: number;
  grounded: boolean; facing: 1 | -1; phase: Phase;
  pull: number; pressure: number; strain: number; jumpHeld: boolean;
  online: number; active: number;
  /** Per crowd slot: a DOT_* code. */
  dots: Uint8Array;
  /** Per crowd slot: 1 if holding jump, else 0. */
  dotJump: Uint8Array;
  /** Run clock (seconds) that times every moving hazard; float32 on the wire. */
  runTime: number;
  /** Run time the Big Chomp was triggered, or null while it waits (NaN on the wire). */
  chompStart: number | null;
  /** Crumble tiles touched this run near the blob (tile index → run time first stood on). */
  crumbles: { tile: number; at: number }[];
}

/** A frame carries at most this many touched crumbles (the ones nearest the blob). */
export const MAX_FRAME_CRUMBLES = 16;
/** Only crumbles within this many tiles of the blob go in a frame. */
export const FRAME_CRUMBLE_RANGE = 40;

/**
 * The world beat its level (spec §6.7): `run` reached the goal after `deaths` deaths, the run
 * took `durationS` seconds, and at most `peakPlayers` were online at once on this level.
 * `clipId` names the win clip (the last 60 s), saved when the celebration ends.
 */
export type WinEvent = { t: 'win'; levelId: number; run: number; deaths: number; durationS: number; peakPlayers: number; clipId: string | null };

/** JSON text-frame events from the server. */
export type ServerEvent =
  | {
    t: 'welcome'; levelId: number; version: number; deaths: number; record: { progress: number; run: number } | null; run: number; zone: number; online: number;
    /** The level's display name. */
    name?: string;
    /** The last level, replayed after it was beaten, with its own counters. */
    encore?: boolean;
    /** Joined during a celebration: the win, and how long ago it happened. */
    celebrating?: { win: WinEvent; ageS: number };
  }
  | { t: 'death'; run: number; cause: Cause; progress: number; deaths: number; zone: number; nearRecord: boolean }
  | { t: 'zone'; run: number; index: number; name: string }
  | { t: 'record'; run: number; progress: number }
  | { t: 'reset'; run: number }
  /** A replay clip of `run` was recorded (spec §13); watch it at /c/<id>. */
  | { t: 'clip'; id: string; kind: 'record' | 'near_miss' | 'win'; run: number }
  | WinEvent
  /** After the celebration: everyone moves to this level (or an encore of the last one); a welcome follows. */
  | { t: 'level'; levelId: number; version: number; name: string; encore: boolean };

/** Clip ids: short URL-safe slugs. */
export const CLIP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * JSON text notices from the edge relay itself (not world events): whether the relay can reach
 * the sim right now. While `up` is false, clients show "Reconnecting to the blob…" over the
 * last frame; the socket to the relay stays open and pings keep being answered.
 */
export type EdgeNotice = { t: 'sim'; up: boolean };

const PHASES: readonly Phase[] = ['running', 'dying', 'paused', 'celebrating'];
const STATE_HEADER = 46;
const CRUMBLE_BYTES = 8;
const F_GROUNDED = 1, F_FACING_RIGHT = 2, F_JUMP = 4, PHASE_SHIFT = 3;
/** Flag bits above the 2-bit phase must be zero. */
const F_UNUSED = 0b1110_0000;

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

/** Byte offset of the crumble count: after the header and both dot planes. */
const crumblesAt = (slots: number) => STATE_HEADER + Math.ceil(slots / 4) + Math.ceil(slots / 8);
const stateSize = (slots: number, crumbles: number) => crumblesAt(slots) + 1 + crumbles * CRUMBLE_BYTES;

/**
 * Encodes a state frame, little-endian: the 38-byte body/blend/crowd header of plan Task 5,
 * f32 runTime and chompStart, the dot planes, then a u8 crumble count and (u32 tile, f32 at)
 * per crumble. 95 bytes for 128 slots and no crumbles.
 */
export function encodeState(f: StateFrame): Uint8Array<ArrayBuffer> {
  const n = f.dots.length;
  if (n > 255 || f.dotJump.length !== n) throw new Error(`bad slot count ${n}/${f.dotJump.length}`);
  const k = f.crumbles.length;
  if (k > MAX_FRAME_CRUMBLES) throw new Error(`too many crumbles ${k} (max ${MAX_FRAME_CRUMBLES})`);
  const out = new Uint8Array(stateSize(n, k));
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
  dv.setFloat32(38, f.runTime, true);
  dv.setFloat32(42, f.chompStart ?? NaN, true);
  const jumpAt = STATE_HEADER + Math.ceil(n / 4);
  for (let i = 0; i < n; i++) {
    out[STATE_HEADER + (i >> 2)]! |= (f.dots[i]! & 3) << ((i & 3) * 2);
    if (f.dotJump[i]) out[jumpAt + (i >> 3)]! |= 1 << (i & 7);
  }
  const c0 = crumblesAt(n);
  dv.setUint8(c0, k);
  f.crumbles.forEach((c, i) => {
    dv.setUint32(c0 + 1 + i * CRUMBLE_BYTES, c.tile >>> 0, true);
    dv.setFloat32(c0 + 5 + i * CRUMBLE_BYTES, c.at, true);
  });
  return out;
}

function decodeState(buf: ArrayBuffer): StateFrame | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < STATE_HEADER) return null;
  const dv = new DataView(buf);
  const n = dv.getUint8(37);
  const c0 = crumblesAt(n);
  if (u8.length <= c0) return null;
  const k = dv.getUint8(c0);
  if (k > MAX_FRAME_CRUMBLES || u8.length !== stateSize(n, k)) return null;
  const flags = dv.getUint8(25);
  if (flags & F_UNUSED) return null;
  const phase = PHASES[(flags >> PHASE_SHIFT) & 3];
  if (!phase) return null;
  const dots = new Uint8Array(n);
  const dotJump = new Uint8Array(n);
  const jumpAt = STATE_HEADER + Math.ceil(n / 4);
  for (let i = 0; i < n; i++) {
    const dot = (u8[STATE_HEADER + (i >> 2)]! >> ((i & 3) * 2)) & 3;
    dots[i] = dot;
    dotJump[i] = (u8[jumpAt + (i >> 3)]! >> (i & 7)) & 1;
  }
  const crumbles: { tile: number; at: number }[] = [];
  for (let i = 0; i < k; i++) {
    crumbles.push({ tile: dv.getUint32(c0 + 1 + i * CRUMBLE_BYTES, true), at: dv.getFloat32(c0 + 5 + i * CRUMBLE_BYTES, true) });
  }
  const chompStart = dv.getFloat32(42, true);
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
    runTime: dv.getFloat32(38, true),
    chompStart: Number.isNaN(chompStart) ? null : chompStart,
    crumbles,
  };
}

/** Decodes a binary server message; null for anything malformed. */
export function decodeServer(buf: ArrayBuffer): StateFrame | { type: 'pong'; t: number } | null {
  const u8 = new Uint8Array(buf);
  if (u8[0] === MSG_STATE) return decodeState(buf);
  if (u8.length === 5 && u8[0] === MSG_PONG) return { type: 'pong', t: new DataView(buf).getUint32(1, true) };
  return null;
}
