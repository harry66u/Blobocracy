// Runs the game server and the Vite client together.
//   npm run dev                 just you
//   npm run dev -- --bots 300   you plus 300 virtual players
//   npm run dev -- --seed 2000  plus 2,000 fake past runs for /runs and /hall (in memory)
// No database or Redis needed: without DATABASE_URL / REDIS_URL everything is kept in memory.
// Env: PORT (server, default 8080), VIRTUAL_PLAYERS (same as --bots).
import { spawn } from 'node:child_process';

// The game server's WebSocket library (uWebSockets.js v20.52) ships for Node 20, 22, 23 and 24 only.
// On another version the server would quit at startup while the website kept loading forever.
const major = Number(process.versions.node.split('.')[0]);
if (![20, 22, 23, 24].includes(major)) {
  console.error(`\n  Blobocracy needs Node.js 22 or 24 (you have ${process.version}).`);
  console.error('  Install Node 24 LTS from https://nodejs.org, open a new Terminal, then run:');
  console.error('    rm -rf node_modules && npm install && npm run dev\n');
  process.exit(1);
}
const i = process.argv.indexOf('--bots');
const bots = i > 0 ? Number(process.argv[i + 1]) : Number(process.env.VIRTUAL_PLAYERS ?? 0);
if (!Number.isFinite(bots) || bots < 0) { console.error('--bots needs a number, e.g. --bots 300'); process.exit(1); }
// --seed 2000: fill the in-memory history with fake runs so /runs and /hall have something to show
const si = process.argv.indexOf('--seed');
const seed = si > 0 ? Number(process.argv[si + 1]) : Number(process.env.SEED_DEMO_RUNS ?? 0);
if (!Number.isFinite(seed) || seed < 0) { console.error('--seed needs a number, e.g. --seed 2000'); process.exit(1); }
const env = { ...process.env, VIRTUAL_PLAYERS: String(bots), SEED_DEMO_RUNS: String(seed) };
const shell = process.platform === 'win32';
const procs = [
  spawn('npx', ['tsx', 'watch', 'packages/sim/src/main.ts'], { stdio: 'inherit', env, shell }),
  spawn('npx', ['vite', 'packages/client', '--host', '--port', '5173'], { stdio: 'inherit', env, shell }),
];
console.log(`\n  Blobocracy dev: open http://localhost:5173  (${bots} bots)  history: http://localhost:5173/runs  http://localhost:5173/hall\n`);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
