import { describe, expect, test } from 'vitest';
import { solvePow } from '@blobocracy/shared';
import { SessionAuthority } from '../src/token';

function setup(bits = 8, secret = 'test-secret') {
  let t = 1_763_400_000_000;
  const auth = new SessionAuthority({ secret, powBits: bits, tokenTtlS: 600, challengeTtlS: 60, now: () => t });
  return { auth, advance: (ms: number) => { t += ms; } };
}

function mint(auth: SessionAuthority) {
  const c = auth.challenge();
  const r = auth.redeem(c.challenge, solvePow(c.challenge, c.bits));
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('session tokens with proof of work', () => {
  test('solve the challenge, get a token that verifies and carries an anonymous session id', () => {
    const { auth } = setup();
    const c = auth.challenge();
    expect(c.bits).toBe(8);
    const r = mint(auth);
    expect(r.sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(auth.verify(r.token)).toMatchObject({ sid: r.sid });
  });

  test('a wrong nonce, a forged difficulty or a reused challenge earns nothing', () => {
    const { auth } = setup(12);
    const c = auth.challenge();
    const n = solvePow(c.challenge, 12);
    let bad = n + 1;
    while (solvePow(c.challenge, 12, bad + 1) === bad) bad++; // find a nonce that does not solve it
    expect(auth.redeem(c.challenge, bad)).toEqual({ error: 'pow' });
    const easier = c.challenge.replace(/^c1\.12\./, 'c1.0.');
    expect(auth.redeem(easier, 0)).toEqual({ error: 'sig' });
    expect('token' in auth.redeem(c.challenge, n)).toBe(true);
    expect(auth.redeem(c.challenge, n)).toEqual({ error: 'used' });
  });

  test('challenges and tokens are short-lived', () => {
    const { auth, advance } = setup();
    const c = auth.challenge();
    advance(61_000);
    expect(auth.redeem(c.challenge, solvePow(c.challenge, c.bits))).toEqual({ error: 'expired' });
    const r = mint(auth);
    advance(599_000);
    expect(auth.verify(r.token)).not.toBeNull();
    advance(2_000);
    expect(auth.verify(r.token)).toBeNull();
  });

  test('tampered tokens and tokens signed with another secret are rejected', () => {
    const a = setup(4, 'secret-a').auth;
    const b = setup(4, 'secret-b').auth;
    const r = mint(a);
    expect(b.verify(r.token)).toBeNull();
    const parts = r.token.split('.');
    parts[1] = 'A'.repeat(22);
    expect(a.verify(parts.join('.'))).toBeNull();
    expect(a.verify('')).toBeNull();
    expect(a.verify('garbage.token')).toBeNull();
  });

  test('any edge sharing SESSION_SECRET accepts the token', () => {
    const a = setup(4, 'shared').auth;
    const b = setup(4, 'shared').auth;
    expect(b.verify(mint(a).token)).not.toBeNull();
  });

  test('difficulty 0 (dev/load tests) needs no work', () => {
    const { auth } = setup(0);
    const c = auth.challenge();
    expect('token' in auth.redeem(c.challenge, 0)).toBe(true);
  });
});
