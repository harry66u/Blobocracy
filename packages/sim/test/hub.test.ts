import { afterEach, describe, expect, test } from 'vitest';
import { startServer } from '../src/server';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv | null = null;
afterEach(async () => { await srv?.stop(); srv = null; });

function relay(port: number, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; texts: string[]; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay`, { headers } as unknown as string[]);
    const c = { ws, texts: [] as string[], closed: false };
    ws.onmessage = (m) => { if (typeof m.data === 'string') c.texts.push(m.data); };
    ws.onclose = () => { c.closed = true; };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error('refused'));
  });
}
async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}

describe('relay link hardening (I8)', () => {
  test('malformed control messages from a relay never crash the sim', async () => {
    srv = await startServer({ port: null, virtualPlayers: 0, link: { port: 0, host: '127.0.0.1' }, adminToken: 'tok', log: () => {} });
    const r = await relay(srv.linkPort);
    for (const m of [
      '{"c":"admin","id":1,"auth":"Bearer tok"}',
      '{"c":"admin","id":2,"auth":"Bearer tok","method":"GET","path":{"x":1}}',
      '{"c":"admin","id":3,"auth":"Bearer tok","method":"POST","path":"/admin/ban","body":{"cidr":"1.2.3.4"}}',
      '{"c":"hello","name":{"toString":1}}',
      '{"c":"stats","stats":"nope"}',
      '{"c":"admin","id":4,"auth":"Bearer tok","method":"POST","path":"/admin/ban","body":"null"}',
      '{"c":"admin"}',
      '{"c":null}',
    ]) r.ws.send(m);
    r.ws.send(JSON.stringify({ c: 'admin', id: 9, method: 'GET', path: '/admin/stats', auth: 'Bearer tok', body: '' }));
    const res = await waitFor(() => r.texts.map((t) => JSON.parse(t)).find((m) => m.c === 'adminRes' && m.id === 9));
    expect(res.status).toBe(200);
    // the malformed admin requests were answered with 400s, not thrown
    const bad = r.texts.map((t) => JSON.parse(t)).filter((m) => m.c === 'adminRes' && m.id !== 9);
    expect(bad.map((m) => [m.id, m.status])).toEqual([[1, 400], [2, 400], [3, 400], [4, 400]]);
    expect((await fetch(`http://127.0.0.1:${srv.linkPort}/healthz`)).status).toBe(200);
  });

  test('the relay secret is checked (a wrong one of the same length is refused)', async () => {
    srv = await startServer({ port: null, virtualPlayers: 0, link: { port: 0, host: '127.0.0.1', secret: 'a'.repeat(32) }, log: () => {} });
    await expect(relay(srv.linkPort, { 'x-relay-secret': 'b'.repeat(32) })).rejects.toThrow();
    await expect(relay(srv.linkPort)).rejects.toThrow();
    const ok = await relay(srv.linkPort, { 'x-relay-secret': 'a'.repeat(32) });
    expect(ok.closed).toBe(false);
  });
});
