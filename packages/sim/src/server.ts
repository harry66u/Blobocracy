import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DT, LEVEL1, encodeState, type Level } from '@blobocracy/shared';
import { makeAlerter, throttled, type AlertFn } from './alerts';
import { Analytics, RateLimit } from './analytics';
import { Budget, capacityFor, defaultBudgetConfig, frameEveryFor, type BudgetConfig } from './budget';
import { Voters } from './crowd';
import { renderDashboard } from './dashboard';
import { clientIp, keyOk, loadStatic, query, readBody, send, serveStatic } from './http';
import { startLocalRelay } from './relay';
import { VirtualCrowd } from './virtual';
import { World } from './world';

const MAX_CATCHUP_STEPS = 5;
const SAVE_EVERY_MS = 30_000;

export interface ServerOptions {
  port: number;
  virtualPlayers: number;
  level?: Level;
  /** Built client to serve (packages/client/dist). Omit in development (Vite serves it). */
  staticDir?: string;
  /** Where analytics and the spend estimate are saved. null keeps them in memory only. */
  dataDir?: string | null;
  siteUrl?: string;
  statsKey?: string;
  adminKey?: string;
  budget?: BudgetConfig;
  /** Hard connection cap; and the caps used at the 90% and 100% budget levels. */
  maxPlayers?: number;
  baseCapacity?: number;
  packedCapacity?: number;
  alert?: AlertFn;
  /** Wall clock, for tests. */
  now?: () => number;
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
function writeJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

/** Wires the world, voters, optional virtual crowd and the local relay into a 60 Hz loop. */
export async function startServer(opts: ServerOptions) {
  const now = opts.now ?? Date.now;
  const world = new World(opts.level ?? LEVEL1);
  const voters = new Voters();
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const alert = opts.alert ?? makeAlerter(undefined);
  const alertOnce = throttled(alert, 3_600_000);

  const dataDir = opts.dataDir ?? null;
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const analytics = new Analytics(dataDir ? readJson(join(dataDir, 'analytics.json')) : null);
  const budget = new Budget(opts.budget ?? defaultBudgetConfig({}), now(), dataDir ? readJson(join(dataDir, 'budget.json')) : null, alert);
  const caps = { max: opts.maxPlayers ?? 5000, base: opts.baseCapacity ?? 2000, packed: opts.packedCapacity ?? 100 };
  const capacity = () => capacityFor(budget.level, caps);
  const beaconLimit = new RateLimit(120);
  const files = opts.staticDir ? loadStatic(opts.staticDir) : new Map();
  const siteUrl = opts.siteUrl ?? `http://localhost:${opts.port}`;

  // rolling health window
  const health = { ticks: 0, frames: 0, maxGapMs: 0, since: performance.now(), last: { tickHz: 60, frameHz: 20, maxGapMs: 0 } };
  let statusCache = { at: 0, body: '' };
  let relayRef: { players(): number } | null = null;

  const relay = await startLocalRelay({
    port: opts.port, voters, world, clock, capacity,
    onBytes: (n) => budget.addBytes(n),
    onTurnedAway: () => alertOnce('full', `Blobocracy is full: ${relayRef?.players() ?? 0} players connected (capacity ${capacity()}, budget level ${budget.snapshot().level}). New visitors see the packed screen.`, now()),
    routes: (app) => {
      app.post('/a', (res, req) => {
        const ip = clientIp(res, req);
        readBody(res, 1024, (body) => {
          const ok = body !== null && beaconLimit.allow(ip, now()) && analytics.ingest(body, now());
          send(res, ok ? '204 No Content' : '400 Bad Request', 'text/plain', '', { 'cache-control': 'no-store' });
        });
      });
      app.get('/api/status', (res) => {
        const t = now();
        if (t - statusCache.at > 1000) {
          statusCache = { at: t, body: JSON.stringify({ deaths: world.deaths, run: world.run, online: voters.size(), record: world.record, packed: relay.players() >= capacity() }) };
        }
        budget.addBytes(send(res, '200 OK', 'application/json', statusCache.body, { 'cache-control': 'public, max-age=5' }));
      });
      app.get('/api/health', (res, req) => {
        const full = keyOk(query(req).get('key'), opts.adminKey);
        const m = process.memoryUsage();
        const body = {
          ok: health.last.tickHz > 50, tickHz: health.last.tickHz, frameHz: health.last.frameHz, maxLoopGapMs: health.last.maxGapMs,
          online: relay.players(), capacity: capacity(), level: budget.snapshot().level,
          ...(full ? { rssMb: Math.round(m.rss / 1e6), heapMb: Math.round(m.heapUsed / 1e6), cpu: process.cpuUsage(), budget: budget.snapshot() } : {}),
        };
        send(res, '200 OK', 'application/json', JSON.stringify(body), { 'cache-control': 'no-store' });
      });
      app.get('/stats', (res, req) => {
        const q = query(req);
        const key = q.get('key');
        if (!keyOk(key, opts.statsKey)) { send(res, '404 Not Found', 'text/plain', 'Not found'); return; }
        const days = Math.min(400, Math.max(1, Math.floor(Number(q.get('days') ?? 30)) || 30));
        const html = renderDashboard(analytics, now(), days, siteUrl, key!, { budget: budget.snapshot(), online: relay.players() });
        send(res, '200 OK', 'text/html; charset=utf-8', html, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' });
      });
      app.get('/stats.json', (res, req) => {
        if (!keyOk(query(req).get('key'), opts.statsKey)) { send(res, '404 Not Found', 'text/plain', 'Not found'); return; }
        send(res, '200 OK', 'application/json', JSON.stringify(analytics.data), { 'cache-control': 'no-store' });
      });
      // Raise the budget live: curl -X POST "https://…/admin/budget?key=$ADMIN_KEY&usd=100"
      app.any('/admin/budget', (res, req) => {
        const q = query(req);
        if (!keyOk(q.get('key'), opts.adminKey)) { send(res, '404 Not Found', 'text/plain', 'Not found'); return; }
        const usd = Number(q.get('usd'));
        if (req.getMethod() === 'post' && Number.isFinite(usd) && usd > 0 && usd < 100_000) budget.setMonthly(usd, now());
        send(res, '200 OK', 'application/json', JSON.stringify(budget.snapshot()), { 'cache-control': 'no-store' });
      });
      app.get('/*', (res, req) => {
        const sent = serveStatic(files, res, req);
        if (sent >= 0) budget.addBytes(sent);
        else send(res, '404 Not Found', 'text/plain', 'Not found');
      });
    },
  });
  relayRef = relay;
  const crowd = opts.virtualPlayers > 0 ? new VirtualCrowd(voters, opts.virtualPlayers, 42) : null;

  const save = () => {
    if (!dataDir) return;
    try {
      analytics.prune(now());
      writeJson(join(dataDir, 'analytics.json'), analytics.data);
      writeJson(join(dataDir, 'budget.json'), budget.state);
      analytics.dirty = false;
    } catch (e) { console.error('save failed', e); }
  };

  let simTime = clock();
  let lastLoop = performance.now();
  let lastBudgetTick = 0;
  let lastSave = now();
  const loop = setInterval(() => {
    const p = performance.now();
    health.maxGapMs = Math.max(health.maxGapMs, p - lastLoop);
    lastLoop = p;
    const tNow = clock();
    let steps = 0;
    const frameEvery = frameEveryFor(budget.level);
    while (simTime + DT <= tNow && steps < MAX_CATCHUP_STEPS) {
      simTime += DT;
      steps++;
      health.ticks++;
      crowd?.update(simTime, world);
      const counts = voters.counts(simTime);
      world.noteOnline(voters.size());
      for (const e of world.step(counts)) relay.broadcastEvent(e);
      if (world.tick % frameEvery === 0) {
        const { dots, dotJump } = voters.sample();
        const b = world.body, k = world.lastBlend;
        health.frames++;
        relay.broadcast(encodeState({
          tick: world.tick, run: world.run, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          grounded: b.grounded, facing: b.facing, phase: world.phase,
          pull: k.pull, pressure: k.pressure, strain: k.strain, jumpHeld: k.jumpHeld,
          online: voters.size(), active: counts.active, dots, dotJump,
        }));
      }
    }
    if (steps === MAX_CATCHUP_STEPS) simTime = tNow; // fell behind: drop time rather than spiral

    if (p - health.since >= 5000) {
      const s = (p - health.since) / 1000;
      health.last = { tickHz: Math.round((health.ticks / s) * 10) / 10, frameHz: Math.round((health.frames / s) * 10) / 10, maxGapMs: Math.round(health.maxGapMs) };
      if (health.last.tickHz < 50) alertOnce('lag', `Blobocracy server is falling behind: ${health.last.tickHz} ticks/s (target 60), ${relay.players()} players.`, now());
      health.ticks = health.frames = health.maxGapMs = 0;
      health.since = p;
    }
    const wall = now();
    if (wall - lastBudgetTick >= 1000) { budget.tick(wall); lastBudgetTick = wall; }
    if (wall - lastSave >= SAVE_EVERY_MS) { save(); lastSave = wall; }
  }, 4);

  return {
    port: relay.port,
    world,
    budget,
    analytics,
    players: () => relay.players(),
    health: () => health.last,
    stop: async () => { clearInterval(loop); save(); await relay.close(); },
  };
}
