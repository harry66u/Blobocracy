import { describe, expect, test } from 'vitest';
import { BanList, clientIp, ipKey, parseCidr } from '../src/ip';

describe('client IP', () => {
  test('uses Fly-Client-IP when present, else the socket address', () => {
    expect(clientIp({ flyClientIp: '203.0.113.9' }, '172.16.0.2', false)).toBe('203.0.113.9');
    expect(clientIp({}, '198.51.100.7', false)).toBe('198.51.100.7');
    expect(clientIp({ flyClientIp: '' }, '0000:0000:0000:0000:0000:ffff:c633:6407', false)).toBe('198.51.100.7');
  });

  test('the test-only IP header is honored only when trusted', () => {
    expect(clientIp({ testIp: '10.1.2.3' }, '127.0.0.1', false)).toBe('127.0.0.1');
    expect(clientIp({ testIp: '10.1.2.3' }, '127.0.0.1', true)).toBe('10.1.2.3');
    expect(clientIp({ testIp: 'not an ip' }, '127.0.0.1', true)).toBe('127.0.0.1');
  });

  test('IPv6 clients are grouped by /64 (one household), IPv4 by address', () => {
    expect(ipKey('2001:db8:1:2:aaaa::1')).toBe(ipKey('2001:db8:1:2:bbbb::9'));
    expect(ipKey('2001:db8:1:3::1')).not.toBe(ipKey('2001:db8:1:2::1'));
    expect(ipKey('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('bans by IP or CIDR', () => {
  test('parses IPv4 and IPv6 CIDRs and bare addresses', () => {
    expect(parseCidr('10.0.0.0/8')).not.toBeNull();
    expect(parseCidr('2001:db8::/32')).not.toBeNull();
    expect(parseCidr('1.2.3.4')).not.toBeNull();
    expect(parseCidr('1.2.3.4/33')).toBeNull();
    expect(parseCidr('nope')).toBeNull();
  });

  test('matches addresses inside a range only', () => {
    const b = new BanList();
    b.add('10.0.0.0/8');
    b.add('2001:db8::/32');
    b.add('192.0.2.1');
    expect(b.has('10.200.3.4')).toBe(true);
    expect(b.has('11.0.0.1')).toBe(false);
    expect(b.has('2001:db8:ffff::1')).toBe(true);
    expect(b.has('2001:db9::1')).toBe(false);
    expect(b.has('192.0.2.1')).toBe(true);
    expect(b.has('192.0.2.2')).toBe(false);
    b.remove('10.0.0.0/8');
    expect(b.has('10.200.3.4')).toBe(false);
    expect(b.list()).toEqual(['2001:db8::/32', '192.0.2.1/32']);
  });

  test('replace() swaps the whole list (the sim pushes the authoritative list)', () => {
    const b = new BanList();
    b.add('1.1.1.1');
    b.replace(['2.2.2.0/24']);
    expect(b.has('1.1.1.1')).toBe(false);
    expect(b.has('2.2.2.9')).toBe(true);
  });
});
