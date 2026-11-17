// Runs the production shape locally: one sim + two edge relays as separate processes, plus Vite.
//   npm run dev:split                 open http://localhost:5173 (edge A) and http://localhost:5174 (edge B)
//   npm run dev:split -- --bots 300   plus 300 in-process virtual players on the sim
// Ports: sim relay link :8081, edge A :8080, edge B :8082. Admin: Bearer "dev" on any edge's /admin/stats.
// Pages get a session token with proof of work first (POW_DIFFICULTY, default 14 bits).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const i = process.argv.indexOf('--bots');
const bots = i > 0 ? Number(process.argv[i + 1]) : Number(process.env.VIRTUAL_PLAYERS ?? 0);
if (!Number.isFinite(bots) || bots < 0) { console.error('--bots needs a number, e.g. --bots 300'); process.exit(1); }
// --seed 2000: fill the in-memory history with fake runs so /runs and /hall have something to show
const si = process.argv.indexOf('--seed');
const seed = si > 0 ? Number(process.argv[si + 1]) : Number(process.env.SEED_DEMO_RUNS ?? 0);
if (!Number.isFinite(seed) || seed < 0) { console.error('--seed needs a number, e.g. --seed 2000'); process.exit(1); }
const shell = process.platform === 'win32';
const base = {
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(16).toString('hex'),
  RELAY_SECRET: process.env.RELAY_SECRET ?? randomBytes(8).toString('hex'),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? 'dev',
};
const run = (args, env) => spawn('npx', args, { stdio: 'inherit', env: { ...base, ...env }, shell });
const procs = [
  run(['tsx', 'watch', 'packages/sim/src/main.ts'], { LOCAL_RELAY: '0', SIM_LINK_PORT: '8081', VIRTUAL_PLAYERS: String(bots), SEED_DEMO_RUNS: String(seed) }),
  run(['tsx', 'watch', 'packages/edge/src/main.ts'], { PORT: '8080', SIM_URL: 'ws://localhost:8081/relay', EDGE_NAME: 'edge-a', EDGE_ALWAYS_ON: '1' }),
  run(['tsx', 'watch', 'packages/edge/src/main.ts'], { PORT: '8082', SIM_URL: 'ws://localhost:8081/relay', EDGE_NAME: 'edge-b' }),
  run(['vite', 'packages/client', '--host', '--port', '5173', '--strictPort'], { PORT: '8080', BLOB_SESSION: '1' }),
  run(['vite', 'packages/client', '--host', '--port', '5174', '--strictPort'], { PORT: '8082', BLOB_SESSION: '1' }),
];
console.log(`\n  Blobocracy split dev: http://localhost:5173 (edge A) and http://localhost:5174 (edge B), ${bots} bots\n`);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
