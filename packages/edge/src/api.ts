/**
 * The edge's half of the read API and the link previews.
 *
 * `/api/*` (except /api/counter, which the edge answers from the welcome it already holds) is
 * proxied over HTTP to the sim's internal port: the same host and port as the relay link
 * (SIM_URL ws://…:8081/relay → http://…:8081/api/…). That is simpler and sturdier than
 * multiplexing request/response pairs over the relay WebSocket: plain HTTP semantics, binary
 * clips as-is, and a slow history query never sits in front of state frames. Answers are cached
 * here for as long as the sim's cache-control allows (clips forever, in a bounded LRU), and
 * identical requests in flight share one fetch, so a viral clip link costs the sim one read.
 *
 * The sim is one thread shared with the game loop, so anonymous requests must not be able to
 * keep it busy (review C1): only known routes and parameters are forwarded, normalized into one
 * cache key (junk parameters cannot bust the cache); each IP may cause only a few cache misses
 * per second (TokenBuckets); and at most `maxInflight` fetches run at once, past which a stale
 * copy is served, or a 503.
 */
import { CLIP_ID_RE, LEVELS, trackId } from '@blobocracy/shared';

/** Every track the read API knows (each level, and the encore of the last). */
export const KNOWN_TRACKS: ReadonlySet<number> = new Set([...LEVELS.map((l) => l.id), trackId(LEVELS[LEVELS.length - 1]!.id, true)]);

const intIn = (v: string | null, min: number, max: number): number | null => {
  if (v === null || !/^\d{1,12}$/.test(v)) return null;
  return Math.min(max, Math.max(min, Number(v)));
};

/**
 * The cache key of a read API request: the normalized path of a known route with only the
 * parameters it takes, clamped, defaults dropped, in a fixed order. null: not a read API route
 * (answered 404 by the edge, never forwarded). Paths that normalize outside /api/ are refused.
 */
