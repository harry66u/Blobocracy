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

interface Client { ws: WebSocket; events: any[]; frames: StateFrame[]; notices: any[]; closed: boolean; opened: boolean }
function client(port: number, tok: string | null, ip = '198.51.100.1'): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${tok ? `?t=${tok}` : ''}`, { headers: { 'x-test-ip': ip } } as any);
    sockets.push(ws);
    ws.binaryType = 'arraybuffer';
    const c: Client = { ws, events: [], frames: [], notices: [], closed: false, opened: false };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        const e = JSON.parse(m.data);
        (e.t === 'sim' ? c.notices : c.events).push(e);
      } else { const d = decodeServer(m.data as ArrayBuffer); if (d && 'tick' in d) c.frames.push(d); }
    };
    ws.onclose = () => { c.closed = true; if (!c.opened) reject(new Error('rejected')); };
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
});
