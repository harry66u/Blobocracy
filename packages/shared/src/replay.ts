// Replay clips (spec §13): the exact state frames the server broadcast over the last ~30 s
// (60 s for a win) plus the world events between them, in a compact binary container.
//
// Layout (little-endian):
//   0  'BLRP'                magic
//   4  u8  version (1)
//   5  u8  flags             bit 0: the body below is zlib-deflated (CompressionStream 'deflate')
//   6  body:
//      u8  kind              0 record, 1 near_miss, 2 win
//      u16 levelId, u16 levelVersion
//      u32 run, u32 deaths   the clip's run, and the death count after the clip
//      f64 progress          how far that run got (0..1)
//      u32 frameCount, then per frame: u16 length + the state frame's bytes, unchanged
//      u32 eventsLength, then UTF-8 JSON: [[frameIndex, ServerEvent], ...] sorted by frameIndex
//
// Frames are timed by their own tick (60 Hz), so a clip recorded while the budget governor
// lowered the frame rate still plays at the right speed. An event at frameIndex i happened
// just before frame i was sent; a replay opens with a 'welcome' at frame 0 describing the
// world at the clip's start (deaths, record, run, zone).
import { MSG_STATE, decodeServer, type ServerEvent, type StateFrame } from './protocol';
import { TICK_HZ } from './constants';

export type ReplayKind = 'record' | 'near_miss' | 'win';
export interface ReplayEvent { frameIndex: number; event: ServerEvent }

export interface Replay {
  version: 1;
  levelId: number;
  levelVersion: number;
  kind: ReplayKind;
  /** The run the clip is about. */
  run: number;
  /** Death count after the clip. */
  deaths: number;
  /** How far that run got, 0..1. */
  progress: number;
  /** Encoded state frames exactly as broadcast, oldest first. */
  frames: Uint8Array[];
  events: ReplayEvent[];
}

export const REPLAY_MAGIC = new Uint8Array([0x42, 0x4c, 0x52, 0x50]); // 'BLRP'
export const REPLAY_VERSION = 1;
/** 60 s at the full 60 Hz tick rate: more than any clip needs, small enough to refuse junk early. */
export const MAX_REPLAY_FRAMES = 3600;
const MAX_EVENTS = 4000;
const MAX_EVENTS_BYTES = 1 << 20;
/** Inflated size limit (a 60 s clip is ~130 KB raw), so a zip bomb can't eat memory. */
const MAX_RAW_BYTES = 8 << 20;
const KINDS: readonly ReplayKind[] = ['record', 'near_miss', 'win'];
const FLAG_DEFLATE = 1;
const HEADER = 6;
const CAUSES = ['spikes', 'ceiling spikes', 'pit', 'press', 'saw', 'chomp'];

/** The tick of an encoded state frame (no full decode). */
export function frameTick(frame: Uint8Array): number {
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(1, true);
}

/** Decodes one recorded frame; null if it is not a valid state frame. */
export function decodeFrame(frame: Uint8Array): StateFrame | null {
  const own = frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength ? frame.buffer as ArrayBuffer : frame.slice().buffer;
  const f = decodeServer(own);
  return f && !('type' in f) ? f : null;
}

/** Seconds the clip lasts: first to last frame, plus one frame interval to show the last one. */
export function replayDuration(r: Pick<Replay, 'frames'>): number {
  const n = r.frames.length;
  if (n === 0) return 0;
  if (n === 1) return 1 / 20;
  const span = frameTick(r.frames[n - 1]!) - frameTick(r.frames[0]!);
  return (span + span / (n - 1)) / TICK_HZ;
}

// ---- codec ---------------------------------------------------------------------------

/** Encodes a replay without compression (see packReplay for the deflated form). */
export function encodeReplay(r: Replay): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(r.events.map((e) => [e.frameIndex, e.event])));
  let size = HEADER + 1 + 4 + 8 + 8 + 4 + 4 + json.length;
  for (const f of r.frames) size += 2 + f.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set(REPLAY_MAGIC, 0);
  dv.setUint8(4, REPLAY_VERSION);
  dv.setUint8(5, 0);
  let o = HEADER;
  dv.setUint8(o, KINDS.indexOf(r.kind)); o += 1;
  dv.setUint16(o, r.levelId, true); o += 2;
  dv.setUint16(o, r.levelVersion, true); o += 2;
  dv.setUint32(o, r.run >>> 0, true); o += 4;
  dv.setUint32(o, r.deaths >>> 0, true); o += 4;
  dv.setFloat64(o, r.progress, true); o += 8;
  dv.setUint32(o, r.frames.length, true); o += 4;
  for (const f of r.frames) {
    if (f.length > 0xffff) throw new Error(`frame too large (${f.length} bytes)`);
    dv.setUint16(o, f.length, true); o += 2;
    out.set(f, o); o += f.length;
  }
  dv.setUint32(o, json.length, true); o += 4;
  out.set(json, o);
  return out;
}

