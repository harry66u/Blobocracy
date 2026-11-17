import { isIP } from 'node:net';

/**
 * Who a connection is, for the per-IP caps and bans. Behind Fly's proxy the socket address
 * is the proxy, so the real client comes from the `Fly-Client-IP` header. Load tests simulate
 * many IPs with `x-test-ip`, honored only when TRUST_TEST_IP_HEADER=1 (never in production).
 */
export function clientIp(h: { flyClientIp?: string; testIp?: string }, socketAddr: string, trustTestHeader: boolean): string {
  if (trustTestHeader && h.testIp && isIP(h.testIp.trim())) return normalizeIp(h.testIp);
  if (h.flyClientIp && isIP(h.flyClientIp.trim())) return normalizeIp(h.flyClientIp);
  return normalizeIp(socketAddr);
}

/** Lower-cases, and turns IPv4-mapped IPv6 (as uWS reports it) back into IPv4. */
export function normalizeIp(s: string): string {
  const ip = s.trim().toLowerCase();
  if (isIP(ip) === 6) {
    const v = parse6(ip);
    if (v !== null && v >> 32n === 0xffffn) {
      const n = Number(v & 0xffffffffn);
      return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    }
  }
  return ip;
}

/** The unit the per-IP caps apply to: the address for IPv4, the /64 prefix for IPv6 (one home or phone). */
export function ipKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const v = parse6(ip);
  return v === null ? ip : `${(v >> 64n).toString(16)}::/64`;
}

function parse4(s: string): number | null {
  const p = s.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = n * 256 + Number(x);
  }
  return n;
}

function parse6(s: string): bigint | null {
  if (isIP(s) !== 6) return null;
  let str = s;
  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = parse4(v4[1]!);
    if (n === null) return null;
    str = str.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = str.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(parseInt(g || '0', 16));
  return v;
}

export interface Cidr { v: 4 | 6; base: bigint; bits: number; text: string }

export function parseCidr(s: string): Cidr | null {
  const [addr, len] = s.trim().split('/') as [string, string | undefined];
  const kind = isIP(addr);
  if (!kind) return null;
  const max = kind === 4 ? 32 : 128;
  const bits = len === undefined ? max : /^\d+$/.test(len) ? Number(len) : NaN;
  if (!(bits >= 0 && bits <= max)) return null;
  const val = kind === 4 ? BigInt(parse4(addr)!) : parse6(addr);
  if (val === null) return null;
  const mask = maskOf(max, bits);
  return { v: kind as 4 | 6, base: val & mask, bits, text: `${addr.toLowerCase()}/${bits}` };
}

const maskOf = (max: number, bits: number) => (bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits));

function contains(c: Cidr, ip: string): boolean {
  const kind = isIP(ip);
  if (kind !== c.v) return false;
  const v = kind === 4 ? BigInt(parse4(ip)!) : parse6(ip);
  return v !== null && (v & maskOf(kind === 4 ? 32 : 128, c.bits)) === c.base;
}

/** Banned addresses and ranges (admin endpoint, §8). The sim holds the list and pushes it to relays. */
export class BanList {
  private items = new Map<string, Cidr>();

  add(cidr: string): boolean {
    const c = parseCidr(cidr);
    if (!c) return false;
    this.items.set(c.text, c);
    return true;
  }

  remove(cidr: string): boolean {
    const c = parseCidr(cidr);
    return c ? this.items.delete(c.text) : false;
  }

  replace(cidrs: string[]): void {
    this.items.clear();
    for (const c of cidrs) this.add(c);
  }

  has(ip: string): boolean {
    if (this.items.size === 0) return false;
    const n = normalizeIp(ip);
    for (const c of this.items.values()) if (contains(c, n)) return true;
    return false;
  }

  list(): string[] {
    return [...this.items.keys()];
  }
}
