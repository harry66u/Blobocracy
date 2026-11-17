import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { leadingZeroBits, powOk, sha256, solvePow } from '../src/pow';

const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
const nodeSha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('sha256 (pure JS, for the browser)', () => {
  test('matches node:crypto on known and random inputs, across block boundaries', () => {
    expect(hex(sha256(new TextEncoder().encode('')))).toBe(nodeSha(''));
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe(nodeSha('abc'));
    for (const len of [1, 31, 55, 56, 63, 64, 65, 119, 120, 200]) {
      const s = 'x'.repeat(len);
      expect(hex(sha256(new TextEncoder().encode(s)))).toBe(nodeSha(s));
    }
  });
});

describe('proof of work', () => {
  test('leadingZeroBits counts across bytes', () => {
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(leadingZeroBits(new Uint8Array([0, 0x10]))).toBe(11);
    expect(leadingZeroBits(new Uint8Array([0, 0]))).toBe(16);
  });

  test('a solved nonce verifies; a wrong nonce or challenge does not', () => {
    const ch = 'v1.10.1700000000000.abc.sig';
    const nonce = solvePow(ch, 10);
    expect(powOk(ch, nonce, 10)).toBe(true);
    // The proof is SHA-256(challenge + ":" + nonce), checkable with node:crypto too.
    const h = Buffer.from(nodeSha(`${ch}:${nonce}`), 'hex');
    expect(leadingZeroBits(h)).toBeGreaterThanOrEqual(10);
    expect(powOk(ch + 'x', nonce, 10) && powOk(ch, nonce + 1, 10)).toBe(false);
  });

  test('difficulty 0 accepts any nonce immediately', () => {
    expect(solvePow('anything', 0)).toBe(0);
    expect(powOk('anything', 12345, 0)).toBe(true);
  });

  test('gives up after maxTries and returns -1', () => {
    expect(solvePow('c', 40, 100)).toBe(-1);
  });
});
