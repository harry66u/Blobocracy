import {
  DEFAULT_LINK_SAMPLE, DT, FRAME_CRUMBLE_RANGE, LEVELS, MAX_FRAME_CRUMBLES, SAMPLE_SLOTS, TICK_HZ, encodeState, levelHash, levelTitle, nearbyCrumbles, trackId,
  type Level, type ServerEvent, type SimControl, type Tier,
} from '@blobocracy/shared';
import { createAdmin } from './admin';
import { createApi } from './api';
import { BudgetGovernor, MemoryStore as BudgetMemoryStore, alertSender, type BudgetAlert, type BudgetConfig, type CounterStore } from './budget';
import { Voters } from './crowd';
import { History } from './history';
import { startHub, type RelayInfo } from './hub';
import { LiveWriter, MemoryLiveStore, withTimeout, type LiveSnapshot, type LiveStore } from './live';
import { startLocalRelay, type Relay } from './relay';
import { MemoryStore, ResilientStore, type Store, type WorldRow } from './store';
import { VirtualCrowd } from './virtual';
import { World } from './world';

const MAX_CATCHUP_STEPS = 5;
const BUDGET_EVERY_MS = 5000;
const SAVE_EVERY_MS = 60_000;
const WELCOME_EVERY_MS = 2000;
/** Spec §9: the live snapshot is written every 2 s and on every event. */
const SNAPSHOT_EVERY_MS = 2000;

export const DEFAULT_BUDGET: BudgetConfig = {
  mode: 'cap', monthlyUsd: 50, alertUsd: 25,
  // Fly, Oct 2026: shared-cpu-1x 512 MB ≈ $3.70/month; Redis machine + volume ≈ $2.35/month; NA egress $0.02/GB.
  prices: { simHourly: 0.00507, edgeHourly: 0.00507, fixedMonthly: 2.35, egressPerGb: 0.02 },
};

export interface ServerOptions {
  /** Port for the in-process browser relay (single-process dev mode); null for none. */
  port?: number | null;
  virtualPlayers: number;
  /** Every level in order (default LEVELS): beating one unlocks the next; the last one encores. */
  levels?: readonly Level[];
  /** Shorthand for `levels: [level]`. */
  level?: Level;
  /** Celebration length after a win (default CELEBRATE_S; shorter in tests). */
  celebrateS?: number;
  /** NODE_ENV=production: the admin debug actions are refused. */
  production?: boolean;
  /** Internal relay link (split mode). */
  link?: { port: number; host?: string; secret?: string };
  budget?: BudgetConfig;
  budgetStore?: CounterStore;
  alert?: (a: BudgetAlert) => void;
  adminToken?: string;
  /** Relays that stay running on Fly (min_machines_running); the first ones to connect unless a relay claims it. */
  alwaysOnRelays?: number;
  /** Players one always-on relay holds before the 90%/100% tiers turn newcomers into watchers / packed. */
  edgeCapacity?: number;
  now?: () => number;
  /** Long-term storage (runs, clips, hall of fame); default in memory. Wrapped so outages only queue writes. */
  store?: Store;
  /** The live snapshot (Redis, file or memory) the sim resumes from after a restart. */
  live?: LiveStore;
  log?: (msg: string) => void;
  /** How often to retry the world row after booting without it (default 10 s). */
  worldRetryMs?: number;
  /** How often to retry loading the budget counters after a failed load at boot (default 5 s). */
  budgetRetryMs?: number;
}

/**
 * Wires the world, voters, optional virtual crowd, the local relay (dev) and the relay link
 * (split mode) into a 60 Hz loop, with the budget governor deciding the frame rate and admission.
 */
