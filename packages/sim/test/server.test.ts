import { afterEach, describe, expect, test } from 'vitest';
import { decodeServer, encodeInput, IN_RIGHT, type StateFrame } from '@blobocracy/shared';
import { startServer } from '../src/server';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv | null = null;
afterEach(async () => { await srv?.stop(); srv = null; });

interface Client { ws: WebSocket; events: any[]; frames: StateFrame[]; closed: boolean }
function client(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    const c: Client = { ws, events: [], frames: [], closed: false };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') c.events.push(JSON.parse(m.data));
      else { const d = decodeServer(m.data as ArrayBuffer); if (d && 'tick' in d) c.frames.push(d); }
    };
    ws.onclose = () => { c.closed = true; };
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}
async function waitFor<T>(fn: () => T | undefined | false, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}

describe('server', () => {
  test('first message is a welcome with zero deaths', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0 });
    const c = await client(srv.port);
    const w = await waitFor(() => c.events[0]);
    expect(w).toMatchObject({ t: 'welcome', deaths: 0, run: 1 });
    c.ws.close();
  });

  test('holding right makes one active voter, full pull, and moves the blob', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0 });
    const c = await client(srv.port);
    await waitFor(() => c.events[0]);
    c.ws.send(encodeInput(IN_RIGHT));
    const f = await waitFor(() => c.frames.find((x) => x.active === 1), 500);
    expect(f.pull).toBeGreaterThan(0.9);
    const x0 = f.x;
    const moved = await waitFor(() => c.frames.find((x) => x.x > x0 + 1));
    // Frames carry the world's run clock (float32) so clients can time hazards.
    expect(moved.runTime).toBeGreaterThan(f.runTime);
    expect(moved.runTime).toBeCloseTo(Math.fround(srv!.world.dyn.t), 0);
    expect(moved.chompStart).toBeNull();
    expect(moved.crumbles).toEqual([]);
    c.ws.close();
  });

  test('garbage never crashes the server; oversized senders get disconnected', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0 });
    const bad = await client(srv.port);
    const good = await client(srv.port);
    bad.ws.send(new Uint8Array(100).map(() => Math.floor(Math.random() * 256)));
    bad.ws.send(new Uint8Array(0));
    bad.ws.send('hello');
    const n = good.frames.length;
    await waitFor(() => good.frames.length > n + 3);
    bad.ws.send(new Uint8Array(1024));
    await waitFor(() => bad.closed);
    const m = good.frames.length;
    await waitFor(() => good.frames.length > m + 3);
    good.ws.close();
  });

  test('closing a client removes its vote and the world pauses', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0 });
    const a = await client(srv.port);
    const b = await client(srv.port);
    a.ws.send(encodeInput(IN_RIGHT));
    await waitFor(() => b.frames.find((x) => x.active === 1));
    a.ws.close();
    const f = await waitFor(() => { const last = b.frames.at(-1); return last && last.active === 0 && last.phase === 'paused' ? last : undefined; });
    expect(f.online).toBe(1);
    b.ws.close();
  });

  test('virtual players count as online and active', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 300 });
    const c = await client(srv.port);
    const f = await waitFor(() => c.frames.find((x) => x.online === 301 && x.active > 100));
    expect(f.dots.filter((d) => d !== 0).length).toBeGreaterThan(30);
    c.ws.close();
  });
});
