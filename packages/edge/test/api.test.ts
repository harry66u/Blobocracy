import { describe, expect, test } from 'vitest';
import { ApiProxy, TokenBuckets, absolutizeMeta, canonicalApi, clipPreview, maxAge, originOf, simHttpBase, withPreview } from '../src/api';

describe('API proxy', () => {
  test('sim URL → its internal HTTP', () => {
    expect(simHttpBase('ws://sim.process.blobocracy.internal:8081/relay')).toBe('http://sim.process.blobocracy.internal:8081');
    expect(simHttpBase('wss://[fdaa::3]:8081/relay')).toBe('https://[fdaa::3]:8081');
  });

  test('caches by cache-control, shares in-flight fetches, survives a dead sim', async () => {
    let calls = 0;
    let now = 0;
    let down = false;
    const fake = (async (url: string) => {
      calls++;
      if (down) throw new Error('ECONNREFUSED');
      await new Promise((r) => setTimeout(r, 5));
      const immutable = url.includes('/clips/');
      return new Response(url.includes('missing') ? 'no' : `body:${url}`, {
        status: url.includes('missing') ? 404 : 200,
        headers: { 'content-type': 'text/plain', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=5' },
      });
    }) as unknown as typeof fetch;
    const p = new ApiProxy('http://sim', { fetch: fake, now: () => now });
    const [a, b] = await Promise.all([p.get('/api/summary'), p.get('/api/summary')]);
    expect(calls).toBe(1);
    expect(a.body.toString()).toBe('body:http://sim/api/summary');
    expect(b).toBe(a);
    now += 4000;
    await p.get('/api/summary');
    expect(calls).toBe(1);
    now += 2000; // past max-age=5
    await p.get('/api/summary');
    expect(calls).toBe(2);
    await p.get('/api/clips/x');
    now += 30 * 86400_000;
    await p.get('/api/clips/x');
    expect(calls).toBe(3);
    expect((await p.get('/api/missing')).status).toBe(404);
    down = true;
    const r = await p.get('/api/runs');
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body.toString()).error).toMatch(/reconnecting/);
  });

  test('a bounded LRU', async () => {
    const fake = (async () => new Response('x'.repeat(100), { headers: { 'cache-control': 'max-age=60' } })) as unknown as typeof fetch;
    const p = new ApiProxy('http://sim', { fetch: fake, maxBytes: 450 });
    for (let i = 0; i < 10; i++) await p.get(`/api/clips/${i}`);
    expect(p.stats().bytes).toBeLessThanOrEqual(450);
    expect(p.stats().entries).toBe(4);
  });

  test('max-age parsing', () => {
    expect(maxAge('public, max-age=10')).toBe(10);
    expect(maxAge('no-store')).toBe(0);
    expect(maxAge('')).toBe(0);
  });
});

describe('link previews', () => {
  test('origin: PUBLIC_URL wins; a junk Host header is not reflected', () => {
    expect(originOf('https://blobocracy.com/', 'evil.example')).toBe('https://blobocracy.com');
    expect(originOf(undefined, 'blob.fly.dev')).toBe('https://blob.fly.dev');
    expect(originOf(undefined, 'a"><script>')).toBe('https://localhost');
  });

  test('relative preview URLs become absolute', () => {
    const html = '<meta property="og:image" content="/og.png"><meta name="twitter:image" content="/og.png"><meta property="og:url" content="/"><a href="/x">';
    expect(absolutizeMeta(html, 'https://b.com')).toBe('<meta property="og:image" content="https://b.com/og.png"><meta name="twitter:image" content="https://b.com/og.png"><meta property="og:url" content="https://b.com/"><a href="/x">');
  });

  test('a clip page gets its own title, description and image, escaped', () => {
    const html = '<html><head><title>Blobocracy clip</title>\n<meta name="description" content="old">\n<meta property="og:title" content="old">\n<meta name="twitter:card" content="summary">\n</head><body></body></html>';
    const tags = clipPreview({ id: 'abc', run: 4812, progress: 0.78, kind: 'near_miss', hasOg: true, title: 'So close. Run 4,812 made it 78%…', description: 'Run 4,812 made it 78% of the way, then the "Big Press" flattened it.' }, 'https://b.com');
    const out = withPreview(html, tags);
    expect(out).not.toContain('content="old"');
    expect(out).not.toContain('content="summary"');
    expect(out).toContain('<title>So close. Run 4,812 made it 78%…</title>');
    expect(out).toContain('&quot;Big Press&quot;');
    expect(out).toContain('<meta property="og:image" content="https://b.com/api/clips/abc/og.png">');
    expect(out).toContain('<meta property="og:type" content="video.other">');
    expect(clipPreview({ id: 'abc', run: 1, progress: 0.2, kind: 'record', hasOg: false, title: 't', description: 'd' }, 'https://b.com').image).toBe('https://b.com/og.png');
  });
});