export function canonicalApi(rawPath: string, query: string, tracks: ReadonlySet<number> = KNOWN_TRACKS): string | null {
  // dot segments (plain or encoded) are never part of a route we serve: refuse them outright (M1)
  if (/\.\.|%2e|\/\//i.test(rawPath)) return null;
  let path: string;
  try { path = new URL(rawPath, 'http://edge').pathname; } catch { return null; }
  if (!path.startsWith('/api/')) return null;
  path = path.replace(/\/+$/, '');
  const q = new URLSearchParams(query);
  const level = () => { const n = intIn(q.get('level'), 0, 1e9); return n !== null && tracks.has(n) ? n : null; };
  const out = (params: [string, string | number | null][]) => {
    const kept = params.filter((p): p is [string, string | number] => p[1] !== null);
    return kept.length ? `${path}?${kept.map(([k, v]) => `${k}=${v}`).join('&')}` : path;
  };
  if (path === '/api/levels' || path === '/api/hall') return path;
  if (path === '/api/summary') return out([['level', level()]]);
  if (path === '/api/runs') {
    const page = intIn(q.get('page'), 1, 100_000), size = intIn(q.get('size'), 1, 100);
    const best = ['1', 'true', 'yes'].includes(q.get('best') ?? '');
    return out([['page', page === 1 ? null : page], ['size', size === 25 ? null : size], ['best', best ? 1 : null], ['level', level()]]);
  }
  const m = path.match(/^\/api\/clips\/([^/]+)(\/meta|\/og\.png)?$/);
  if (m && CLIP_ID_RE.test(m[1]!)) return path;
  return null;
}

/** Per-key token buckets (per IP): `burst` at once, then `perSecond`. */
export class TokenBuckets {
  private b = new Map<string, { tokens: number; at: number }>();
  private readonly perSecond: number;
  private readonly burst: number;
  private readonly now: () => number;

  constructor(o: { perSecond: number; burst: number; now?: () => number }) {
    this.perSecond = o.perSecond;
    this.burst = o.burst;
    this.now = o.now ?? Date.now;
  }

  take(key: string): boolean {
    const now = this.now();
    let e = this.b.get(key);
    if (!e) {
      if (this.b.size >= 100_000) this.prune();
      e = { tokens: this.burst, at: now };
      this.b.set(key, e);
    }
    e.tokens = Math.min(this.burst, e.tokens + ((now - e.at) / 1000) * this.perSecond);
    e.at = now;
    if (e.tokens < 1) return false;
    e.tokens -= 1;
    return true;
  }

  /** Forgets buckets that have refilled (they behave exactly like new ones). */
  prune(): void {
    const now = this.now();
    for (const [k, e] of this.b) if (e.tokens + ((now - e.at) / 1000) * this.perSecond >= this.burst) this.b.delete(k);
  }

  size(): number { return this.b.size; }
}

export interface Cached { status: number; type: string; cache: string; body: Buffer; expires: number }

/** ws://host:port/relay → http://host:port */
export function simHttpBase(simUrl: string): string {
  const u = new URL(simUrl);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '';
  u.search = '';
  return u.toString().replace(/\/$/, '');
}

/** Seconds a response may be reused, from its cache-control (0: not at all). */
export function maxAge(cacheControl: string): number {
  if (/no-store|no-cache|private/.test(cacheControl)) return 0;
  const m = cacheControl.match(/max-age=(\d+)/);
  return m ? Number(m[1]) : 0;
}

const NOT_FOUND = (): Cached => ({ status: 404, type: 'application/json', cache: 'public, max-age=30', expires: 0, body: Buffer.from('{"error":"not found"}') });
const BUSY = (): Cached => ({
  status: 503, type: 'application/json', cache: 'no-store', expires: 0,
  body: Buffer.from(JSON.stringify({ error: 'The history book is busy. Try again in a moment.', busy: true })),
});

export class ApiProxy {
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private inflight = new Map<string, Promise<Cached>>();
  hits = 0;
  misses = 0;
  /** Misses answered stale or 503 because `maxInflight` fetches were already running. */
  shed = 0;

  constructor(private base: string, private o: { maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch; now?: () => number; maxInflight?: number } = {}) {}

  private now() { return (this.o.now ?? Date.now)(); }

  /** True when `get` would have to ask the sim (not cached, not already being fetched). */
  wouldFetch(pathAndQuery: string): boolean {
    const hit = this.cache.get(pathAndQuery);
    return !(hit && hit.expires > this.now()) && !this.inflight.has(pathAndQuery);
  }

  /** `pathAndQuery` like "/api/runs?page=2". */
  async get(pathAndQuery: string): Promise<Cached> {
    let normalized: string;
    try { normalized = new URL(pathAndQuery, 'http://edge').pathname; } catch { normalized = ''; }
    // fetch() normalizes "/api/../x" to "/x": never let a path escape the read API (M1)
    if (!normalized.startsWith('/api/') || /%2e/i.test(pathAndQuery.split('?')[0]!)) return NOT_FOUND();
    const hit = this.cache.get(pathAndQuery);
    if (hit && hit.expires > this.now()) {
      this.hits++;
      // LRU: most recently used last
      this.cache.delete(pathAndQuery);
      this.cache.set(pathAndQuery, hit);
      return hit;
    }
    const pending = this.inflight.get(pathAndQuery);
    if (pending) return pending;
    if (this.inflight.size >= (this.o.maxInflight ?? 8)) {
      // the sim is already answering as much as it should: an old answer beats none
      this.shed++;
      return hit ?? BUSY();
    }
    this.misses++;
    const p = this.fetchOne(pathAndQuery).finally(() => this.inflight.delete(pathAndQuery));
    this.inflight.set(pathAndQuery, p);
    return p;
  }

  private async fetchOne(pathAndQuery: string): Promise<Cached> {
    try {
      const res = await (this.o.fetch ?? fetch)(this.base + pathAndQuery, { signal: AbortSignal.timeout(this.o.timeoutMs ?? 12_000) });
      const body = Buffer.from(await res.arrayBuffer());
      const cache = res.headers.get('cache-control') ?? 'no-store';
      const out: Cached = {
        status: res.status, type: res.headers.get('content-type') ?? 'application/octet-stream', cache, body,
        // cache 404s briefly too, so a bad link can't hammer the sim
        expires: this.now() + Math.min(maxAge(cache), res.status === 200 ? 365 * 86400 : 30) * 1000,
      };
      if (res.status < 500 && out.expires > this.now()) this.store(pathAndQuery, out);
      return out;
    } catch {
      return {
        status: 503, type: 'application/json', cache: 'no-store', expires: 0,
        body: Buffer.from(JSON.stringify({ error: 'The blob is reconnecting. Try again in a moment.' })),
      };
    }
  }

  private store(key: string, v: Cached) {
    const max = this.o.maxBytes ?? 64 << 20;
    if (v.body.length > max / 4) return;
    const old = this.cache.get(key);
    if (old) { this.bytes -= old.body.length; this.cache.delete(key); }
    this.cache.set(key, v);
    this.bytes += v.body.length;
    for (const [k, c] of this.cache) {
      if (this.bytes <= max) break;
      this.cache.delete(k);
      this.bytes -= c.body.length;
    }
  }

  stats() { return { entries: this.cache.size, bytes: this.bytes, hits: this.hits, misses: this.misses, shed: this.shed, inflight: this.inflight.size }; }
}

// ---- link previews ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The origin links in previews point at: PUBLIC_URL, else the request's host. */
export function originOf(publicUrl: string | undefined, host: string, proto = 'https'): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  const h = /^[A-Za-z0-9.:[\]-]{1,255}$/.test(host) ? host : 'localhost';
  return `${proto}://${h}`;
}

