import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startEdge } from './server';
import { RedisAbuseShare, type AbuseShare } from './shared';

/** Env vars are documented in fly.toml. */
const env = process.env;
const num = (name: string, fallback: number) => {
  const v = env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`);
  return n;
};

let secret = env.SESSION_SECRET;
if (!secret) {
  if (env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production (fly secrets set SESSION_SECRET=...)');
  secret = randomBytes(32).toString('hex');
  console.warn('[edge] SESSION_SECRET unset: using a random one (tokens only work on this edge)');
}
if (env.TRUST_TEST_IP_HEADER === '1' && env.NODE_ENV === 'production') throw new Error('TRUST_TEST_IP_HEADER must never be set in production');

const simUrl = env.SIM_URL || 'ws://localhost:8081/relay';
const name = env.EDGE_NAME || env.FLY_MACHINE_ID || `edge-${randomBytes(3).toString('hex')}`;

// REDIS_URL: per-IP socket caps and abuse flags are shared by every relay (spec §9).
let edgeRef: { ipConns(): Map<string, number> } | null = null;
let abuse: AbuseShare | undefined;
let redis: import('ioredis').Redis | null = null;
if (env.REDIS_URL) {
  const { Redis } = await import('ioredis');
  redis = new Redis(env.REDIS_URL, { connectionName: `blobocracy-${name}`, maxRetriesPerRequest: 2, connectTimeout: 3000, enableAutoPipelining: true });
  let warned = false;
  redis.on('error', (e: Error) => { if (!warned) { warned = true; console.warn(`[redis] ${e.message} (abuse state falls back to this relay)`); } });
  redis.on('ready', () => { warned = false; });
  abuse = new RedisAbuseShare(redis, name, () => edgeRef?.ipConns() ?? new Map());
}

const edge = await startEdge({
  port: num('PORT', 8080),
  host: env.HOST || '0.0.0.0',
  simUrl,
  relaySecret: env.RELAY_SECRET || undefined,
  sessionSecret: secret,
  powBits: num('POW_DIFFICULTY', 14),
  tokenTtlS: num('SESSION_TTL_S', 600),
  ipVoteCap: num('IP_VOTE_CAP', 4),
  ipConnCap: num('IP_CONN_CAP', 32),
  rateLimit: num('INPUT_RATE_LIMIT', 20),
  staticDir: env.STATIC_DIR || fileURLToPath(new URL('../../client/dist', import.meta.url)),
  trustTestIpHeader: env.TRUST_TEST_IP_HEADER === '1',
  name,
  alwaysOn: env.EDGE_ALWAYS_ON === '1' ? true : undefined,
  hourlyUsd: env.MACHINE_HOURLY_USD ? num('MACHINE_HOURLY_USD', 0) : undefined,
  egressOverheadBytes: num('EGRESS_OVERHEAD_BYTES', 80),
  latencyProbe: env.LATENCY_PROBE === '1',
  simHttpUrl: env.SIM_HTTP_URL || undefined,
  publicUrl: env.PUBLIC_URL || undefined,
  abuse,
});
edgeRef = edge;
console.log(`Blobocracy edge ${edge.name} on :${edge.port} -> ${simUrl}`);
const shutdown = async () => { await edge.stop(); redis?.disconnect(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
