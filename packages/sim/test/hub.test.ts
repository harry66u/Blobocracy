import { afterEach, describe, expect, test } from 'vitest';
import { encodeSummary } from '@blobocracy/shared';
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

describe('player names over the relay link', () => {
  test("a relay's reported names reach the crowd slots and are broadcast to every relay as a names event", async () => {
    srv = await startServer({ port: null, virtualPlayers: 0, link: { port: 0, host: '127.0.0.1' }, log: () => {} });
    const r = await relay(srv.linkPort);
    const zero = { left: 0, right: 0, jump: 0, active: 0, fresh: 0 };
    r.ws.send(encodeSummary({ seq: 1, weighted: zero, buckets: [0, 0, 0, 0, 0, 0, 0, 0], connections: 2, watchers: 0, bytesSent: 0, oldestInputAt: 0, sample: [{ id: 9, bits: 0 }, { id: 4, bits: 0 }] }));
    r.ws.send(JSON.stringify({ c: 'names', names: { 9: 'Brave Turnip', 4: 'shit', 77: 'Ghost' } }));
    const ev = await waitFor(() => r.texts.map((t) => JSON.parse(t)).find((m) => m.t === 'names' && m.names.length > 0));
    expect(ev.names.map((n: [number, string]) => n[1])).toEqual(['Brave Turnip']); // the rude one and the one nobody samples are not shown
    expect(srv.voters.slotNames().map(([, n]) => n)).toEqual(['Brave Turnip']);
  });

  test('a malformed names message is ignored', async () => {
    srv = await startServer({ port: null, virtualPlayers: 0, link: { port: 0, host: '127.0.0.1' }, log: () => {} });
    const r = await relay(srv.linkPort);
    for (const m of ['{"c":"names"}', '{"c":"names","names":[1,2]}', '{"c":"names","names":"x"}', '{"c":"names","names":{"a":"b","1":{"x":1}}}']) r.ws.send(m);
    await new Promise((res) => setTimeout(res, 100));
    expect((await fetch(`http://127.0.0.1:${srv.linkPort}/healthz`)).status).toBe(200);
    expect(r.closed).toBe(false);
  });
});