describe('read API hardening (C1, M1)', () => {
  const TRACKS = new Set([1, 2, 1002]);
  test('only known routes and parameters reach the sim, normalized into one cache key', () => {
    expect(canonicalApi('/api/summary', 'x=123', TRACKS)).toBe('/api/summary');
    expect(canonicalApi('/api/summary', 'level=2&x=1', TRACKS)).toBe('/api/summary?level=2');
    expect(canonicalApi('/api/summary', 'level=999', TRACKS)).toBe('/api/summary'); // unknown level: the current one, like the sim
    expect(canonicalApi('/api/summary/', '', TRACKS)).toBe('/api/summary');
    expect(canonicalApi('/api/runs', 'zzz=1&best=true&page=2&level=1', TRACKS)).toBe('/api/runs?page=2&best=1&level=1');
    expect(canonicalApi('/api/runs', 'page=1&size=25&best=0', TRACKS)).toBe('/api/runs');
    expect(canonicalApi('/api/runs', 'page=99999999&size=500', TRACKS)).toBe('/api/runs?page=100000&size=100');
    expect(canonicalApi('/api/runs', 'page=abc', TRACKS)).toBe('/api/runs');
    expect(canonicalApi('/api/levels', 'a=1', TRACKS)).toBe('/api/levels');
    expect(canonicalApi('/api/hall', 'cb=7', TRACKS)).toBe('/api/hall');
    expect(canonicalApi('/api/clips/Qx7_ab', 'v=1', TRACKS)).toBe('/api/clips/Qx7_ab');
    expect(canonicalApi('/api/clips/Qx7_ab/meta', '', TRACKS)).toBe('/api/clips/Qx7_ab/meta');
    expect(canonicalApi('/api/clips/Qx7_ab/og.png', '', TRACKS)).toBe('/api/clips/Qx7_ab/og.png');
    expect(canonicalApi('/api/clips/bad!id', '', TRACKS)).toBeNull();
    expect(canonicalApi('/api/nope', '', TRACKS)).toBeNull();
    // path tricks never reach the sim's other routes (M1)
    expect(canonicalApi('/api/../healthz', '', TRACKS)).toBeNull();
    expect(canonicalApi('/api/%2e%2e/admin/stats', '', TRACKS)).toBeNull();
    expect(canonicalApi('/api/clips/../../admin/stats', '', TRACKS)).toBeNull();
  });

  test('the proxy itself refuses anything that normalizes outside /api/ (M1)', async () => {
    let calls = 0;
    const fake = (async () => { calls++; return new Response('x'); }) as unknown as typeof fetch;
    const p = new ApiProxy('http://sim', { fetch: fake });
    expect((await p.get('/api/../healthz')).status).toBe(404);
    expect((await p.get('/api/%2E%2E/admin/stats')).status).toBe(404);
    expect(calls).toBe(0);
  });

  test('beyond the in-flight cap a miss gets the stale copy, or a 503 when there is none', async () => {
    let now = 0;
    const release: (() => void)[] = [];
    const fake = (async (url: string) => {
      await new Promise<void>((r) => release.push(r));
      return new Response(`v:${url}`, { headers: { 'cache-control': 'public, max-age=5' } });
    }) as unknown as typeof fetch;
    const p = new ApiProxy('http://sim', { fetch: fake, now: () => now, maxInflight: 2 });
    const warm = p.get('/api/runs?page=3');
    release.shift()!();
    await warm;
    now += 10_000; // stale now
    const a = p.get('/api/runs?page=1'), b = p.get('/api/runs?page=2');
    expect((await p.get('/api/runs?page=4')).status).toBe(503);
    const stale = await p.get('/api/runs?page=3');
    expect(stale.status).toBe(200);
    expect(stale.body.toString()).toBe('v:http://sim/api/runs?page=3');
    expect(p.stats().shed).toBe(2);
    for (const r of release.splice(0)) r();
    await Promise.all([a, b]);
  });

  test('token buckets: a burst, then a steady rate per key', () => {
    let now = 0;
    const t = new TokenBuckets({ perSecond: 2, burst: 3, now: () => now });
    expect([t.take('a'), t.take('a'), t.take('a'), t.take('a')]).toEqual([true, true, true, false]);
    expect(t.take('b')).toBe(true);
    now += 500;
    expect(t.take('a')).toBe(true);
    expect(t.take('a')).toBe(false);
    now += 3_600_000;
    t.prune();
    expect(t.size()).toBe(0);
  });
});
