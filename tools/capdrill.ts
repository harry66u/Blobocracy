// Cost-cap fire drill: runs the real server process (configured only through environment
// variables, as in production) with a tiny budget, points ALERT_WEBHOOK_URL at a local
// receiver that speaks the Discord/Slack webhook format, plays 600 bots, and checks:
//   every alert arrives at the webhook, in order; the frame rate drops at 70%;
//   new players are turned away at 90% beyond BASE_CAPACITY and at 100% beyond PACKED_CAPACITY;
//   raising the budget through the admin endpoint brings the game back.
// Usage: npx tsx tools/capdrill.ts
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791, HOOK = 8792, BOTS = 600;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;

// 1. webhook receiver
const hooks: { at: string; body: { content: string; text: string } }[] = [];
const hookSrv = createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => { hooks.push({ at: ts(), body: JSON.parse(b) }); console.log(`${ts()} WEBHOOK  ${JSON.parse(b).content}`); res.writeHead(204).end(); });
}).listen(HOOK);

// 2. the real server, configured by env only
const server = spawn('npx', ['tsx', 'packages/sim/src/main.ts'], {
  cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, PORT: String(PORT), DATA_DIR: mkdtempSync(join(tmpdir(), 'bl-drill-')), ADMIN_KEY: 'drill',
    ALERT_WEBHOOK_URL: `http://127.0.0.1:${HOOK}/hook`, BUDGET_MODE: 'cap',
    // ~600 players × 20 frames/s × ~90 bytes ≈ 1 MB/s ≈ $0.00002/s at $0.02/GB: $0.0012 is ~1 minute of play
    MONTHLY_BUDGET_USD: '0.0012', BUDGET_ALERT_USD: '0.0003', BASE_MONTHLY_USD: '0',
    MAX_PLAYERS: '5000', BASE_CAPACITY: String(BOTS), PACKED_CAPACITY: '50',
  },
});
server.stderr!.on('data', (d) => process.stderr.write(`[server] ${d}`));
const stop = () => { try { process.kill(-server.pid!, 'SIGTERM'); } catch { /* gone */ } hookSrv.close(); };
process.on('exit', stop);
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; ; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* starting */ }
  if (i > 150) throw new Error('server did not start');
  await wait(200);
}

// 3. bots
let frames = 0;
function bot(): Promise<'in' | 'packed'> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') {
        if (m.data.includes('"welcome"')) { resolve('in'); ws.send(new Uint8Array([1, 2])); }
        if (m.data.includes('"packed"')) resolve('packed');
      } else if (new Uint8Array(m.data as ArrayBuffer)[0] === 10) frames++;
    };
  });
}
const tryJoin = async (n: number) => {
  const r = await Promise.all(Array.from({ length: n }, bot));
  return { in: r.filter((x) => x === 'in').length, packed: r.filter((x) => x === 'packed').length };
};
const health = async () => (await (await fetch(`${base}/api/health?key=drill`)).json()) as { online: number; level: string; budget: { spentUsd: number; fraction: number } };
const fps = async (players: number) => { const f0 = frames; await wait(2000); return Math.round(((frames - f0) / players / 2) * 10) / 10; };

const results: string[] = [];
const check = (ok: boolean, what: string) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`); console.log(`${ts()} ${ok ? 'PASS' : 'FAIL'}  ${what}`); };

const first = await tryJoin(BOTS - 10);
console.log(`${ts()} ${first.in} bots playing`);
check((await fps(first.in)) >= 18, 'normal: about 20 frames per second per player');

const waitLevel = async (level: string) => {
  for (let i = 0; i < 600; i++) {
    const h = await health();
    if (h.level === level) { console.log(`${ts()} level → ${level} at ${(h.budget.fraction * 100).toFixed(0)}% ($${h.budget.spentUsd})`); return true; }
    await wait(250);
  }
  return false;
};
check(await waitLevel('reduced frame rate'), 'reached 70%: reduced frame rate');
const reduced = await fps(first.in);
check(reduced <= 13 && reduced >= 10, `at 70%+: ${reduced} frames per second per player (target 12)`);

check(await waitLevel('holding capacity'), 'reached 90%: holding capacity');
const at90 = await tryJoin(20);
check(at90.in === 10 && at90.packed === 10, `at 90%: of 20 newcomers ${at90.in} admitted up to BASE_CAPACITY=${BOTS}, ${at90.packed} shown the packed screen`);

check(await waitLevel('packed'), 'reached 100%: packed');
const at100 = await tryJoin(5);
check(at100.packed === 5, `at 100%: all ${at100.packed} newcomers shown the packed screen (already-connected players keep playing)`);
const status = await (await fetch(`${base}/api/status`)).json();
check(status.packed === true, '/api/status (what the packed screen polls) says packed with the live death count');

await wait(2500); // let the webhook deliveries land
const contents = hooks.map((h) => h.body.content);
const order = ['alert amount', '50% of', '70% of', '90% of', '100% of'];
check(order.every((k, i) => contents.filter((c) => c.includes('spend estimate'))[i]?.includes(k)), `webhook got the 5 budget alerts in order: ${order.join(', ')}`);
check(hooks.every((h) => h.body.content === h.body.text), 'webhook body has both "content" (Discord) and "text" (Slack)');
check(contents.some((c) => c.startsWith('Blobocracy is full')), 'webhook got the "game is full" alert when newcomers were turned away');

const raised = await (await fetch(`${base}/admin/budget?key=drill&usd=50`, { method: 'POST' })).json();
check(raised.level === 'normal', `raised the budget to $50 live via /admin/budget: level ${raised.level}`);
const back = await tryJoin(20);
check(back.in === 20, `after raising: ${back.in} of 20 newcomers admitted`);
check((await fps(first.in + at90.in + back.in)) >= 18, 'after raising: back to about 20 frames per second');
await wait(1500);
check(hooks.at(-1)!.body.content.includes('back to normal'), 'webhook got the "back to normal" message');

console.log('\n' + results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed`);
stop();
process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
