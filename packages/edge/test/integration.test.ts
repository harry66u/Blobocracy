import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { IN_RIGHT, decodeServer, encodeInput, solvePow, type StateFrame } from '@blobocracy/shared';
import { startServer } from '../../sim/src/server';
import { startEdge, type EdgeOptions } from '../src/server';

type Sim = Awaited<ReturnType<typeof startServer>>;
type Edge = Awaited<ReturnType<typeof startEdge>>;
let sims: Sim[] = [];
let edges: Edge[] = [];
let sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets) s.close();
  sockets = [];
  for (const e of edges) await e.stop();
  for (const s of sims) await s.stop();
  edges = []; sims = [];
});

const SECRET = 'integration-secret';
const ADMIN = 'admin-token';

async function sim(over: Partial<Parameters<typeof startServer>[0]> = {}) {
  const s = await startServer({ port: null, virtualPlayers: 0, link: { port: 0, host: '127.0.0.1' }, adminToken: ADMIN, ...over });
  sims.push(s);
  return s;
}

async function edge(s: { linkPort: number }, over: Partial<EdgeOptions> = {}) {
  const e = await startEdge({
    port: 0, host: '127.0.0.1', simUrl: `ws://127.0.0.1:${s.linkPort}/relay`, sessionSecret: SECRET, powBits: 6,
    trustTestIpHeader: true, ...over,
  });
  edges.push(e);
  return e;
}

async function token(port: number, ip = '198.51.100.1'): Promise<string> {
  const base = `http://127.0.0.1:${port}`;
  const c = await (await fetch(`${base}/session`, { headers: { 'x-test-ip': ip } })).json() as { challenge: string; bits: number };
  const nonce = solvePow(c.challenge, c.bits);
  const r = await fetch(`${base}/session`, { method: 'POST', body: JSON.stringify({ challenge: c.challenge, nonce }), headers: { 'x-test-ip': ip } });
  return ((await r.json()) as { token: string }).token;
}

