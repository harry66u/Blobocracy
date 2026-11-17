import { afterEach, describe, expect, test } from 'vitest';
import { ENCORE_TRACK, encodeInput, IN_RIGHT, type ServerEvent } from '@blobocracy/shared';
import { createAdmin } from '../src/admin';
import { BudgetGovernor, MemoryStore as BudgetStore } from '../src/budget';
import { MemoryLiveStore } from '../src/live';
import { startServer } from '../src/server';
import { MemoryStore } from '../src/store';
import { RIGHT, TINY, TINY2 } from './fixtures';

type Srv = Awaited<ReturnType<typeof startServer>>;
let srv: Srv | null = null;
afterEach(async () => { await srv?.stop(); srv = null; });
const quiet = () => {};

async function waitFor<T>(fn: () => T | undefined | false | null, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}
function client(port: number): Promise<{ ws: WebSocket; events: ServerEvent[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.binaryType = 'arraybuffer';
    const c = { ws, events: [] as ServerEvent[] };
    ws.onmessage = (m) => { if (typeof m.data === 'string') c.events.push(JSON.parse(m.data)); };
    ws.onopen = () => resolve(c);
    ws.onerror = reject;
  });
}
const body = (r: { body: string | Uint8Array }) => JSON.parse(String(r.body));

describe('server: win and level progression', () => {
  test('a win is broadcast, written to the hall of fame, and every client moves to level 2 with a fresh welcome', async () => {
    const store = new MemoryStore();
    srv = await startServer({ port: 0, virtualPlayers: 0, levels: TINY, store, log: quiet, celebrateS: 0.5 });
    const c = await client(srv.port);
    await waitFor(() => c.events[0]);
    expect(c.events[0]).toMatchObject({ t: 'welcome', levelId: 1, name: 'Tiny Hill', encore: false });
    c.ws.send(encodeInput(IN_RIGHT));
    const win = await waitFor(() => c.events.find((e) => e.t === 'win'));
    expect(win).toMatchObject({ levelId: 1, run: 1, deaths: 0, peakPlayers: 1 });
    expect(win.t === 'win' && win.clipId).toMatch(/^[\w-]+$/);
    const level = await waitFor(() => c.events.find((e) => e.t === 'level'));
    expect(level).toEqual({ t: 'level', levelId: 2, version: 3, name: 'Tiny Peak', encore: false });
    const after = c.events.slice(c.events.indexOf(level));
    expect(after.find((e) => e.t === 'welcome')).toMatchObject({ levelId: 2, deaths: 0, run: 1, record: null });
    await srv.store.drained();
    expect(await store.hallOfFame()).toMatchObject([{ levelId: 1, levelName: 'Tiny Hill', deathCount: 0, run: 1, clipId: win.t === 'win' ? win.clipId : '' }]);
    expect((await store.levels()).find((l) => l.id === 1)?.beatenAt).toEqual(expect.any(Number));
    // the win clip is saved once the celebration ends
    const clip = await waitFor(() => srv!.history.whenMade(win.t === 'win' ? win.clipId! : ''), 100).then((p) => p);
    expect(await clip).toMatchObject({ kind: 'win', levelId: 1 });
    // the API follows the current level
    const hall = body(await srv.api('/api/hall', ''));
    expect(hall.current).toMatchObject({ levelId: 2, name: 'Tiny Peak', encore: false });
    expect(hall.comingSoon).toBe(false);
    c.ws.close();
  });

  test('boots on the first level not yet beaten, with its own counters; all beaten: the encore of the last', async () => {
    const store = new MemoryStore();
    await store.ensureLevel({ id: 1, name: 'Tiny Hill', version: 1, geometryHash: 'x' });
    await store.saveWorld({ levelId: 1, deaths: 4811, record: { progress: 1, run: 4812, version: 1 }, peakPlayers: 12408 });
    await store.addHallOfFame({ levelId: 1, beatenAt: 5, deathCount: 4811, peakPlayers: 12408, run: 4812, clipId: null });
    await store.saveWorld({ levelId: 2, deaths: 9, record: { progress: 0.5, run: 4, version: 3 }, peakPlayers: 30 });
    srv = await startServer({ port: null, virtualPlayers: 0, levels: TINY, store, log: quiet });
    expect(srv.world.level).toBe(TINY2);
    expect(srv.world).toMatchObject({ deaths: 9, run: 10, encore: false });
    expect(srv.history.peakPlayers).toBe(30);
    await srv.stop();
    await store.addHallOfFame({ levelId: 2, beatenAt: 6, deathCount: 20, peakPlayers: 30, run: 21, clipId: null });
    srv = await startServer({ port: null, virtualPlayers: 0, levels: TINY, store, log: quiet });
    expect(srv.world.level).toBe(TINY2);
    expect(srv.world).toMatchObject({ encore: true, deaths: 0, run: 1 });
    const hall = body(await srv.api('/api/hall', ''));
    expect(hall.comingSoon).toBe(true);
    expect(hall.current).toMatchObject({ levelId: 2, encore: true });
    expect(hall.entries.map((e: { levelId: number; encore: boolean }) => [e.levelId, e.encore])).toEqual([[1, false], [2, false]]);
  });

  test('a restart after the switch resumes on level 2 from the live snapshot, level 1 still beaten', async () => {
    const live = new MemoryLiveStore();
    const store = new MemoryStore();
    srv = await startServer({ port: 0, virtualPlayers: 0, levels: TINY, store, live, log: quiet, celebrateS: 0.2 });
    srv.world.deaths = 40; srv.world.run = 41;
    const c = await client(srv.port);
    c.ws.send(encodeInput(IN_RIGHT));
    await waitFor(() => srv!.world.level === TINY2);
    c.ws.close();
    srv.world.deaths = 3; srv.world.run = 4;
    await srv.snapshotNow();
    await srv.stop();
    srv = await startServer({ port: null, virtualPlayers: 0, levels: TINY, store, live, log: quiet });
    expect(srv.world.level).toBe(TINY2);
    expect(srv.world).toMatchObject({ deaths: 3, run: 4, encore: false });
    expect(srv.world.countersFor(1)).toMatchObject({ deaths: 40 });
    expect(srv.history.level).toBe(TINY2);
  });

  test('runs and summary can be asked for per level; /api/levels lists what is unlocked', async () => {
    const store = new MemoryStore();
    srv = await startServer({ port: 0, virtualPlayers: 0, levels: TINY, store, log: quiet, celebrateS: 0.2 });
    const c = await client(srv.port);
    c.ws.send(encodeInput(IN_RIGHT));
    await waitFor(() => srv!.world.level === TINY2);
    c.ws.close();
    await waitFor(() => srv!.world.phase === 'paused');
    await srv.store.drained();
    const levels = body(await srv.api('/api/levels', ''));
    expect(levels.levels).toEqual([
      { track: 1, levelId: 1, name: 'Tiny Hill', encore: false, beaten: true, current: false },
      { track: 2, levelId: 2, name: 'Tiny Peak', encore: false, beaten: false, current: true },
    ]);
    const r1 = body(await srv.api('/api/runs', 'level=1'));
    expect(r1.runs.map((r: { run: number; cause: string }) => [r.run, r.cause])).toEqual([[1, 'win']]);
    expect(body(await srv.api('/api/runs', '')).runs).toEqual([]);
    const s1 = body(await srv.api('/api/summary', 'level=1'));
    expect(s1).toMatchObject({ levelId: 1, track: 1, levelName: 'Tiny Hill', attempts: 1, current: false });
    expect(body(await srv.api('/api/summary', 'level=99'))).toMatchObject({ levelId: 2, track: 2 }); // unknown: the current one
    expect(ENCORE_TRACK).toBe(1000);
  });
});