export async function startServer(opts: ServerOptions) {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console.log;
  const levels: readonly Level[] = opts.levels?.length ? opts.levels : opts.level ? [opts.level] : LEVELS;
  const lastLevel = levels[levels.length - 1]!;
  /** Every track that can be played: each level, and the encore of the last one. */
  const tracks = [...levels.map((l) => l.id), trackId(lastLevel.id, true)];
  const ensureTrack = (level: Level, encore: boolean) => store.ensureLevel({
    id: trackId(level.id, encore), name: levelTitle(level) + (encore ? ' (encore)' : ''), version: level.version, geometryHash: levelHash(level),
  });

  // ---- persistence: storage, the world rows and the live snapshot (spec §9, §10) ----------------
  const store = opts.store instanceof ResilientStore ? opts.store : new ResilientStore(opts.store ?? new MemoryStore(), { log });
  await store.init();
  for (const l of levels) void ensureTrack(l, false);
  const liveStore = opts.live ?? new MemoryLiveStore();
  let dbFailed = false;
  const [db, live] = await Promise.all([
    withTimeout(Promise.all([store.hallOfFame(), Promise.all(tracks.map((t) => store.loadWorld(t)))]), 5000, 'world rows')
      .catch((e: unknown) => { dbFailed = true; log(`[store] world rows unavailable at boot: ${String(e)}`); return null; }),
    withTimeout(liveStore.load(), 3000, 'live snapshot').catch((e: unknown) => { log(`[live] snapshot unavailable at boot: ${String(e)}`); return null; }),
  ]);
  const rows = new Map<number, WorldRow>();
  db?.[1].forEach((w, i) => { if (w) rows.set(tracks[i]!, w); });
  const beaten = new Set(db?.[0].map((h) => h.levelId) ?? []);
  // where play is: the live snapshot's level when it is at least as new as the database, else the first level not yet beaten
  const liveLevel = live ? levels.find((l) => l.id === live.levelId) : undefined;
  const liveEncore = live?.world.encore ?? live?.encore ?? false;
  const liveUsed = !!live && !!liveLevel && live.world.deaths >= (rows.get(trackId(liveLevel.id, liveEncore))?.deaths ?? 0);
  let bootLevel = levels.find((l) => !beaten.has(l.id)) ?? lastLevel;
  let bootEncore = levels.every((l) => beaten.has(l.id));
  if (liveUsed) { bootLevel = liveLevel!; bootEncore = liveEncore; }
  const counters = (track: number) => {
    const w = rows.get(track);
    return { deaths: w?.deaths ?? 0, record: w?.record ? { progress: w.record.progress, run: w.record.run } : null, ...(w?.nextRun ? { run: w.nextRun } : {}) };
  };
  const bootTrack = trackId(bootLevel.id, bootEncore);
  const world = new World(bootLevel, counters(bootTrack), { levels, encore: bootEncore, celebrateS: opts.celebrateS });
  const history = new History({ store, level: bootLevel, encore: bootEncore, log });
  for (const t of tracks) {
    if (t !== bootTrack && rows.has(t)) world.setCounters(t, counters(t));
    const w = rows.get(t);
    if (w) history.setTrackPeak(t, w.peakPlayers);
  }
  const dbWorld = rows.get(bootTrack) ?? null;
  if (dbWorld) history.recordVersion = dbWorld.record?.version ?? null;
  if (bootEncore) void ensureTrack(bootLevel, true);
  const bans = new Set<string>();
  if (live && liveUsed) {
    // the snapshot is at least as new as the database: carry on the run in progress (a restart is not a death)
    if (live.version === bootLevel.version) {
      world.restore(live.world);
      history.restore(live, live.world.phase === 'dying');
      log(`[live] resumed ${levelTitle(world.level)}${world.encore ? ' (encore)' : ''} run ${world.run} at ${Math.round(world.maxProgress * 100)}% (${world.deaths} deaths)`);
    } else {
      // retuned level: keep the death count and record, start a fresh run on the new version
      world.deaths = live.world.deaths;
      // a fresh run: after the one in progress (or the one that just ended), never below deaths + 1
      world.run = Math.max(world.deaths + 1, live.world.run + (live.world.phase === 'running' || live.world.phase === 'paused' ? 0 : 1));
      world.record = live.world.record;
      for (const [k, c] of live.world.counters ?? []) world.setCounters(k, c);
      history.restore(live, true);
      log(`[live] level ${bootLevel.id} is now version ${bootLevel.version}; starting run ${world.run}`);
    }
    for (const b of live.bans ?? []) bans.add(b);
  } else if (dbWorld) {
    log(`[store] starting ${levelTitle(bootLevel)} run ${world.run} (${world.deaths} deaths from the database)`);
  }
  // a clip announced before the restart can't be made any more: its link says so (M6)
  if (live?.pendingClip) history.markLost(live.pendingClip);
  // Booted with neither the database nor a snapshot: the counters started from zero. When the
  // database answers, carry its deaths and record forward (runs numbered during the gap are not
  // written over older ones: the store never replaces an existing run).
  let catchUp: ReturnType<typeof setInterval> | undefined;
  if (dbFailed && !liveUsed) {
    catchUp = setInterval(() => {
      const track = world.track;
      void store.loadWorld(track).then((w) => {
        clearInterval(catchUp);
        if (!w || w.deaths <= 0 || world.track !== track) return;
        world.deaths += w.deaths;
        world.run += Math.max(w.deaths, (w.nextRun ?? 0) - 1);
        if (w.record && (!world.record || w.record.progress >= world.record.progress)) world.record = { progress: w.record.progress, run: w.record.run };
        history.peakPlayers = Math.max(history.peakPlayers, w.peakPlayers);
        log(`[store] database is back: counting on from ${world.deaths} deaths (run ${world.run})`);
        hub?.sendAll(welcome());
      }, () => {});
    }, opts.worldRetryMs ?? 10_000);
  }
  const writer = new LiveWriter(liveStore, log);
  const snapshot = (): LiveSnapshot => ({
    v: 1, levelId: world.level.id, version: world.level.version, encore: world.encore, world: world.snapshot(), ...history.live(), bans: [...bans], savedAt: Date.now(),
  });
  const saveSnapshot = () => writer.save(snapshot());

  const voters = new Voters();
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const governor = new BudgetGovernor(opts.budget ?? DEFAULT_BUDGET, {
    store: opts.budgetStore ?? new BudgetMemoryStore(),
    alert: opts.alert ?? alertSender(undefined),
    now,
  });
  // Until the month's counters are read the governor saves nothing (else zeros would overwrite the
  // real spend); keep retrying in the background, and merge when they arrive.
  await withTimeout(governor.load(), 3000, 'budget counters').catch((e: unknown) => log(`[budget] counters unavailable at boot: ${String(e)}; retrying, nothing is saved until they load`));
  let budgetRetry: ReturnType<typeof setInterval> | undefined;
  if (!governor.loaded) {
    let trying = false;
    budgetRetry = setInterval(() => {
      if (governor.loaded) { clearInterval(budgetRetry); return; }
      if (trying) return;
      trying = true;
      void withTimeout(governor.load(), 3000, 'budget counters').then(() => {
        clearInterval(budgetRetry);
        log(`[budget] counters loaded: $${governor.spend().toFixed(2)} spent this month`);
      }, () => {}).finally(() => { trying = false; });
    }, opts.budgetRetryMs ?? 5000);
  }
  const alwaysOnRelays = opts.alwaysOnRelays ?? 1;
  const edgeCapacity = opts.edgeCapacity ?? 3000;

  const api = createApi({
    store, level: world.level, history, levelName: levelTitle(world.level), levels,
    current: () => ({ level: world.level, name: levelTitle(world.level), encore: world.encore }),
    counter: () => ({ deaths: world.deaths, run: world.run, record: world.record, online: voters.size() }),
  });
  const local = opts.port === null || opts.port === undefined && opts.link ? null
    : await startLocalRelay({ port: opts.port ?? 8080, voters, world, clock, api, admin: (r) => admin(r) });
  const crowd = opts.virtualPlayers > 0 ? new VirtualCrowd(voters, opts.virtualPlayers, 42) : null;

  const welcome = (): SimControl => ({ c: 'welcome', ev: world.welcome(voters.size()) });
  const alwaysOnIds = (rs: RelayInfo[]) => {
    const claimed = rs.filter((r) => r.claimsAlwaysOn);
    return new Set((claimed.length ? claimed : rs).slice(0, alwaysOnRelays).map((r) => r.id));
  };
  const policyFor = (id: number, rs: RelayInfo[]): SimControl => ({
    c: 'policy',
    tier: governor.tier() as Tier,
    frameHz: governor.frameHz(),
    alwaysOn: alwaysOnIds(rs).has(id),
    sampleQuota: Math.max(DEFAULT_LINK_SAMPLE, Math.floor(SAMPLE_SLOTS / Math.max(1, rs.length))),
    capacity: edgeCapacity,
  });
  let hub: Awaited<ReturnType<typeof startHub>> | null = null;
  const pushPolicies = () => {
    if (!hub) return;
    const rs = hub.relays();
    for (const r of rs) hub.send(r.id, policyFor(r.id, rs));
  };
  const relayPrices = () => hub ? hub.relays().map((r) => r.hourlyUsd ?? (opts.budget ?? DEFAULT_BUDGET).prices.edgeHourly) : [];

  const stats = () => ({
    world: { level: world.level.id, encore: world.encore, tick: world.tick, run: world.run, deaths: world.deaths, phase: world.phase, record: world.record },
    online: voters.size(), active: lastCounts.active,
    frameHz: governor.frameHz(),
    relays: hub ? hub.relays() : [],
    edgeToSimMs: hub ? hub.latency.summary() : null,
    store: store.status(),
    live: { writes: writer.writes },
    clips: history.clipsMade,
  });
  const admin = createAdmin({
    token: opts.adminToken, governor, stats,
    control: (c) => hub?.sendAll(c),
    onBudget: () => { pushPolicies(); void governor.save().catch(() => {}); },
    bans,
    onBans: saveSnapshot,
    production: opts.production ?? process.env.NODE_ENV === 'production',
    debugWin: () => {
      const ok = world.debugNearGoal();
      if (ok) { log(`[admin] debug: the blob is just before the goal of ${levelTitle(world.level)}`); saveSnapshot(); }
      return ok;
    },
  });

  if (opts.link) {
    hub = await startHub({
      port: opts.link.port, host: opts.link.host, secret: opts.link.secret, voters, admin, api,
      onBytes: (b) => governor.addEgress(b),
      onRelaysChanged: pushPolicies,
      greet: (id) => [welcome(), { c: 'bans', cidrs: [...bans] }],
    });
  }
  const outs: Relay[] = [local, hub].filter((r): r is NonNullable<typeof r> => r !== null);

  let lastCounts = { left: 0, right: 0, jump: 0, active: 0, fresh: 0 };
  let frameEvery = Math.round(TICK_HZ / governor.frameHz());
  let simTime = clock();
  const loop = setInterval(() => {
    const t = clock();
    let steps = 0;
    while (simTime + DT <= t && steps < MAX_CATCHUP_STEPS) {
      simTime += DT;
      steps++;
      crowd?.update(simTime, world);
      const counts = voters.counts(simTime);
      lastCounts = { ...counts, fresh: counts.fresh ?? 0 };
      if (hub) {
        const wall = Date.now();
        for (const at of hub.takeInputTimes()) hub.latency.add(wall - at);
      }
      const online = voters.size();
      history.observe(world, online);
      const recordBefore = world.record;
      const stepped = world.step(counts);
      const events: ServerEvent[] = stepped.length ? [...stepped, ...history.onEvents(stepped, world, recordBefore)] : stepped;
      for (const e of events) for (const o of outs) o.broadcastEvent(e);
      if (events.some((e) => e.t === 'level')) {
        // a new level: everyone gets a fresh welcome for it (spec §6.7)
        if (world.encore) void ensureTrack(world.level, true);
        const w = world.welcome(online);
        for (const o of outs) o.broadcastEvent(w);
        log(`[win] on to ${levelTitle(world.level)}${world.encore ? ' (encore)' : ''}: run ${world.run}, ${world.deaths} deaths`);
      }
      if (events.length) { if (hub) hub.sendAll(welcome()); saveSnapshot(); }
      if (world.tick % frameEvery === 0) {
        const { dots, dotJump } = voters.sample();
        const b = world.body, k = world.lastBlend, dyn = world.dyn;
        const frame = encodeState({
          tick: world.tick, run: world.run, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
          grounded: b.grounded, facing: b.facing, phase: world.phase,
          pull: k.pull, pressure: k.pressure, strain: k.strain, jumpHeld: k.jumpHeld,
          online: voters.size(), active: counts.active, dots, dotJump,
          runTime: dyn.t, chompStart: dyn.chompStart,
          crumbles: nearbyCrumbles(dyn, world.level, b.x, FRAME_CRUMBLE_RANGE, MAX_FRAME_CRUMBLES),
        });
        for (const o of outs) o.broadcast(frame);
        history.onFrame(frame, world, online);
      }
    }
    if (steps === MAX_CATCHUP_STEPS) simTime = t; // fell behind: drop time rather than spiral
  }, 4);

  let lastTier = governor.tier();
  const budgetTick = () => {
    governor.update(relayPrices());
    frameEvery = Math.round(TICK_HZ / governor.frameHz());
    if (governor.tier() !== lastTier) {
      lastTier = governor.tier();
      console.log(`[budget] tier ${lastTier} (spend $${governor.spend().toFixed(2)} of $${governor.budget()})`);
      pushPolicies();
      void governor.save().catch(() => {});
    }
  };
  const budgetTimer = setInterval(budgetTick, BUDGET_EVERY_MS);
  const saveTimer = setInterval(() => { void governor.save().catch((e) => console.error('[budget] save failed', e)); }, SAVE_EVERY_MS);
  const welcomeTimer = setInterval(() => hub?.sendAll(welcome()), WELCOME_EVERY_MS);
  const snapshotTimer = setInterval(saveSnapshot, SNAPSHOT_EVERY_MS);
  saveSnapshot();

  return {
    port: local?.port ?? 0,
    linkPort: hub?.port ?? 0,
    world,
    voters,
    governor,
    store,
    history,
    api,
    /** Writes the live snapshot now and waits for it (tests). */
    snapshotNow: async () => { saveSnapshot(); await writer.flush(); },
    relayCount: () => hub?.relays().length ?? 0,
    /** Re-evaluates the budget now (tests; normally every 5 s). */
    budgetTick,
    stop: async () => {
      clearInterval(loop); clearInterval(budgetTimer); clearInterval(saveTimer); clearInterval(welcomeTimer); clearInterval(snapshotTimer); clearInterval(catchUp); clearInterval(budgetRetry);
      governor.update(relayPrices());
      await governor.save().catch(() => {});
      saveSnapshot();
      await writer.flush();
      await withTimeout(store.drained(), 3000, 'store queue').catch((e: unknown) => log(`[store] ${String(e)}; ${store.status().queued} writes not saved`));
      for (const o of outs) await o.close();
    },
  };
}
