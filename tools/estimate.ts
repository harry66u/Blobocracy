// Crowd difficulty estimator. Simulates crowds that know the route (they re-plan with the solver
// every couple of seconds) but execute it sloppily, like real crowds: late and spread-out timing,
// partial agreement on direction. Reports per-zone pass rates and where runs die.
// Usage: npx tsx tools/estimate.ts [crowd=30] [trials=30] [seed=1]
import { BLEND, LEVEL1, createBody, createDynamics, stepBody, zoneAt, type Control } from '../packages/shared/src/index';
import { HOLD_STEPS, solve } from './lib/solver';

interface Crowd { bias: number; sigma: number; agree: (r: () => number) => number }
/** Timing bias/spread in seconds; agreement in 0..1 (share of the crowd pushing the planned way). */
const CROWDS: Record<string, Crowd> = {
  3: { bias: 0.03, sigma: 0.10, agree: (r) => (r() < 0.8 ? 1 : 1 / 3) },
  30: { bias: 0.06, sigma: 0.08, agree: (r) => 0.5 + 0.4 * r() },
  2000: { bias: 0.10, sigma: 0.05, agree: (r) => 0.55 + 0.2 * r() },
};

const size = process.argv[2] ?? '30';
const trials = Number(process.argv[3] ?? 30);
let seed = Number(process.argv[4] ?? 1) >>> 0;
const crowd = process.env.NOISELESS ? { bias: 0, sigma: 0, agree: () => 1 } : CROWDS[size];
if (!crowd) throw new Error(`crowd size must be one of ${Object.keys(CROWDS).join(', ')}`);

const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

const HORIZON = 30; // tiles planned ahead each time
const EXEC_STEPS = 120; // 2 s executed before re-planning
const L = LEVEL1;

/**
 * Expands a plan to per-step controls the way a crowd would execute it: each jump (press and
 * release together) lands late/early by one timing error, with a little jitter on how long it is
 * held; direction changes are shifted too but stay in order.
 */
function sloppy(plan: Control[]): { move: number[]; jump: boolean[] } {
  const n = plan.length * HOLD_STEPS + 60;
  const move = new Array<number>(n).fill(0), jump = new Array<boolean>(n).fill(false);
  const err = () => Math.round((crowd!.bias + crowd!.sigma * gauss()) * 60);
  // Direction: shifted change points, kept monotonic.
  let at = 0, prevMove = plan[0]?.move ?? 0, cur = prevMove;
  const changes: [number, number][] = [[0, prevMove]];
  plan.forEach((c, k) => {
    if (k > 0 && c.move !== prevMove) { at = Math.max(at, k * HOLD_STEPS + err()); changes.push([at, c.move]); }
    prevMove = c.move;
  });
  let ci = 0;
  for (let i = 0; i < n; i++) { while (ci < changes.length && changes[ci]![0] <= i) cur = changes[ci++]![1]; move[i] = cur; }
  // Jumps: whole holds shifted together.
  for (let k = 0; k < plan.length; k++) {
    if (!plan[k]!.jumpHeld || (k > 0 && plan[k - 1]!.jumpHeld)) continue;
    let len = 0;
    while (k + len < plan.length && plan[k + len]!.jumpHeld) len++;
    const startStep = Math.max(0, k * HOLD_STEPS + (k ? err() : 0));
    const hold = Math.max(3, len * HOLD_STEPS + Math.round(crowd!.sigma * 0.4 * gauss() * 60));
    for (let i = startStep; i < Math.min(n, startStep + hold); i++) jump[i] = true;
  }
  return { move, jump };
}

const zones = L.zones.length;
const entered = new Array(zones).fill(0), passed = new Array(zones).fill(0);
const deathsAt = new Map<number, number>();
const causes: Record<string, number> = {};
let wins = 0;
const t0 = Date.now();
for (let trial = 0; trial < trials; trial++) {
  const b = createBody(L), dyn = createDynamics();
  let zone = 0; entered[0]++;
  let agree = 1;
  let outcome: string | null = null;
  while (!outcome) {
    const target = Math.min(b.x + HORIZON, L.goalX - 0.5);
    agree = crowd.agree(rand); // this segment's agreement; the crowd plans at the speed it can manage
    const speed = Math.pow(agree, BLEND.moveCurve);
    const r = solve(L, target, 120, 40, { b, dyn }, speed, true);
    if (!r.ok) { outcome = 'stuck'; break; }
    const ex = sloppy(r.plan);
    for (let i = 0; i < Math.min(EXEC_STEPS, ex.move.length); i++) {
      const c: Control = { move: ex.move[i]!, jumpHeld: ex.jump[i]! };
      const cause = stepBody(b, c, L, dyn);
      if (process.env.DEBUG && trial === Number(process.env.DEBUG) && (i % 6 === 0 || cause)) console.log('seg-step', i, 'x', b.x.toFixed(2), 'y', b.y.toFixed(2), 'mv', c.move.toFixed(2), 'j', c.jumpHeld ? 1 : 0, 'plan', (r.plan[Math.floor(i / 6)]?.jumpHeld ? 'J' : '-'), cause ?? '');
      if (cause) { outcome = cause; break; }
      const z = zoneAt(L, b.x).index;
      while (zone < z) { passed[zone]++; zone++; entered[zone]++; }
      if (b.x >= L.goalX - 0.5) { outcome = 'win'; break; }
    }
  }
  if (outcome === 'win') { wins++; passed[zone]++; }
  else {
    causes[outcome] = (causes[outcome] ?? 0) + 1;
    const bucket = Math.floor(b.x / 25) * 25;
    deathsAt.set(bucket, (deathsAt.get(bucket) ?? 0) + 1);
  }
}
console.log(`crowd ${size}, ${trials} runs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
L.zones.forEach((z, i) => console.log(`  ${z.name.padEnd(14)} entered ${String(entered[i]).padStart(3)}  passed ${String(passed[i]).padStart(3)}  rate ${entered[i] ? ((100 * passed[i]) / entered[i]).toFixed(0).padStart(3) : '  -'}%`));
console.log(`  wins ${wins}; causes ${JSON.stringify(causes)}`);
console.log(`  deadliest spots (x: deaths): ${[...deathsAt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([x, n]) => `${x}:${n}`).join('  ')}`);
