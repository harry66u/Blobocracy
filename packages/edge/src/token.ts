import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { powOk } from '@blobocracy/shared';

/**
 * Session tokens (spec §8). The page asks an edge for a challenge (GET /session), solves a small
 * proof of work in the browser and trades the answer for a token (POST /session). Everything is
 * HMAC-signed with SESSION_SECRET, so any edge can check any other edge's challenges and tokens
 * without shared state; checking costs one SHA-256 and one HMAC.
 *
 * The token carries an anonymous session id: one live socket per session id (a new socket
 * replaces the old one), so every socket costs its own proof of work, and it is the key a
 * future nickname table attaches to (§9).
 */
export interface Session { sid: string; exp: number }

export interface SessionOptions {
  secret: string;
  /** Leading zero bits required; 0 disables the work (dev and load tests only). */
  powBits: number;
  tokenTtlS?: number;
  challengeTtlS?: number;
  now?: () => number;
}

const b64u = (b: Buffer) => b.toString('base64url');

export class SessionAuthority {
  readonly powBits: number;
  private readonly tokenTtlMs: number;
  private readonly challengeTtlMs: number;
  private readonly now: () => number;
  /** Challenges already redeemed on this edge, until they expire. */
  private used = new Map<string, number>();

  constructor(private opts: SessionOptions) {
    if (!opts.secret) throw new Error('SessionAuthority needs a secret');
    this.powBits = Math.max(0, Math.floor(opts.powBits));
    this.tokenTtlMs = (opts.tokenTtlS ?? 600) * 1000;
    this.challengeTtlMs = (opts.challengeTtlS ?? 60) * 1000;
    this.now = opts.now ?? Date.now;
  }

  private sign(body: string): string {
    return b64u(createHmac('sha256', this.opts.secret).update(body).digest().subarray(0, 18));
  }

  private signedOk(body: string, sig: string): boolean {
    const want = Buffer.from(this.sign(body));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** `c1.<bits>.<expMs>.<random>.<sig>`: solve SHA-256(challenge + ":" + nonce) with `bits` zero bits. */
  challenge(): { challenge: string; bits: number; exp: number } {
    const exp = this.now() + this.challengeTtlMs;
    const body = `c1.${this.powBits}.${exp}.${b64u(randomBytes(12))}`;
    return { challenge: `${body}.${this.sign(body)}`, bits: this.powBits, exp };
  }

  redeem(challenge: string, nonce: number): { token: string; sid: string; exp: number } | { error: 'sig' | 'expired' | 'pow' | 'used' } {
    const parts = typeof challenge === 'string' ? challenge.split('.') : [];
    if (parts.length !== 5 || parts[0] !== 'c1') return { error: 'sig' };
    const body = parts.slice(0, 4).join('.');
    if (!this.signedOk(body, parts[4]!)) return { error: 'sig' };
    const bits = Number(parts[1]), exp = Number(parts[2]);
    const now = this.now();
    if (!(exp > now)) return { error: 'expired' };
    if (!powOk(challenge, nonce, bits)) return { error: 'pow' };
    this.prune(now);
    if (this.used.has(challenge)) return { error: 'used' };
    this.used.set(challenge, exp);
    const sid = b64u(randomBytes(16)).slice(0, 22);
    const tokenExp = now + this.tokenTtlMs;
    const tbody = `s1.${sid}.${tokenExp}`;
    return { token: `${tbody}.${this.sign(tbody)}`, sid, exp: tokenExp };
  }

  verify(token: string): Session | null {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 4 || parts[0] !== 's1') return null;
    const body = parts.slice(0, 3).join('.');
    if (!this.signedOk(body, parts[3]!)) return null;
    const exp = Number(parts[2]);
    if (!(exp > this.now())) return null;
    return { sid: parts[1]!, exp };
  }

  private prune(now: number): void {
    if (this.used.size < 1024) return;
    for (const [c, exp] of this.used) if (exp <= now) this.used.delete(c);
  }
}
