// Integration: static serving, analytics endpoint, stats page, capacity and the budget cap.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { decodeServer } from '@blobocracy/shared';
import { startServer } from '../src/server';
import type { BudgetConfig } from '../src/budget';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv | null = null;
afterEach(async () => { await srv?.stop(); srv = null; });

interface Client { ws: WebSocket; events: any[]; frames: number[]; closed: number | null }
function client(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    const c: Client = { ws, events: [], frames: [], closed: null };
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') c.events.push(JSON.parse(m.data));
      else { const d = decodeServer(m.data as ArrayBuffer); if (d && 'tick' in d) c.frames.push(d.tick); }
    };
    ws.onclose = (e) => { c.closed = e.code; };
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}
async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}
const budget = (o: Partial<BudgetConfig> = {}): BudgetConfig => ({ mode: 'cap', monthlyUsd: 50, alertUsd: 25, baseMonthlyUsd: 0, egressUsdPerGb: 0.02, overhead: 1, ...o });

describe('launch server features', () => {
  test('serves the built client with gzip and cache headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bl-static-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Blobocracy</title>' + ' '.repeat(2000));
    writeFileSync(join(dir, 'assets', 'main-abc123.js'), 'console.log(1)');
    srv = await startServer({ port: 0, virtualPlayers: 0, staticDir: dir, dataDir: null });
    const base = `http://127.0.0.1:${srv.port}`;
    const index = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } });
    expect(index.status).toBe(200);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('<title>Blobocracy</title>');
    const js = await fetch(`${base}/assets/main-abc123.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  test('analytics beacons are counted, junk rejected, and the stats page needs the key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'bl-data-'));
    srv = await startServer({ port: 0, virtualPlayers: 0, dataDir, statsKey: 's3cret', siteUrl: 'https://blobocracy.com' });
    const base = `http://127.0.0.1:${srv.port}`;
    const beacon = JSON.stringify({ e: 'visit', src: 'hn', isNew: true, daily: true, cohort: '2026-11-17', firstSrc: 'hn', daysSince: 0, firstReturn: false });
    expect((await fetch(`${base}/a`, { method: 'POST', body: beacon })).status).toBe(204);
    expect((await fetch(`${base}/a`, { method: 'POST', body: '{"e":"evil"}' })).status).toBe(400);
    expect((await fetch(`${base}/a`, { method: 'POST', body: 'x'.repeat(5000) })).status).toBe(400);
    expect((await fetch(`${base}/stats`)).status).toBe(404);
    expect((await fetch(`${base}/stats?key=wrong`)).status).toBe(404);
    const page = await (await fetch(`${base}/stats?key=s3cret&days=7`)).text();
    expect(page).toContain('Where players came from');
    expect(page).toMatch(/<th scope="row">hn<\/th>\s*<td>1<\/td>/);
    expect(page).toContain('https://blobocracy.com/?via=webgames');
    await srv.stop();
    srv = null;
    // saved on stop; a restart picks it up
    const saved = JSON.parse(readFileSync(join(dataDir, 'analytics.json'), 'utf8'));
    expect(Object.values(saved.days)[0]).toMatchObject({ hn: { visitors: 1, fresh: 1 } });
  });

  test('a full game turns new players away with the packed message and the live death count', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0, maxPlayers: 2, dataDir: null });
    const a = await client(srv.port), b = await client(srv.port), c = await client(srv.port);
    const packed = await waitFor(() => c.events.find((e) => e.t === 'packed'));
    expect(packed).toEqual({ t: 'packed', deaths: 0, online: 2 });
    expect(await waitFor(() => c.closed)).toBe(4001);
    expect(a.events[0].t).toBe('welcome');
    expect(srv.players()).toBe(2);
    const status = await (await fetch(`http://127.0.0.1:${srv.port}/api/status`)).json();
    expect(status).toMatchObject({ online: 2, packed: true, deaths: 0 });
    a.ws.close(); b.ws.close();
  });

  test('cost cap drill: alerts fire, frame rate drops at 70%, capacity shrinks at 90% and 100%, raising the budget recovers', async () => {
    let wall = Date.parse('2026-11-17T12:00:00Z');
    const alerts: string[] = [];
    srv = await startServer({
      port: 0, virtualPlayers: 0, dataDir: null, adminKey: 'adm', now: () => wall,
      budget: budget({ monthlyUsd: 1 }), maxPlayers: 50, baseCapacity: 3, packedCapacity: 1,
      alert: (t) => alerts.push(t),
    });
    const s = srv;
    const p1 = await client(s.port);
    const rate = async () => { const n0 = p1.frames.length; await new Promise((r) => setTimeout(r, 1000)); return p1.frames.length - n0; };
    expect(await rate()).toBeGreaterThanOrEqual(18); // 20 Hz

    const spendTo = async (usd: number) => {
      s.budget.addBytes(((usd - s.budget.spentUsd) / 0.02) * 1e9);
      wall += 1500;
      await waitFor(() => s.budget.spentUsd >= usd - 1e-9 && s.budget.state.alerted.length > 0);
      await new Promise((r) => setTimeout(r, 1200)); // let the loop tick the budget
    };
    await spendTo(0.75);
    expect(s.budget.level).toBe(1);
    expect(await rate()).toBeLessThanOrEqual(13); // 12 Hz
    await spendTo(0.95);
    expect(s.budget.level).toBe(2);
    const more = [await client(s.port), await client(s.port), await client(s.port)];
    await waitFor(() => more[2]!.closed === 4001); // 4th player is beyond BASE_CAPACITY=3
    await spendTo(1.01);
    expect(s.budget.level).toBe(3);
    const late = await client(s.port);
    expect(await waitFor(() => late.events.find((e) => e.t === 'packed'))).toBeTruthy();
    const spend = alerts.filter((a) => a.includes('spend estimate'));
    expect(spend.map((a) => a.match(/\d+% of/)?.[0])).toEqual(['50% of', '70% of', '90% of', '100% of']);
    // turning players away also alerts, once an hour at most
    expect(alerts.filter((a) => a.startsWith('Blobocracy is full'))).toHaveLength(1);

    // raise the budget live via the admin endpoint
    const base = `http://127.0.0.1:${s.port}`;
    expect((await fetch(`${base}/admin/budget?key=nope&usd=10`, { method: 'POST' })).status).toBe(404);
    const after = await (await fetch(`${base}/admin/budget?key=adm&usd=10`, { method: 'POST' })).json();
    expect(after).toMatchObject({ monthlyUsd: 10, level: 'normal' });
    expect(alerts.at(-1)).toContain('back to normal');
    const health = await (await fetch(`${base}/api/health?key=adm`)).json();
    expect(health).toMatchObject({ level: 'normal' });
    expect(health.budget.monthlyUsd).toBe(10);
    for (const c of [p1, ...more, late]) c.ws.close();
  }, 20_000);
});
