import { describe, expect, test } from 'vitest';
import {
  LINK_SUMMARY, MAX_LINK_SAMPLE, decodeSummary, encodeSummary, isControlText, parseControl, type RelaySummary,
} from '../src/link';
import { MSG_STATE } from '../src/protocol';

const summary = (over: Partial<RelaySummary> = {}): RelaySummary => ({
  seq: 7,
  weighted: { left: 1.5, right: 3.25, jump: 0.5, active: 6, fresh: 0.25 },
  buckets: [1, 2, 3, 0, 0, 0, 4, 0],
  connections: 12, watchers: 3,
  bytesSent: 123456789.5,
  oldestInputAt: 1763400000123.25,
  sample: [{ id: 0, bits: 0 }, { id: 65535, bits: 7 }, { id: 300, bits: 2 }],
  ...over,
});

describe('relay → sim summary', () => {
  test('round-trips every field', () => {
    const s = summary();
    const enc = encodeSummary(s);
    expect(enc[0]).toBe(LINK_SUMMARY);
    expect(decodeSummary(enc.buffer)).toEqual(s);
  });

  test('carries up to 128 sample entries; more throws', () => {
    const sample = Array.from({ length: MAX_LINK_SAMPLE }, (_, i) => ({ id: i * 3, bits: i & 7 }));
    expect(decodeSummary(encodeSummary(summary({ sample })).buffer)?.sample).toEqual(sample);
    expect(() => encodeSummary(summary({ sample: [...sample, { id: 1, bits: 1 }] }))).toThrow();
  });

  test('weighted counts are float32 (fractional weights from the per-IP cap survive)', () => {
    const d = decodeSummary(encodeSummary(summary({ weighted: { left: 1 / 3, right: 0, jump: 0, active: 1 / 3, fresh: 0 } })).buffer)!;
    expect(d.weighted.left).toBeCloseTo(1 / 3, 6);
  });

  test('garbage, truncation and the wrong type decode to null', () => {
    const enc = encodeSummary(summary());
    expect(decodeSummary(enc.slice(0, enc.length - 1).buffer)).toBeNull();
    expect(decodeSummary(new Uint8Array([MSG_STATE, 1, 2, 3]).buffer)).toBeNull();
    expect(decodeSummary(new ArrayBuffer(0))).toBeNull();
    const bad = enc.slice(); bad[bad.length - 1] = 9; // bits > 7
    expect(decodeSummary(bad.buffer)).toBeNull();
  });
});

describe('control messages', () => {
  test('control text is told apart from forwarded events', () => {
    expect(isControlText('{"c":"policy","tier":0}')).toBe(true);
    expect(isControlText('{"t":"death","run":1}')).toBe(false);
  });

  test('parseControl accepts known shapes and rejects junk', () => {
    expect(parseControl('{"c":"bans","cidrs":["10.0.0.0/8"]}')).toEqual({ c: 'bans', cidrs: ['10.0.0.0/8'] });
    expect(parseControl('{"c":"nope"}')).toBeNull();
    expect(parseControl('not json')).toBeNull();
    expect(parseControl('{"t":"death"}')).toBeNull();
  });
});
