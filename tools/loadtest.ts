/**
 * Load test (spec §11): starts a sim and two edge relays as separate processes on this machine,
 * connects a mixed bot crowd through the real session + proof-of-work path, holds it steady,
 * and reports frames delivered per second, press-to-server latency, relay CPU and memory per
 * connection, and which abuse defenses fired.
 *
 *   npm run loadtest -- --count 5000 [--steady 30] [--pow 8] [--workers 3] [--ramp 400]
 *
 * Writes the full numbers to tools/out/loadtest-<count>.json.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { runBots } from '../packages/bots/src/main';

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : fallback; };
const count = Number(arg('count', '5000'));
const steadyS = Number(arg('steady', '30'));
const pow = arg('pow', '8');
const workers = Number(arg('workers', '3'));
const ramp = Number(arg('ramp', '400'));
const LINK = 18081, EDGES = [18080, 18082];
const ADMIN = randomBytes(8).toString('hex');
const env = {
  ...process.env, SESSION_SECRET: randomBytes(16).toString('hex'), RELAY_SECRET: randomBytes(8).toString('hex'),
  ADMIN_TOKEN: ADMIN, TRUST_TEST_IP_HEADER: '1', LATENCY_PROBE: '1', POW_DIFFICULTY: pow,
};
const procs: ChildProcess[] = [];
const run = (file: string, extra: Record<string, string>) => {
  const p = spawn(process.execPath, ['--import', 'tsx', file], { env: { ...env, ...extra }, stdio: ['ignore', 'inherit', 'inherit'] });
  procs.push(p);
  return p;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url: string, auth = false) => (await fetch(url, auth ? { headers: { authorization: `Bearer ${ADMIN}` } } : {})).json() as Promise<any>;
const cleanup = () => { for (const p of procs) p.kill('SIGTERM'); };
process.on('SIGINT', () => { cleanup(); process.exit(1); });

run('packages/sim/src/main.ts', { LOCAL_RELAY: '0', SIM_LINK_PORT: String(LINK) });
await sleep(1500);
EDGES.forEach((port, i) => run('packages/edge/src/main.ts', { PORT: String(port), SIM_URL: `ws://127.0.0.1:${LINK}/relay`, EDGE_NAME: `edge-${'ab'[i]}` }));
for (let i = 0; i < 100; i++) {
  const ok = await Promise.all(EDGES.map((p) => getJson(`http://127.0.0.1:${p}/healthz`).then((h) => h.simUp, () => false)));
  if (ok.every(Boolean)) break;
  await sleep(200);
}
await sleep(2500); // let the relays report a baseline
const stats = () => getJson(`http://127.0.0.1:${EDGES[0]}/admin/stats`, true);
const base = await stats();
const baseRss: Record<string, number> = Object.fromEntries(base.relays.map((r: any) => [r.name, r.stats?.rssMb ?? 0]));
console.log(`\nloadtest: ${count} bots (mixed), PoW ${pow} bits, ${workers} bot processes, 2 edges, baseline RSS ${JSON.stringify(baseRss)} MB\n`);

const bots = runBots({ count, profile: 'mixed', urls: EDGES.map((p) => `ws://127.0.0.1:${p}`), workers, ratePerS: ramp });
const t0 = Date.now();
let settled = 0;
for (;;) {
  await sleep(1000);
  const s = bots.snapshot();
  const refused = Object.values(s.byProfile).reduce((a, p) => a + p.refused, 0);
  console.log(`ramp ${((Date.now() - t0) / 1000).toFixed(0)}s: connected ${s.connected}, connecting ${s.connecting}, refused ${refused}, frames/s ${s.framesPerS}`);
  if (s.connected + refused >= count && s.connecting === 0) { if (++settled >= 2) break; }
  if (Date.now() - t0 > 240_000) { console.log('ramp timed out'); break; }
}
const rampS = (Date.now() - t0) / 1000;

const frames: number[] = [], cpu: Record<string, number[]> = {};
for (let i = 0; i < steadyS; i++) {
  await sleep(1000);
  const s = bots.snapshot();
  frames.push(s.framesPerS);
  if (i % 2 === 1) {
    const st = await stats();
    for (const r of st.relays) (cpu[r.name] ??= []).push(r.stats?.cpu ?? 0);
  }
  if (i % 5 === 4) console.log(`steady ${i + 1}s: connected ${s.connected}, frames/s ${s.framesPerS}, rtt p50 ${s.rtt.percentile(50)} p99 ${s.rtt.percentile(99)}`);
}
const end = await stats();
const s = bots.snapshot();
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const relays = end.relays.map((r: any) => {
  const st = r.stats ?? {};
  const conns = st.connections ?? r.connections;
  return {
    name: r.name, connections: conns, watchers: st.watchers ?? 0, alwaysOn: st.policy?.alwaysOn,
    cpuAvgCore: Number(avg(cpu[r.name] ?? []).toFixed(3)),
    rssMb: st.rssMb, rssPerConnKb: conns ? Number((((st.rssMb - (baseRss[r.name] ?? 0)) * 1024) / conns).toFixed(1)) : null,
    degraded: st.degraded, framesIn: st.framesIn, clientToEdgeMs: st.clientToEdgeMs,
    defenses: {
      rejected: st.rejected, rateLimitedInputs: st.rateLimitedInputs, flagged: st.flagged, flaggedNow: st.flaggedNow,
      influenceCappedIps: st.influenceCappedIps, replaced: st.replaced,
    },
  };
});
const players = end.online;
const expected = relays.reduce((a: number, r: any) => a + (r.connections - r.watchers) * end.frameHz + r.watchers * end.frameHz / 2, 0);
const c2e = relays.map((r: any) => r.clientToEdgeMs).filter(Boolean);
const e2s = end.edgeToSimMs;
const result = {
  count, pow: Number(pow), rampSeconds: rampS, steadySeconds: steadyS,
  connected: s.connected, online: players, active: end.active, byProfile: s.byProfile, refused: s.failed, closedByServer: s.closedByServer,
  framesPerS: { avg: Math.round(avg(frames)), min: Math.min(...frames), max: Math.max(...frames), expected: Math.round(expected) },
  latencyMs: {
    note: 'press → server = client→edge (one-way, same-host clocks) + edge→sim (input arrival at the edge until the sim step that applied it)',
    clientToEdge: c2e, edgeToSim: e2s,
    pressToServerApprox: e2s && c2e[0] ? {
      p50: Math.max(...c2e.map((x: any) => x.p50)) + e2s.p50, p90: Math.max(...c2e.map((x: any) => x.p90)) + e2s.p90, p99: Math.max(...c2e.map((x: any) => x.p99)) + e2s.p99,
    } : null,
    pingRtt: s.rtt.summary(),
  },
  relays, budget: end.budget, world: end.world,
};
mkdirSync('tools/out', { recursive: true });
writeFileSync(`tools/out/loadtest-${count}.json`, JSON.stringify(result, null, 2));
console.log('\n=== load test result ===');
console.log(JSON.stringify(result, null, 2));
await bots.stop();
cleanup();
await sleep(500);
process.exit(0);