/**
 * May a browser page from `origin` open the game socket or earn a session (review I4)? Without this
 * any site could make its visitors' browsers join and vote. Allowed: no Origin at all (not a
 * browser: bots still pay the proof of work), PUBLIC_URL's origin, the host the request itself was
 * made to (covers <app>.fly.dev and any domain pointed at it), and localhost when `allowLocal` (dev).
 */
export function originAllowed(origin: string, host: string, publicUrl: string | undefined, allowLocal = false): boolean {
  if (!origin) return true;
  let u: URL;
  try { u = new URL(origin); } catch { return false; } // includes the opaque "null" origin
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (publicUrl) { try { if (new URL(publicUrl).origin === u.origin) return true; } catch { /* bad PUBLIC_URL: ignore it */ } }
  if (host && u.host === host.toLowerCase()) return true;
  return allowLocal && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** Makes relative og:image / og:url / twitter:image URLs absolute (crawlers need absolute URLs). */
export function absolutizeMeta(html: string, origin: string): string {
  return html.replace(/(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")\/(?!\/)/g, `$1${origin}/`);
}

export interface PreviewTags { title: string; description: string; url: string; image: string; imageAlt: string; type?: string }

/** Replaces the page's title, description and Open Graph / Twitter tags. */
export function withPreview(html: string, t: PreviewTags): string {
  const stripped = html
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<meta\s+(?:property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*>\s*/g, '');
  const tags = [
    `<title>${esc(t.title)}</title>`,
    `<meta name="description" content="${esc(t.description)}">`,
    `<meta property="og:type" content="${esc(t.type ?? 'website')}">`,
    `<meta property="og:site_name" content="Blobocracy">`,
    `<meta property="og:title" content="${esc(t.title)}">`,
    `<meta property="og:description" content="${esc(t.description)}">`,
    `<meta property="og:url" content="${esc(t.url)}">`,
    `<meta property="og:image" content="${esc(t.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(t.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(t.title)}">`,
    `<meta name="twitter:description" content="${esc(t.description)}">`,
    `<meta name="twitter:image" content="${esc(t.image)}">`,
  ].join('\n');
  return stripped.replace('</head>', `${tags}\n</head>`);
}

export interface ClipMetaJson { id: string; run: number; progress: number; kind: string; hasOg: boolean; title: string; description: string }

/** The preview of one clip page. */
export function clipPreview(meta: ClipMetaJson, origin: string): PreviewTags {
  return {
    title: meta.title,
    description: `${meta.description} Everyone online steers the same blob. Watch the clip, then help.`,
    url: `${origin}/c/${meta.id}`,
    image: meta.hasOg ? `${origin}/api/clips/${meta.id}/og.png` : `${origin}/og.png`,
    imageAlt: `${meta.title} A Blobocracy death card.`,
    type: 'video.other',
  };
}
