import { readFileSync } from 'node:fs';
import { LEVEL1 } from '@blobocracy/shared';
import { JsonFileStore, MemoryStore, RedisCounterStore, alertSender, type CounterStore } from './budget';
import { FileLiveStore, MemoryLiveStore, RedisLiveStore, connectRedis, type LiveStore } from './live';
import { DEFAULT_BUDGET, startServer } from './server';
import { MemoryStore as MemoryDataStore, createStore } from './store';
import { seedDemoRuns } from './store/seed';

/** Env vars are documented in fly.toml. */
const env = process.env;
const num = (name: string, fallback: number) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
};

const localRelay = env.LOCAL_RELAY !== '0';
const port = num('PORT', 8080);
const virtualPlayers = num('VIRTUAL_PLAYERS', 0);
const linkPort = env.SIM_LINK_PORT ? num('SIM_LINK_PORT', 8081) : localRelay ? null : 8081;
if (env.BUDGET_MODE && env.BUDGET_MODE !== 'cap' && env.BUDGET_MODE !== 'alert') throw new Error('BUDGET_MODE must be cap or alert');
const mode = env.BUDGET_MODE === 'alert' ? 'alert' : 'cap';
const p = DEFAULT_BUDGET.prices;
const budget = {
  mode, monthlyUsd: num('MONTHLY_BUDGET_USD', 50), alertUsd: num('BUDGET_ALERT_USD', 25),
  prices: {
    simHourly: num('PRICE_SIM_HOURLY_USD', p.simHourly),
    edgeHourly: num('PRICE_EDGE_HOURLY_USD', p.edgeHourly),
    fixedMonthly: num('PRICE_FIXED_MONTHLY_USD', p.fixedMonthly),
    egressPerGb: num('EGRESS_USD_PER_GB', p.egressPerGb),
  },
} as const;

// Persistence (spec §9): Postgres for history, Redis for the live snapshot and shared counters.
// Neither is required: without them everything lives in memory (or LIVE_STATE_FILE / BUDGET_STATE_FILE).
const redis = env.REDIS_URL ? await connectRedis(env.REDIS_URL, 'blobocracy-sim') : null;
const budgetStore: CounterStore = redis ? new RedisCounterStore(redis)
  : env.BUDGET_STATE_FILE ? new JsonFileStore(env.BUDGET_STATE_FILE) : new MemoryStore();
const live: LiveStore = redis ? new RedisLiveStore(redis) : env.LIVE_STATE_FILE ? new FileLiveStore(env.LIVE_STATE_FILE) : new MemoryLiveStore();
if (!redis && !env.BUDGET_STATE_FILE && linkPort !== null) console.warn('[budget] REDIS_URL and BUDGET_STATE_FILE unset: month-to-date spend is kept in memory only');
if (!env.DATABASE_URL) console.warn('[store] DATABASE_URL unset: run history, clips and the hall of fame are kept in memory only');
const store = await createStore(env.DATABASE_URL || undefined);
const seedRuns = num('SEED_DEMO_RUNS', 0);
if (seedRuns > 0) {
  if (!(store instanceof MemoryDataStore)) throw new Error('SEED_DEMO_RUNS only works without DATABASE_URL (it fills the in-memory store)');
  let clipReplay: Uint8Array | undefined;
  try { clipReplay = readFileSync(new URL('../../client/public/fixtures/near-miss.replay', import.meta.url)); } catch { /* no demo clips */ }
  const r = await seedDemoRuns(store, { runs: seedRuns, level: LEVEL1, now: Date.now(), clipReplay, beaten: env.SEED_DEMO_BEATEN === '1' });
  console.log(`[store] seeded ${seedRuns} demo runs (${r.deaths} deaths, record ${Math.round((r.record?.progress ?? 0) * 100)}%)`);
}

const srv = await startServer({
  port: localRelay ? port : null,
  virtualPlayers,
  link: linkPort === null ? undefined : { port: linkPort, host: env.SIM_LINK_HOST || '0.0.0.0', secret: env.RELAY_SECRET || undefined },
  budget,
  budgetStore,
  store,
  live,
  alert: alertSender(env.ALERT_WEBHOOK_URL || undefined),
  adminToken: env.ADMIN_TOKEN || undefined,
  alwaysOnRelays: num('ALWAYS_ON_RELAYS', 1),
  edgeCapacity: num('EDGE_CAPACITY', 3000),
});
console.log(`Blobocracy server${localRelay ? ` on :${srv.port}` : ''}${srv.linkPort ? ` (relay link :${srv.linkPort})` : ''} (${virtualPlayers} virtual players)`);
const shutdown = async () => { await srv.stop(); await srv.store.close(); redis?.disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
