/**
 * The internal link between edge relays and the sim (spec §4, §5), over Fly's private network.
 *
 * Relay → sim: a binary input summary (LINK_SUMMARY) whenever it changes (at most 60/s, plus a
 * 1 s keepalive carrying the egress counter), and JSON control text (hello, stats, admin requests).
 * Sim → relay: each encoded state frame (MSG_STATE bytes, forwarded byte-for-byte to players),
 * world events as the exact JSON text players receive, and JSON control text (`{"c":...}`).
 */
import type { ServerEvent } from './protocol';

export const LINK_SUMMARY = 20;
/** The sim hands out at most 128 crowd slots, so no relay ever needs to sample more. */
export const MAX_LINK_SAMPLE = 128;
/** Spec §5: by default a relay samples up to 32 of its players for the crowd dots. */
export const DEFAULT_LINK_SAMPLE = 32;

export interface WeightedCounts { left: number; right: number; jump: number; active: number; fresh: number }
export interface SampleEntry { /** Stable 16-bit id of this sampled player on its relay. */ id: number; bits: number }

export interface RelaySummary {
  seq: number;
  /** Counts after abuse weighting (§8): what the blend uses. */
  weighted: WeightedCounts;
  /** Active players by raw input state (index = bits 0..7), unweighted. */
  buckets: number[];
  connections: number;
  watchers: number;
  /** Bytes sent to players since the previous summary (for the budget governor). */
  bytesSent: number;
  /** Epoch ms of the oldest input change folded into this summary (0: none); latency diagnostics. */
  oldestInputAt: number;
  sample: SampleEntry[];
}

const HEAD = 82;
const ENTRY = 3;

export function encodeSummary(s: RelaySummary): Uint8Array<ArrayBuffer> {
  if (s.sample.length > MAX_LINK_SAMPLE) throw new Error(`sample too big: ${s.sample.length}`);
  const out = new Uint8Array(HEAD + s.sample.length * ENTRY);
  const dv = new DataView(out.buffer);
  out[0] = LINK_SUMMARY;
  dv.setUint32(1, s.seq >>> 0, true);
  const w = s.weighted;
  [w.left, w.right, w.jump, w.active, w.fresh].forEach((v, i) => dv.setFloat32(5 + i * 4, v, true));
  for (let i = 0; i < 8; i++) dv.setUint32(25 + i * 4, (s.buckets[i] ?? 0) >>> 0, true);
  dv.setUint32(57, s.connections >>> 0, true);
  dv.setUint32(61, s.watchers >>> 0, true);
  dv.setFloat64(65, s.bytesSent, true);
  dv.setFloat64(73, s.oldestInputAt, true);
  out[81] = s.sample.length;
  s.sample.forEach((e, i) => {
    dv.setUint16(HEAD + i * ENTRY, e.id & 0xffff, true);
    out[HEAD + i * ENTRY + 2] = e.bits & 7;
  });
  return out;
}

export function decodeSummary(buf: ArrayBuffer): RelaySummary | null {
  const u8 = new Uint8Array(buf);
  if (u8.length < HEAD || u8[0] !== LINK_SUMMARY) return null;
  const n = u8[81]!;
  if (n > MAX_LINK_SAMPLE || u8.length !== HEAD + n * ENTRY) return null;
  const dv = new DataView(buf);
  const f = (i: number) => dv.getFloat32(5 + i * 4, true);
  const sample: SampleEntry[] = [];
  for (let i = 0; i < n; i++) {
    const bits = u8[HEAD + i * ENTRY + 2]!;
    if (bits > 7) return null;
    sample.push({ id: dv.getUint16(HEAD + i * ENTRY, true), bits });
  }
  const weighted = { left: f(0), right: f(1), jump: f(2), active: f(3), fresh: f(4) };
  if (Object.values(weighted).some((v) => !Number.isFinite(v) || v < 0)) return null;
  return {
    seq: dv.getUint32(1, true),
    weighted,
    buckets: Array.from({ length: 8 }, (_, i) => dv.getUint32(25 + i * 4, true)),
    connections: dv.getUint32(57, true),
    watchers: dv.getUint32(61, true),
    bytesSent: dv.getFloat64(65, true),
    oldestInputAt: dv.getFloat64(73, true),
    sample,
  };
}

/** Budget tier (§10): 0 normal, 70 reduced frame rate, 90 watchers, 100 packed. */
export type Tier = 0 | 70 | 90 | 100;

/** Sim → relay control. */
export type SimControl =
  | { c: 'policy'; tier: Tier; frameHz: number; alwaysOn: boolean; sampleQuota: number; capacity: number }
  | { c: 'welcome'; ev: ServerEvent }
  | { c: 'bans'; cidrs: string[] }
  | { c: 'resetFlags' }
  | { c: 'adminRes'; id: number; status: number; body: unknown };

/** Relay → sim control. */
export type RelayControl =
  | { c: 'hello'; name: string; alwaysOn?: boolean; hourlyUsd?: number }
  | { c: 'stats'; stats: Record<string, unknown> }
  | { c: 'admin'; id: number; method: string; path: string; auth: string; body: string };

export type LinkControl = SimControl | RelayControl;

const KINDS = new Set(['policy', 'welcome', 'bans', 'resetFlags', 'adminRes', 'hello', 'stats', 'admin']);

/** Control text starts with `{"c":`; anything else on the link is a world event for players. */
export function isControlText(text: string): boolean {
  return text.startsWith('{"c":');
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const TIERS = new Set([0, 70, 90, 100]);

/** Every field a relay acts on is present and of the right type (a malformed message is dropped, never thrown on). */
export function validSimControl(c: LinkControl): c is SimControl {
  const m = c as Record<string, unknown>;
  switch (c.c) {
    case 'policy':
      return TIERS.has(m.tier as number) && num(m.frameHz) && typeof m.alwaysOn === 'boolean' && num(m.sampleQuota) && num(m.capacity);
    case 'welcome':
      return typeof m.ev === 'object' && m.ev !== null && typeof (m.ev as { t?: unknown }).t === 'string';
    case 'bans':
      return Array.isArray(m.cidrs) && m.cidrs.every((x) => typeof x === 'string');
    case 'resetFlags':
      return true;
    case 'adminRes':
      return num(m.id) && num(m.status) && (m.status as number) >= 100 && (m.status as number) < 600;
    default:
      return false;
  }
}

export function parseControl(text: string): LinkControl | null {
  if (!isControlText(text)) return null;
  try {
    const m = JSON.parse(text) as { c?: unknown };
    return typeof m.c === 'string' && KINDS.has(m.c) ? (m as LinkControl) : null;
  } catch {
    return null;
  }
}