interface Client { ws: WebSocket; events: any[]; frames: StateFrame[]; notices: any[]; closed: boolean; opened: boolean; code?: number; reason?: string }
function client(port: number, tok: string | null, ip = '198.51.100.1', origin?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${tok ? `?t=${tok}` : ''}`, { headers: { 'x-test-ip': ip, ...(origin ? { origin } : {}) } } as any);
    sockets.push(ws);
    ws.binaryType = 'arraybuffer';
    const c: Client = { ws, events: [], frames: [], notices: [], closed: false, opened: false };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const e = JSON.parse(m.data);
        (e.t === 'sim' ? c.notices : c.events).push(e);
      } else { const d = decodeServer(m.data as ArrayBuffer); if (d && 'tick' in d) c.frames.push(d); }
    };
    ws.onclose = (ev) => { c.closed = true; c.code = ev.code; c.reason = ev.reason; if (!c.opened) reject(new Error('rejected')); };
    ws.onerror = () => { if (!c.opened) reject(new Error('rejected')); }; // undici fires no close after a refused handshake
    ws.onopen = () => { c.opened = true; resolve(c); };
  });
}

async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}

describe('sim + two edges', () => {
  test('a client on edge A pressing right moves the blob seen by a client on edge B', async () => {
    const s = await sim();
    const a = await edge(s), b = await edge(s);
    await waitFor(() => s.relayCount() === 2);
    const ca = await client(a.port, await token(a.port, '198.51.100.1'), '198.51.100.1');
    const cb = await client(b.port, await token(b.port, '198.51.100.2'), '198.51.100.2');
    expect(await waitFor(() => cb.events[0])).toMatchObject({ t: 'welcome', deaths: 0 });
    await waitFor(() => cb.frames.find((f) => f.online === 2));
    ca.ws.send(encodeInput(IN_RIGHT));
    const f = await waitFor(() => cb.frames.find((x) => x.active === 1 && x.pull > 0.9));
    await waitFor(() => cb.frames.find((x) => x.x > f.x + 1));
    // A's player holds a crowd dot, leaning right, on B's screen.
    expect(cb.frames.at(-1)!.dots.filter((d) => d === 2).length).toBe(1);
  });

  test('the socket needs a valid session token', async () => {
    const s = await sim();
    const a = await edge(s);
    await expect(client(a.port, null)).rejects.toThrow();
    await expect(client(a.port, 's1.forged.9999999999999.sig')).rejects.toThrow();
    const r = await fetch(`http://127.0.0.1:${a.port}/session`, { method: 'POST', body: JSON.stringify({ challenge: 'x', nonce: 1 }) });
    expect(r.status).toBe(400);
  });

  test('per-IP connection cap', async () => {
    const s = await sim();
    const a = await edge(s, { ipConnCap: 2 });
    for (let i = 0; i < 2; i++) await client(a.port, await token(a.port, '203.0.113.5'), '203.0.113.5');
    await expect(client(a.port, await token(a.port, '203.0.113.5'), '203.0.113.5')).rejects.toThrow();
    await client(a.port, await token(a.port, '203.0.113.6'), '203.0.113.6');
  });

  test('a crowded IPv6 /48 gets a harder proof of work (I3)', async () => {
    const s = await sim();
    const a = await edge(s, { crowdedPrefixSessions: 2 });
    const bits = async (ip: string) => ((await (await fetch(`http://127.0.0.1:${a.port}/session`, { headers: { 'x-test-ip': ip } })).json()) as { bits: number }).bits;
    expect(await bits('2001:db8:7:1::1')).toBe(6);
    for (let i = 1; i <= 3; i++) await client(a.port, await token(a.port, `2001:db8:7:${i}::1`), `2001:db8:7:${i}::1`);
    expect(await bits('2001:db8:7:99::1')).toBe(8);
    expect(await bits('2001:db8:8:1::1')).toBe(6); // another /48
    expect(await bits('198.51.100.40')).toBe(6);
    // the harder challenge still redeems
    await client(a.port, await token(a.port, '2001:db8:7:99::1'), '2001:db8:7:99::1');
  });

  test('another site cannot make its visitors join: Origin must be this site (I4)', async () => {
    const s = await sim();
    const a = await edge(s, { publicUrl: 'https://blobocracy.example' });
    const own = `http://127.0.0.1:${a.port}`;
    const post = (origin?: string) => fetch(`${own}/session`, { method: 'POST', body: '{}', headers: origin ? { origin } : {} });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await post('null')).status).toBe(403);
    expect((await post(own)).status).toBe(400); // allowed through to the (failing) proof of work
    expect((await post('https://blobocracy.example')).status).toBe(400);
    expect((await post()).status).toBe(400); // bots without Origin still pay the proof of work
    const t = await token(a.port, '198.51.100.30');
    await expect(client(a.port, t, '198.51.100.30', 'https://evil.example')).rejects.toThrow();
    await client(a.port, t, '198.51.100.30', 'https://blobocracy.example');
    await client(a.port, await token(a.port, '198.51.100.31'), '198.51.100.31', own);
    // localhost dev servers (Vite on another port) only when allowed
    expect((await post('http://localhost:5173')).status).toBe(403);
    const dev = await edge(s, { allowLocalOrigins: true });
    expect((await fetch(`http://127.0.0.1:${dev.port}/session`, { method: 'POST', body: '{}', headers: { origin: 'http://localhost:5173' } })).status).toBe(400);
  });

  test('sim unreachable: relays tell clients, then reconnect when it is back', async () => {
    const s = await sim();
    const a = await edge(s, { reconnectMinMs: 50 });
    const c = await client(a.port, await token(a.port));
    await waitFor(() => c.frames.length > 0);
    await s.stop();
    sims = sims.filter((x) => x !== s);
    expect(await waitFor(() => c.notices.find((n) => n.up === false))).toEqual({ t: 'sim', up: false });
    // Pings are still answered while the sim is away, so the client keeps its socket.
    await sim({ link: { port: s.linkPort, host: '127.0.0.1' } });
    await waitFor(() => c.notices.find((n) => n.up === true), 5000);
    const n = c.frames.length;
    await waitFor(() => c.frames.length > n + 2);
    expect(c.closed).toBe(false);
  });

  test('admin through an edge: a banned IP is cut off and kept out', async () => {
    const s = await sim();
    const a = await edge(s);
    const c = await client(a.port, await token(a.port, '192.0.2.77'), '192.0.2.77');
    const res = await fetch(`http://127.0.0.1:${a.port}/admin/ban`, {
      method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ cidr: '192.0.2.0/24' }),
    });
    expect(res.status).toBe(200);
    await waitFor(() => c.closed);
    const r = await fetch(`http://127.0.0.1:${a.port}/session`, { headers: { 'x-test-ip': '192.0.2.8' } });
    expect(r.status).toBe(403);
    const stats = await (await fetch(`http://127.0.0.1:${a.port}/admin/stats`, { headers: { authorization: `Bearer ${ADMIN}` } })).json() as any;
    expect(stats.bans).toEqual(['192.0.2.0/24']);
    expect(stats.relays.length).toBe(1);
    expect((await fetch(`http://127.0.0.1:${a.port}/admin/stats`)).status).toBe(401);
  });

  test('budget spent: extra visitors get the packed page with the live death counter', async () => {
    const s = await sim({
      budget: { mode: 'cap', monthlyUsd: 50, alertUsd: 25, prices: { simHourly: 0, edgeHourly: 0, fixedMonthly: 0, egressPerGb: 0.02 } },
      edgeCapacity: 1,
    });
    s.governor.addEgress(3000e9); // $60 of egress
    s.governor.update(0);
    const a = await edge(s);
    await waitFor(() => a.state().policy.tier === 100);
    await client(a.port, await token(a.port, '198.51.100.9'), '198.51.100.9'); // within the always-on capacity
    const r = await fetch(`http://127.0.0.1:${a.port}/session`, { headers: { 'x-test-ip': '198.51.100.10' } });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ packed: true });
    const page = await (await fetch(`http://127.0.0.1:${a.port}/`, { headers: { 'x-test-ip': '198.51.100.10' } })).text();
    expect(page).toContain('Blobocracy is packed');
    const counter = await (await fetch(`http://127.0.0.1:${a.port}/api/counter`)).json();
    expect(counter).toMatchObject({ deaths: 0, packed: true });
    // A relay that is not always-on takes nobody new at 100%.
    const b = await edge(s);
    await waitFor(() => b.state().policy.tier === 100);
    expect(b.state().policy.alwaysOn).toBe(false);
    expect((await fetch(`http://127.0.0.1:${b.port}/session`, { headers: { 'x-test-ip': '198.51.100.11' } })).status).toBe(503);
  });

  test('the cap is hard: at 100% the relays that are not always-on shed their sockets to the packed page (I1)', async () => {
    const s = await sim({
      budget: { mode: 'cap', monthlyUsd: 50, alertUsd: 25, prices: { simHourly: 0, edgeHourly: 0, fixedMonthly: 0, egressPerGb: 0.02 } },
      edgeCapacity: 1,
    });
    const a = await edge(s, { alwaysOn: true });
    const b = await edge(s);
    await waitFor(() => s.relayCount() === 2);
    const inA = await client(a.port, await token(a.port, '198.51.100.50'), '198.51.100.50');
    const extraA = await client(a.port, await token(a.port, '198.51.100.51'), '198.51.100.51'); // beyond capacity 1
    const inB = await client(b.port, await token(b.port, '198.51.100.52'), '198.51.100.52');
    await waitFor(() => inB.frames.length > 0);
    s.governor.addEgress(3000e9); // $60 of egress
    s.budgetTick();
    await waitFor(() => inB.closed);
    expect(inB.code).toBe(4002);
    expect(inB.reason).toContain('packed');
    await waitFor(() => extraA.closed);
    expect(extraA.code).toBe(4002);
    // the always-on relay keeps its capacity
    const n = inA.frames.length;
    await waitFor(() => inA.frames.length > n + 2);
    expect(inA.closed).toBe(false);
    expect(b.state().connections).toBe(0);
  });

  test('sockets with no input for a long time are dropped (they can rejoin at once) (I1)', async () => {
    const s = await sim();
    const a = await edge(s, { idleDisconnectMs: 400 });
    const idle = await client(a.port, await token(a.port, '198.51.100.60'), '198.51.100.60');
    const busy = await client(a.port, await token(a.port, '198.51.100.61'), '198.51.100.61');
    const t = setInterval(() => busy.ws.send(encodeInput(Date.now() % 2 ? IN_RIGHT : 0)), 100);
    try {
      await waitFor(() => idle.closed, 3000);
      expect(idle.code).toBe(4001);
      expect(busy.closed).toBe(false);
      await client(a.port, await token(a.port, '198.51.100.60'), '198.51.100.60');
    } finally { clearInterval(t); }
  });

  test('serves the built client, marked so the page fetches a session first; clip links get the clip page', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), `<html><head><title>Blobocracy</title></head><body>${'x'.repeat(2000)}</body></html>`);
    writeFileSync(join(dir, 'clip.html'), '<html><head></head><body>clip</body></html>');
    writeFileSync(join(dir, 'assets', 'main-abc.js'), 'console.log(1)');
    const s = await sim();
    const a = await edge(s, { staticDir: dir });
    const r = await fetch(`http://127.0.0.1:${a.port}/`);
    expect(r.headers.get('content-encoding')).toBe('gzip');
    expect(await r.text()).toContain('<meta name="blobocracy-session" content="pow"></head>');
    const js = await fetch(`http://127.0.0.1:${a.port}/assets/main-abc.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(await (await fetch(`http://127.0.0.1:${a.port}/c/AbC123`)).text()).toContain('clip');
    expect((await fetch(`http://127.0.0.1:${a.port}/nope.js`)).status).toBe(404);
  });

  test('history API and pages through an edge: proxied, cached, clip links unfurl with the clip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dist-'));
    const head = '<meta property="og:image" content="/og.png"><meta property="og:url" content="/runs">';
    writeFileSync(join(dir, 'runs.html'), `<html><head><title>Runs</title>${head}</head><body>runs</body></html>`);
    writeFileSync(join(dir, 'hall.html'), `<html><head><title>Hall</title>${head}</head><body>hall</body></html>`);
    writeFileSync(join(dir, 'clip.html'), `<html><head><title>Blobocracy clip</title><meta property="og:title" content="Blobocracy clip"></head><body>clip</body></html>`);
    const { MemoryStore } = await import('../../sim/src/store');
    const store = new MemoryStore();
    await store.saveClip({ id: 'Qx7_ab', levelId: 1, levelVersion: 1, run: 4812, kind: 'near_miss', createdAt: 0, progress: 0.78, cause: 'press', deaths: 4812, replay: new Uint8Array([1, 2, 3]), og: new Uint8Array([137, 80, 78, 71]) });
    await store.recordRun({ levelId: 1, levelVersion: 1, run: 1, startedAt: 0, endedAt: 1, durationMs: 1, maxProgress: 0.1, maxX: 1, zoneReached: 0, cause: 'pit', peakPlayers: 1, clipId: null });
    const s = await sim({ store });
    const a = await edge(s, { staticDir: dir, publicUrl: 'https://blobocracy.example' });
    const base = `http://127.0.0.1:${a.port}`;

    const sum = await fetch(`${base}/api/summary`);
    expect(sum.status).toBe(200);
    expect((await sum.json()).attempts).toBe(1);
    await fetch(`${base}/api/summary`);
    expect(a.stats().apiCache.hits).toBeGreaterThanOrEqual(1);
    expect((await (await fetch(`${base}/api/runs?page=1&best=1`)).json()).runs[0].run).toBe(1);
    expect((await (await fetch(`${base}/api/counter`)).json())).toHaveProperty('deaths');

    const bin = await fetch(`${base}/api/clips/Qx7_ab`);
    expect(bin.headers.get('cache-control')).toContain('immutable');
    expect([...new Uint8Array(await bin.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await fetch(`${base}/api/clips/missing`)).status).toBe(404);

    const runs = await (await fetch(`${base}/runs`)).text();
    expect(runs).toContain('runs');
    expect(runs).toContain('content="https://blobocracy.example/og.png"');
    expect(await (await fetch(`${base}/hall`)).text()).toContain('hall');

    const page = await (await fetch(`${base}/c/Qx7_ab`)).text();
    expect(page).toContain('<title>So close. Run 4,812 made it 78%…</title>');
    expect(page).toContain('<meta property="og:image" content="https://blobocracy.example/api/clips/Qx7_ab/og.png">');
    expect(page).toContain('<meta property="og:url" content="https://blobocracy.example/c/Qx7_ab">');
    expect(page).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(page.match(/og:title/g)).toHaveLength(1);
    expect(page).toContain('clip</body>');
    // an unknown clip still gets the (generic) clip page
    expect(await (await fetch(`${base}/c/nope123`)).text()).toContain('<title>Blobocracy clip</title>');
  });

  test('cache-busting the read API: junk parameters share one cache entry, and one IP cannot keep the sim busy (C1)', async () => {
    const { MemoryStore } = await import('../../sim/src/store');
    const store = new MemoryStore();
    let summaries = 0;
    const counted = new Proxy(store, { get(t, p, r) { if (p === 'summary') summaries++; return Reflect.get(t, p, r); } });
    const s = await sim({ store: counted });
    const a = await edge(s, { apiRate: { perSecond: 1, burst: 5 } });
    const base = `http://127.0.0.1:${a.port}`;
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => fetch(`${base}/api/summary?x=${i}`, { headers: { 'x-test-ip': '198.51.100.20' } })));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(summaries).toBe(1);
    // distinct real pages are misses: past the burst this IP gets 429s, another IP still gets through
    const codes: number[] = [];
    for (let i = 1; i <= 12; i++) codes.push((await fetch(`${base}/api/runs?page=${i}`, { headers: { 'x-test-ip': '198.51.100.21' } })).status);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(6);
    expect((await fetch(`${base}/api/runs?page=50`, { headers: { 'x-test-ip': '198.51.100.22' } })).status).toBe(200);
    // unknown routes are answered by the edge without asking the sim
    expect((await fetch(`${base}/api/whatever?x=1`)).status).toBe(404);
  });

  test('/api/../ never reaches the other sim routes (M1)', async () => {
    const s = await sim();
    const a = await edge(s);
    const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: a.port, path, method: 'GET' }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
    const r = await get('/api/../healthz');
    expect(r.body).not.toContain('relays');
    expect(r.status).toBe(404);
    expect((await get('/api/%2e%2e/admin/stats')).status).toBe(404);
  });
});
