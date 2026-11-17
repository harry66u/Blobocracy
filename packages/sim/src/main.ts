import { JsonFileStore, MemoryStore, alertSender } from './budget';
import { DEFAULT_BUDGET, startServer } from './server';

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
if (!env.BUDGET_STATE_FILE && linkPort !== null) console.warn('[budget] BUDGET_STATE_FILE unset: month-to-date spend is kept in memory only');

const srv = await startServer({
  port: localRelay ? port : null,
  virtualPlayers,
  link: linkPort === null ? undefined : { port: linkPort, host: env.SIM_LINK_HOST || '0.0.0.0', secret: env.RELAY_SECRET || undefined },
  budget,
  budgetStore: env.BUDGET_STATE_FILE ? new JsonFileStore(env.BUDGET_STATE_FILE) : new MemoryStore(),
  alert: alertSender(env.ALERT_WEBHOOK_URL || undefined),
  adminToken: env.ADMIN_TOKEN || undefined,
  alwaysOnRelays: num('ALWAYS_ON_RELAYS', 1),
  edgeCapacity: num('EDGE_CAPACITY', 3000),
});
console.log(`Blobocracy server${localRelay ? ` on :${srv.port}` : ''}${srv.linkPort ? ` (relay link :${srv.linkPort})` : ''} (${virtualPlayers} virtual players)`);
const shutdown = async () => { await srv.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