/**
 * Decodes an uncompressed replay with strict validation: every frame must be a valid state
 * frame with non-decreasing ticks, every event a well-formed ServerEvent on an existing
 * frame, in order. Anything else (including a compressed replay; use unpackReplay) → null.
 */
export function decodeReplay(bytes: Uint8Array): Replay | null {
  try {
    if (bytes.length < HEADER + 27 + 4) return null;
    for (let i = 0; i < 4; i++) if (bytes[i] !== REPLAY_MAGIC[i]) return null;
    if (bytes[4] !== REPLAY_VERSION || bytes[5] !== 0) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = HEADER;
    const kind = KINDS[dv.getUint8(o)]; o += 1;
    if (!kind) return null;
    const levelId = dv.getUint16(o, true); o += 2;
    const levelVersion = dv.getUint16(o, true); o += 2;
    const run = dv.getUint32(o, true); o += 4;
    const deaths = dv.getUint32(o, true); o += 4;
    const progress = dv.getFloat64(o, true); o += 8;
    if (!(progress >= 0 && progress <= 1)) return null;
    const n = dv.getUint32(o, true); o += 4;
    if (n === 0 || n > MAX_REPLAY_FRAMES) return null;
    const frames: Uint8Array[] = [];
    let lastTick = -1;
    for (let i = 0; i < n; i++) {
      if (o + 2 > bytes.length) return null;
      const len = dv.getUint16(o, true); o += 2;
      if (o + len > bytes.length) return null;
      const f = bytes.slice(o, o + len); o += len;
      if (f[0] !== MSG_STATE || !decodeFrame(f)) return null;
      const tick = frameTick(f);
      if (tick < lastTick) return null;
      lastTick = tick;
      frames.push(f);
    }
    if (o + 4 > bytes.length) return null;
    const jlen = dv.getUint32(o, true); o += 4;
    if (jlen > MAX_EVENTS_BYTES || o + jlen !== bytes.length) return null;
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(o, o + jlen)));
    if (!Array.isArray(raw) || raw.length > MAX_EVENTS) return null;
    const events: ReplayEvent[] = [];
    let lastIndex = 0;
    for (const item of raw) {
      if (!Array.isArray(item) || item.length !== 2) return null;
      const [frameIndex, event] = item as [unknown, unknown];
      if (!isIndex(frameIndex) || frameIndex >= n || frameIndex < lastIndex || !isServerEvent(event)) return null;
      lastIndex = frameIndex;
      events.push({ frameIndex, event });
    }
    return { version: 1, levelId, levelVersion, kind, run, deaths, progress, frames, events };
  } catch {
    return null;
  }
}

/** Encodes and, where CompressionStream exists (browsers, Node 18+), deflates the body. */
export async function packReplay(r: Replay): Promise<Uint8Array<ArrayBuffer>> {
  const raw = encodeReplay(r);
  if (typeof CompressionStream === 'undefined') return raw;
  try {
    const body = await pipe(raw.subarray(HEADER), new CompressionStream('deflate'), Infinity);
    if (!body || body.length >= raw.length - HEADER) return raw;
    const out = new Uint8Array(HEADER + body.length);
    out.set(raw.subarray(0, HEADER));
    out[5] = FLAG_DEFLATE;
    out.set(body, HEADER);
    return out;
  } catch {
    return raw;
  }
}

/** Decodes a packed (deflated) or plain replay; null for anything invalid or undecodable here. */
export async function unpackReplay(bytes: Uint8Array): Promise<Replay | null> {
  if (bytes.length < HEADER || bytes[4] !== REPLAY_VERSION) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== REPLAY_MAGIC[i]) return null;
  if (bytes[5] === 0) return decodeReplay(bytes);
  if (bytes[5] !== FLAG_DEFLATE || typeof DecompressionStream === 'undefined') return null;
  try {
    const body = await pipe(bytes.subarray(HEADER), new DecompressionStream('deflate'), MAX_RAW_BYTES);
    if (!body) return null;
    const raw = new Uint8Array(HEADER + body.length);
    raw.set(bytes.subarray(0, HEADER));
    raw[5] = 0;
    raw.set(body, HEADER);
    return decodeReplay(raw);
  } catch {
    return null;
  }
}

