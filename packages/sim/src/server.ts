import {
  DEFAULT_LINK_SAMPLE, DT, FRAME_CRUMBLE_RANGE, LEVEL1, MAX_FRAME_CRUMBLES, SAMPLE_SLOTS, TICK_HZ, encodeState, nearbyCrumbles,
  type Level, type SimControl, type Tier,
} from '@blobocracy/shared';
import { createAdmin } from './admin';
import { BudgetGovernor, MemoryStore, alertSender, type BudgetAlert, type BudgetConfig, type CounterStore } from './budget';
import { Voters } from './crowd';
import { startHub, type RelayInfo } from './hub';
import { startLocalRelay, type Relay } from './relay';
import { VirtualCrowd } from './virtual';
import { World } from './world';

const MAX_CATCHUP_STEPS = 5;
const BUDGET_EVERY_MS = 5000;
const SAVE_EVERY_MS = 60_000;
const WELCOME_EVERY_MS = 2000;

export const DEFAULT_BUDGET: BudgetConfig = {
  mode: 'cap', monthlyUsd: 50, alertUsd: 25,
  // Fly, Oct 2026: shared-cpu-1x 512 MB ≈ $3.70/month; Redis machine + volume ≈ $2.35/month; NA egress $0.02/GB.
  prices: { simHourly: 0.00507, edgeHourly: 0.00507, fixedMonthly: 2.35, egressPerGb: 0.02 },
};

export interface ServerOptions {
  /** Port for the in-process browser relay (single-process dev mode); null for none. */
  port?: number | null;
  virtualPlayers: number;
  level?: Level;
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
}

/**
 * Wires the world, voters, optional virtual crowd, the local relay (dev) and the relay link
 * (split mode) into a 60 Hz loop, with the budget governor deciding the frame rate and admission.
 */
export async function startServer(opts: ServerOptions) {
  const now = opts.now ?? Date.now;
  const world = new World(opts.level ?? LEVEL1);
  const voters = new Voters();
  const t0 = performance.now();
  const clock = () => (performance.now() - t0) / 1000;
  const governor = new BudgetGovernor(opts.budget ?? DEFAULT_BUDGET, {
    store: opts.budgetStore ?? new MemoryStore(),
    alert: opts.alert ?? alertSender(undefined),
    now,
  });
  await governor.load();
  const alwaysOnRelays = opts.alwaysOnRelays ?? 1;
  const edgeCapacity = opts.edgeCapacity ?? 3000;

  const local = opts.port === null || opts.port === undefined && opts.link ? null
    : await startLocalRelay({ port: opts.port ?? 8080, voters, world, clock });
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
  const bans = new Set<string>();

  let hub: Awaited<ReturnType<typeof startHub>> | null = null;
  const pushPolicies = () => {
    if (!hub) return;
    const rs = hub.relays();
    for (const r of rs) hub.send(r.id, policyFor(r.id, rs));
  };
  const relayPrices = () => hub ? hub.relays().map((r) => r.hourlyUsd ?? (opts.budget ?? DEFAULT_BUDGET).prices.edgeHourly) : [];

  const stats = () => ({
    world: { tick: world.tick, run: world.run, deaths: world.deaths, phase: world.phase, record: world.record },
    online: voters.size(), active: lastCounts.active,
    frameHz: governor.frameHz(),
    relays: hub ? hub.relays() : [],
    edgeToSimMs: hub ? hub.latency.summary() : null,
  });
  const admin = createAdmin({
    token: opts.adminToken, governor, stats,
    control: (c) => hub?.sendAll(c),
    onBudget: () => { pushPolicies(); void governor.save(); },
    bans,
  });

  if (opts.link) {
    hub = await startHub({
      port: opts.link.port, host: opts.link.host, secret: opts.link.secret, voters, admin,
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
      const events = world.step(counts);
      for (const e of events) for (const o of outs) o.broadcastEvent(e);
      if (events.length && hub) hub.sendAll(welcome());
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
      void governor.save();
    }
  };
  const budgetTimer = setInterval(budgetTick, BUDGET_EVERY_MS);
  const saveTimer = setInterval(() => { void governor.save().catch((e) => console.error('[budget] save failed', e)); }, SAVE_EVERY_MS);
  const welcomeTimer = setInterval(() => hub?.sendAll(welcome()), WELCOME_EVERY_MS);

  return {
    port: local?.port ?? 0,
    linkPort: hub?.port ?? 0,
    world,
    voters,
    governor,
    relayCount: () => hub?.relays().length ?? 0,
    /** Re-evaluates the budget now (tests; normally every 5 s). */
    budgetTick,
    stop: async () => {
      clearInterval(loop); clearInterval(budgetTimer); clearInterval(saveTimer); clearInterval(welcomeTimer);
      governor.update(relayPrices());
      await governor.save().catch(() => {});
      for (const o of outs) await o.close();
    },
  };
}