describe('admin: debug win', () => {
  const setup = (production: boolean, debugWin = () => true) => {
    const governor = new BudgetGovernor(
      { mode: 'cap', monthlyUsd: 50, alertUsd: 25, prices: { simHourly: 0, edgeHourly: 0, fixedMonthly: 0, egressPerGb: 0.02 } },
      { store: new BudgetStore(), alert: () => {}, now: () => 0 },
    );
    return createAdmin({ token: 'sekret', governor, stats: () => ({}), control: () => {}, onBudget: () => {}, production, debugWin });
  };
  test('teleports the blob before the goal; needs the token; refused in production', () => {
    let called = 0;
    const admin = setup(false, () => { called++; return true; });
    expect(admin({ method: 'POST', path: '/admin/debug/win', auth: 'Bearer nope', body: '' }).status).toBe(401);
    expect(admin({ method: 'POST', path: '/admin/debug/win', auth: 'Bearer sekret', body: '' })).toMatchObject({ status: 200, body: { ok: true } });
    expect(called).toBe(1);
    expect(setup(false, () => false)({ method: 'POST', path: '/admin/debug/win', auth: 'Bearer sekret', body: '' }).status).toBe(409);
    expect(setup(true)({ method: 'POST', path: '/admin/debug/win', auth: 'Bearer sekret', body: '' }).status).toBe(403);
  });

  test('over HTTP on the dev relay, end to end: the blob wins the real level 1', async () => {
    srv = await startServer({ port: 0, virtualPlayers: 0, store: new MemoryStore(), log: quiet, adminToken: 'dev', celebrateS: 0.3 });
    const r = await fetch(`http://127.0.0.1:${srv.port}/admin/debug/win`, { method: 'POST', headers: { authorization: 'Bearer dev' } });
    expect(r.status).toBe(200);
    expect(srv.world.level.goalX - srv.world.body.x).toBeLessThan(4);
    for (let i = 0; i < 600 && srv.world.phase !== 'celebrating'; i++) srv.world.step(RIGHT);
    expect(srv.world.phase).toBe('celebrating');
    await waitFor(() => srv!.world.level.id === 2);
  });
});
