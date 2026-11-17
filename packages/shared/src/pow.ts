/**
 * Hashcash-style proof of work for session tokens (spec §8): find a nonce so that
 * SHA-256(challenge + ":" + nonce) starts with `bits` zero bits.
 *
 * The browser has no synchronous SHA-256 (WebCrypto is async and costs ~50 µs per call on
 * a phone), so this is a small allocation-free pure-JS implementation. One hash of a short
 * message costs about 1 µs on a desktop core and 3-6 µs on a phone, so 2^bits tries is the
 * expected cost: 14 bits ≈ 15-25 ms on a laptop, ≈ 50-150 ms on a phone.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
const H = new Uint32Array(8);

function block(m: Uint8Array, off: number): void {
  for (let i = 0; i < 16; i++) {
    const j = off + i * 4;
    W[i] = (m[j]! << 24) | (m[j + 1]! << 16) | (m[j + 2]! << 8) | m[j + 3]!;
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15]!, b = W[i - 2]!;
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
  }
  let a = H[0]!, b = H[1]!, c = H[2]!, d = H[3]!, e = H[4]!, f = H[5]!, g = H[6]!, h = H[7]!;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  H[0] = H[0]! + a; H[1] = H[1]! + b; H[2] = H[2]! + c; H[3] = H[3]! + d;
  H[4] = H[4]! + e; H[5] = H[5]! + f; H[6] = H[6]! + g; H[7] = H[7]! + h;
}

/** Hashes `msg[0..len)` (msg must have room for padding: len + 72 bytes); result left in H. */
function digestInto(msg: Uint8Array, len: number): void {
  H.set([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const total = Math.ceil((len + 9) / 64) * 64;
  msg[len] = 0x80;
  msg.fill(0, len + 1, total);
  const bits = len * 8;
  msg[total - 4] = bits >>> 24; msg[total - 3] = bits >>> 16; msg[total - 2] = bits >>> 8; msg[total - 1] = bits;
  msg[total - 5] = Math.floor(bits / 2 ** 32);
  for (let off = 0; off < total; off += 64) block(msg, off);
}

function wordsToBytes(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = H[i]! >>> 24; out[i * 4 + 1] = H[i]! >>> 16; out[i * 4 + 2] = H[i]! >>> 8; out[i * 4 + 3] = H[i]!;
  }
  return out;
}

/** SHA-256 of `data`. */
export function sha256(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(data.length + 72);
  buf.set(data);
  digestInto(buf, data.length);
  return wordsToBytes();
}

/** Number of leading zero bits of a byte string. */
export function leadingZeroBits(h: Uint8Array): number {
  let n = 0;
  for (const byte of h) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

/** Leading zero bits of the current H words (avoids building a byte array in the hot loop). */
function zeroBitsOfH(): number {
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const w = H[i]!;
    if (w === 0) { n += 32; continue; }
    return n + Math.clz32(w);
  }
  return n;
}

const enc = new TextEncoder();

/** Writes `${challenge}:` into a reusable buffer; returns [buffer, prefix length]. */
function prefixed(challenge: string): [Uint8Array, number] {
  const p = enc.encode(`${challenge}:`);
  const buf = new Uint8Array(p.length + 16 + 72);
  buf.set(p);
  return [buf, p.length];
}

/** Appends the decimal digits of `n` at `at`; returns the new length. */
function writeDecimal(buf: Uint8Array, at: number, n: number): number {
  if (n === 0) { buf[at] = 48; return at + 1; }
  let digits = 0;
  for (let v = n; v > 0; v = Math.floor(v / 10)) digits++;
  for (let i = digits - 1, v = n; i >= 0; i--, v = Math.floor(v / 10)) buf[at + i] = 48 + (v % 10);
  return at + digits;
}

/** True when SHA-256(`challenge:nonce`) has at least `bits` leading zero bits. */
export function powOk(challenge: string, nonce: number, bits: number): boolean {
  if (bits <= 0) return true;
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;
  const [buf, p] = prefixed(challenge);
  digestInto(buf, writeDecimal(buf, p, nonce));
  return zeroBitsOfH() >= bits;
}

/**
 * Finds the smallest nonce from `start` on that satisfies `bits`; -1 if none within `maxTries`
 * (so a browser can search in slices between frames: start, start + slice, ...).
 */
export function solvePow(challenge: string, bits: number, maxTries = 2 ** 30, start = 0): number {
  if (bits <= 0) return 0;
  const [buf, p] = prefixed(challenge);
  for (let n = start; n < start + maxTries; n++) {
    digestInto(buf, writeDecimal(buf, p, n));
    if (zeroBitsOfH() >= bits) return n;
  }
  return -1;
}
