// Runs the game server and the Vite client together.
//   npm run dev                 just you
//   npm run dev -- --bots 300   you plus 300 virtual players
// Env: PORT (server, default 8080), VIRTUAL_PLAYERS (same as --bots).
import { spawn } from 'node:child_process';
const i = process.argv.indexOf('--bots');
const bots = i > 0 ? Number(process.argv[i + 1]) : Number(process.env.VIRTUAL_PLAYERS ?? 0);
if (!Number.isFinite(bots) || bots < 0) { console.error('--bots needs a number, e.g. --bots 300'); process.exit(1); }
const env = { ...process.env, VIRTUAL_PLAYERS: String(bots) };
const shell = process.platform === 'win32';
const procs = [
  spawn('npx', ['tsx', 'watch', 'packages/sim/src/main.ts'], { stdio: 'inherit', env, shell }),
  spawn('npx', ['vite', 'packages/client', '--host', '--port', '5173'], { stdio: 'inherit', env, shell }),
];
console.log(`\n  Blobocracy dev: open http://localhost:5173  (${bots} bots)\n`);
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
