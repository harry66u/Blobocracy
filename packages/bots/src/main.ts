/**
 * Bot crowd simulator (spec §11):
 *   npm run bots -- --count 5000 --profile mixed --url ws://localhost:8080
 * Options: --url (comma-separated edges; "/ws" is added when missing), --workers (processes,
 * default 3), --ramp (new bots per second, default 500), --duration (seconds; default: until Ctrl+C).
 * Profiles: follower, random, idle, spammer, farm, perfect-timing, mixed.
 * Each bot uses a distinct fake IP in `x-test-ip`, so point it at edges started with
 * TRUST_TEST_IP_HEADER=1 (otherwise every bot is 127.0.0.1 and the per-IP caps apply to all).
 * Use POW_DIFFICULTY=0 on the edges to skip the proof-of-work cost in big load tests.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Reservoir } from '@blobocracy/shared';
import { PROFILES, planBots, type BotSpec, type ProfileArg } from './profiles';
import type { WorkerReport } from './worker';

export interface BotsOptions { count: number; profile: ProfileArg; urls: string[]; workers?: number; ratePerS?: number; maxInflight?: number }

export interface BotsSnapshot {
  connected: number; connecting: number;
  /** Frames received per second across all bots, since the previous snapshot. */
  framesPerS: number; eventsPerS: number; inputsPerS: number;
  /** Frames received by all bots so far. */
  framesTotal: number;
  rtt: Reservoir;
  failed: Record<string, number>;
  closedByServer: Record<string, number>;
  byProfile: Record<string, { connected: number; refused: number }>;
}

const sum = (rs: Iterable<WorkerReport>, f: (r: WorkerReport) => number) => { let s = 0; for (const r of rs) s += f(r); return s; };
const mergeCounts = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v; };

export function runBots(o: BotsOptions) {
  const urls = o.urls.map((u) => (u.endsWith('/ws') ? u : `${u.replace(/\/$/, '')}/ws`));
  const specs = planBots(o.count, o.profile, urls);
  const n = Math.max(1, o.workers ?? 3);
  // Keep each farm inside one worker, so its sockets really move in lockstep.
  const slices: BotSpec[][] = Array.from({ length: n }, () => []);
  specs.forEach((s, i) => slices[s.group >= 0 ? s.group % n : i % n]!.push(s));
  const latest = new Map<number, WorkerReport>();
  const rtt = new Reservoir(20_000);
  const children: ChildProcess[] = slices.map((slice, i) => {
    const c = fork(fileURLToPath(new URL('./worker.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], stdio: 'inherit' });
    c.on('message', (m: { type: string; report: WorkerReport }) => {
      if (m.type !== 'report') return;
      latest.set(i, m.report);
      for (const v of m.report.rtt) rtt.add(v);
    });
    c.send({ type: 'init', init: { specs: slice, ratePerS: (o.ratePerS ?? 500) / n, maxInflight: o.maxInflight ?? 200 } });
    return c;
  });

  let lastTotal = 0, lastAt = performance.now();
  const snapshot = (): BotsSnapshot => {
    const rs = [...latest.values()];
    const framesTotal = sum(rs, (r) => r.framesTotal);
    const now = performance.now();
    const framesPerS = Math.round(((framesTotal - lastTotal) * 1000) / Math.max(1, now - lastAt));
    lastTotal = framesTotal; lastAt = now;
    const failed: Record<string, number> = {}, closedByServer: Record<string, number> = {};
    const byProfile: Record<string, { connected: number; refused: number }> = {};
    for (const r of rs) {
      mergeCounts(failed, r.failed);
      mergeCounts(closedByServer, r.closedByServer);
      for (const [p, v] of Object.entries(r.byProfile)) {
        const t = (byProfile[p] ??= { connected: 0, refused: 0 });
        t.connected += v.connected; t.refused += v.refused;
      }
    }
    return {
      connected: sum(rs, (r) => r.connected), connecting: sum(rs, (r) => r.connecting),
      framesPerS, framesTotal, eventsPerS: sum(rs, (r) => r.events), inputsPerS: sum(rs, (r) => r.inputsSent),
      rtt, failed, closedByServer, byProfile,
    };
  };

  const stop = async () => {
    await Promise.all(children.map((c) => new Promise<void>((resolve) => {
      if (c.exitCode !== null) return resolve();
      c.once('exit', () => resolve());
      c.send({ type: 'stop' });
      setTimeout(() => { c.kill(); resolve(); }, 3000);
    })));
  };
  return { snapshot, stop };
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const count = Number(arg('count', '100'));
  const profile = arg('profile', 'mixed') as ProfileArg;
  if (profile !== 'mixed' && !PROFILES.includes(profile)) { console.error(`--profile must be one of mixed, ${PROFILES.join(', ')}`); process.exit(1); }
  const urls = arg('url', 'ws://localhost:8080')!.split(',');
  const duration = Number(arg('duration', '0'));
  const bots = runBots({ count, profile, urls, workers: Number(arg('workers', '3')), ratePerS: Number(arg('ramp', '500')) });
  console.log(`bots: ${count} × ${profile} → ${urls.join(', ')}`);
  const timer = setInterval(() => {
    const s = bots.snapshot();
    console.log(`connected ${s.connected} (+${s.connecting} connecting)  frames/s ${s.framesPerS}  rtt p50 ${s.rtt.percentile(50) ?? '-'} ms p99 ${s.rtt.percentile(99) ?? '-'} ms  refused ${JSON.stringify(s.failed)}`);
  }, 5000);
  const end = async () => { clearInterval(timer); await bots.stop(); process.exit(0); };
  process.on('SIGINT', end);
  if (duration > 0) setTimeout(end, duration * 1000);
}