/** Runs bytes through a (de)compression stream; null past `limit` output bytes. */
async function pipe(input: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array | null> {
  const writer = stream.writable.getWriter();
  const done = writer.write(input.slice()).then(() => writer.close());
  done.catch(() => {});
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    total += value.length;
    if (total > limit) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  await done;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- validation ------------------------------------------------------------------------

const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isCount = isIndex;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isFrac = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;
const isRecord = (v: unknown): boolean =>
  v === null || (typeof v === 'object' && isFrac((v as { progress?: unknown }).progress) && isCount((v as { run?: unknown }).run));

const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= 80;
const isClipId = (v: unknown): boolean => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function isWin(e: Record<string, unknown>): boolean {
  return e.t === 'win' && isCount(e.levelId) && isCount(e.run) && isCount(e.deaths) && isNum(e.durationS) && e.durationS >= 0
    && isCount(e.peakPlayers) && (e.clipId === null || isClipId(e.clipId));
}

function isCelebrating(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as { win?: unknown; ageS?: unknown };
  return typeof c.win === 'object' && c.win !== null && isWin(c.win as Record<string, unknown>) && isNum(c.ageS) && c.ageS >= 0;
}

/** True for a structurally valid ServerEvent (no extra trust beyond shape and ranges). */
export function isServerEvent(v: unknown): v is ServerEvent {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  switch (e.t) {
    case 'welcome':
      return isCount(e.levelId) && isCount(e.version) && isCount(e.deaths) && isRecord(e.record) && isCount(e.run) && isCount(e.zone) && isCount(e.online)
        && (e.name === undefined || isName(e.name)) && (e.encore === undefined || typeof e.encore === 'boolean')
        && (e.celebrating === undefined || isCelebrating(e.celebrating))
        && (e.checkpoint === undefined || isCount(e.checkpoint));
    case 'death':
      return isCount(e.run) && typeof e.cause === 'string' && CAUSES.includes(e.cause) && isFrac(e.progress) && isCount(e.deaths)
        && isCount(e.zone) && typeof e.nearRecord === 'boolean' && (e.checkpoint === undefined || isCount(e.checkpoint));
    case 'zone':
      return isCount(e.run) && isCount(e.index) && typeof e.name === 'string' && e.name.length <= 80;
    case 'record':
      return isCount(e.run) && isFrac(e.progress);
    case 'reset':
      return isCount(e.run) && (e.checkpoint === undefined || isCount(e.checkpoint)) && (e.zone === undefined || isCount(e.zone));
    case 'checkpoint':
      return isCount(e.run) && isCount(e.index) && isFrac(e.progress);
    case 'names':
      return Array.isArray(e.names) && e.names.length <= 255 && e.names.every((n) => Array.isArray(n) && n.length === 2 && isCount(n[0]) && typeof n[1] === 'string' && n[1].length <= 64);
    case 'clip':
      return isClipId(e.id) && KINDS.includes(e.kind as ReplayKind) && isCount(e.run);
    case 'win':
      return isWin(e);
    case 'level':
      return isCount(e.levelId) && isCount(e.version) && isName(e.name) && typeof e.encore === 'boolean';
    default:
      return false;
  }
}

// ---- recorder ----------------------------------------------------------------------------

export interface RecorderOptions {
  levelId: number;
  levelVersion: number;
  /** Longest window a snapshot may ask for (s). Default 60 (a win). */
  maxSeconds?: number;
}

interface WorldState { deaths: number; record: { progress: number; run: number } | null; run: number; zone: number }
interface Entry { bytes: Uint8Array; tick: number; events: ServerEvent[]; before: WorldState }

/**
 * Ring buffer of the last `maxSeconds` of broadcast state frames and the events between
 * them, for the sim to snapshot into a Replay when a clip is triggered. Pure: no timers, no
 * I/O. Push every broadcast frame together with the events emitted since the previous one
 * (a 'welcome' event only updates what the recorder knows about the world).
 *
 * Snapshot a death clip when the dying hold ends (on 'reset') so it includes the death beat
 * and the card; snapshot a win right away.
 */
export class ReplayRecorder {
  private readonly ring: (Entry | undefined)[];
  private head = 0;
  private count = 0;
  private readonly windowTicks: number;
  private state: WorldState = { deaths: 0, record: null, run: 0, zone: 0 };
  private lastDeath: { run: number; progress: number } | null = null;

  constructor(private readonly opts: RecorderOptions) {
    const seconds = opts.maxSeconds ?? 60;
    this.windowTicks = Math.ceil(seconds * TICK_HZ);
    this.ring = new Array(this.windowTicks + 1);
  }

  /** Frames currently held. */
  get size(): number { return this.count; }

  clear(): void {
    this.ring.fill(undefined);
    this.head = this.count = 0;
  }

  push(frame: Uint8Array, events: readonly ServerEvent[] = []): void {
    if (frame.length < 46 || frame[0] !== MSG_STATE) throw new Error('not a state frame');
    const tick = frameTick(frame);
    // A welcome describes the world as of now, so it counts toward the state before this frame.
    let before = { ...this.state };
    const kept: ServerEvent[] = [];
    for (const e of events) {
      this.apply(e);
      if (e.t === 'names') continue; // who is on the dots is live information, not part of a clip
      if (e.t !== 'welcome') kept.push(e);
      else if (kept.length === 0) before = { ...this.state };
    }
    // evict what fell out of the window
    while (this.count > 0) {
      const oldest = this.ring[(this.head - this.count + this.ring.length) % this.ring.length]!;
      if (oldest.tick > tick - this.windowTicks && this.count < this.ring.length) break;
      this.ring[(this.head - this.count + this.ring.length) % this.ring.length] = undefined;
      this.count--;
    }
    this.ring[this.head] = { bytes: frame.slice(), tick, events: kept, before };
    this.head = (this.head + 1) % this.ring.length;
    this.count++;
  }

  private apply(e: ServerEvent): void {
    const s = this.state;
    switch (e.t) {
      case 'welcome':
        this.state = { deaths: e.deaths, record: e.record ? { ...e.record } : null, run: e.run, zone: e.zone };
        break;
      case 'death':
        s.deaths = e.deaths;
        s.run = e.run;
        this.lastDeath = { run: e.run, progress: e.progress };
        break;
      case 'record':
        s.record = { progress: e.progress, run: e.run };
        break;
      case 'reset':
        s.run = e.run;
        s.zone = e.zone ?? 0;
        break;
      case 'zone':
        s.zone = Math.max(s.zone, e.index);
        break;
    }
  }

  /**
   * The last `seconds` of frames as a Replay (null when empty). The clip's run and progress
   * are its last death's unless given; a win without a death is the current run at 100%.
   */
  snapshot(kind: ReplayKind, seconds: number, meta: { run?: number; progress?: number } = {}): Replay | null {
    if (this.count === 0) return null;
    const all: Entry[] = [];
    for (let i = this.count; i > 0; i--) all.push(this.ring[(this.head - i + this.ring.length) % this.ring.length]!);
    const last = all[all.length - 1]!.tick;
    const from = last - Math.ceil(seconds * TICK_HZ);
    const kept = all.filter((e) => e.tick > from);
    const first = kept[0]!;
    const online = new DataView(first.bytes.buffer, first.bytes.byteOffset).getUint32(29, true);
    const events: ReplayEvent[] = [{
      frameIndex: 0,
      event: { t: 'welcome', levelId: this.opts.levelId, version: this.opts.levelVersion, deaths: first.before.deaths, record: first.before.record, run: first.before.run, zone: first.before.zone, online },
    }];
    let death: { run: number; progress: number } | null = null;
    kept.forEach((e, i) => {
      for (const ev of e.events) {
        events.push({ frameIndex: i, event: ev });
        if (ev.t === 'death') death = { run: ev.run, progress: ev.progress };
      }
    });
    const d = death as { run: number; progress: number } | null;
    return {
      version: 1,
      levelId: this.opts.levelId,
      levelVersion: this.opts.levelVersion,
      kind,
      run: meta.run ?? d?.run ?? this.state.run,
      progress: meta.progress ?? d?.progress ?? (kind === 'win' ? 1 : this.lastDeath?.progress ?? 0),
      deaths: this.state.deaths,
      frames: kept.map((e) => e.bytes),
      events,
    };
  }
}
