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
 */

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

export class ApiProxy {
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private inflight = new Map<string, Promise<Cached>>();
  hits = 0;
  misses = 0;

  constructor(private base: string, private o: { maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch; now?: () => number } = {}) {}

  private now() { return (this.o.now ?? Date.now)(); }

  /** `pathAndQuery` like "/api/runs?page=2". */
  async get(pathAndQuery: string): Promise<Cached> {
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

  stats() { return { entries: this.cache.size, bytes: this.bytes, hits: this.hits, misses: this.misses }; }
}

// ---- link previews ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The origin links in previews point at: PUBLIC_URL, else the request's host. */
export function originOf(publicUrl: string | undefined, host: string, proto = 'https'): string {
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  const h = /^[A-Za-z0-9.:[\]-]{1,255}$/.test(host) ? host : 'localhost';
  return `${proto}://${h}`;
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
