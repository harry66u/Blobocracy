// Runs the game server and the Vite client together. Env: PORT, VIRTUAL_PLAYERS.
import { spawn } from 'node:child_process';
const procs = [
  spawn('npx', ['tsx', 'watch', 'packages/sim/src/main.ts'], { stdio: 'inherit', env: process.env }),
  spawn('npx', ['vite', 'packages/client', '--host'], { stdio: 'inherit', env: process.env }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', stop);
