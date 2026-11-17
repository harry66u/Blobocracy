// Game server entry. Environment:
//   PORT                 listen port (default 8080)
//   VIRTUAL_PLAYERS      in-process bot crowd for testing (default 0)
//   STATIC_DIR           built client to serve (default: packages/client/dist if it exists)
//   DATA_DIR             where analytics and the spend estimate are saved (default ./data)
//   SITE_URL             public address, used on the stats page's tracking links
//   STATS_KEY            secret for /stats?key=…   (page is hidden without it)
//   ADMIN_KEY            secret for /admin/budget and detailed /api/health
//   ALERT_WEBHOOK_URL    Discord or Slack incoming webhook for alerts
//   BUDGET_MODE          cap (default) or alert
//   MONTHLY_BUDGET_USD   default 50;  BUDGET_ALERT_USD default 25
//   BASE_MONTHLY_USD     always-on machine cost per month (default 10)
//   EGRESS_USD_PER_GB    default 0.02 (Fly, North America)
//   MAX_PLAYERS          hard connection cap (default 5000)
//   BASE_CAPACITY        players allowed at ≥90% of budget (default 2000)
//   PACKED_CAPACITY      players allowed at ≥100% of budget (default 100)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeAlerter } from './alerts';
import { defaultBudgetConfig } from './budget';
import { startServer } from './server';

const env = process.env;
const int = (k: string, d: number) => (env[k] && Number.isFinite(Number(env[k])) ? Math.floor(Number(env[k])) : d);
const builtClient = fileURLToPath(new URL('../../client/dist', import.meta.url));
const staticDir = env.STATIC_DIR ?? (existsSync(builtClient) ? builtClient : undefined);

const srv = await startServer({
  port: int('PORT', 8080),
  virtualPlayers: int('VIRTUAL_PLAYERS', 0),
  staticDir,
  dataDir: env.DATA_DIR ?? 'data',
  siteUrl: env.SITE_URL,
  statsKey: env.STATS_KEY,
  adminKey: env.ADMIN_KEY,
  budget: defaultBudgetConfig(env),
  maxPlayers: int('MAX_PLAYERS', 5000),
  baseCapacity: int('BASE_CAPACITY', 2000),
  packedCapacity: int('PACKED_CAPACITY', 100),
  alert: makeAlerter(env.ALERT_WEBHOOK_URL),
});
console.log(`Blobocracy server on :${srv.port} (${env.VIRTUAL_PLAYERS ?? 0} virtual players)${staticDir ? `, serving ${staticDir}` : ''}`);
if (!env.STATS_KEY) console.log('STATS_KEY is not set: the /stats page is disabled.');
if (!env.ALERT_WEBHOOK_URL) console.log('ALERT_WEBHOOK_URL is not set: budget and capacity alerts go to this log only.');

const shutdown = async () => { await srv.stop(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
