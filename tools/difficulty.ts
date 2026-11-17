// Level difficulty report. Takes the solver's route through LEVEL1 and, for every input
// change on it, measures how early and how late that change could be made and still survive
// (its timing window). A crowd aims at the middle of each window and its timing spreads with
// standard deviation SIGMA, so each change succeeds with probability P(|error| < width/2). A zone's pass rate is the
// product over its changes. Assumption (spec §6.4 targets): a coordinated crowd; SIGMA per size.
// Usage: npx tsx tools/difficulty.ts [--replan]   (the route is cached in tools/out/route.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { LEVEL1, cloneDynamics, createBody, createDynamics, stepBody, zoneAt, type Body, type Control, type Dynamics } from '../packages/shared/src/index';
import { HOLD_STEPS, solve } from './lib/solver';

const L = LEVEL1;
const SIGMA: Record<string, number> = { '3 players': 0.09, '30 players': 0.07, '2000 players': 0.05 };
const TARGETS = [0.9, 0.6, 0.35, 0.25, 0.15, 0.1];
const MAX_SHIFT = 18; // steps (300 ms) each way
const FOLLOW = 30; // steps the shifted input is played before the crowd re-plans
const RECOVER = 20; // tiles the crowd must still be able to make after the mistake

const routeFile = 'tools/out/route.json';
mkdirSync('tools/out', { recursive: true });
let plan: Control[];
if (!process.argv.includes('--replan') && existsSync(routeFile)) plan = JSON.parse(readFileSync(routeFile, 'utf8'));
else {
  console.log('solving a route through the whole level (about 10 minutes)…');
  const r = solve(L, L.goalX - 0.5, 400, 1200);
  if (!r.ok) throw new Error(`no route: stuck at x=${r.maxX.toFixed(1)}`);
  plan = r.plan;
  writeFileSync(routeFile, JSON.stringify(plan));
}

// Per-step controls, with jumpPressed pulses where a hold starts (as the blending would give).
const steps: Control[] = [];
plan.forEach((c, k) => { for (let i = 0; i < HOLD_STEPS; i++) steps.push({ move: c.move, jumpHeld: c.jumpHeld, jumpPressed: i === 0 && c.jumpHeld && !plan[k - 1]?.jumpHeld }); });

// Snapshots of the exact run, so each test can start just before its change.
const snaps: { b: Body; dyn: Dynamics }[] = [];
{
  const b = createBody(L), dyn = createDynamics();
  for (let i = 0; i < steps.length; i++) {
    snaps.push({ b: { ...b }, dyn: cloneDynamics(dyn) });
    if (stepBody(b, steps[i]!, L, dyn)) throw new Error(`route dies at step ${i}`);
  }
}

/**
 * Can the crowd still recover if the change at step `at` happens `shift` steps later (negative =
 * earlier)? Plays the shifted change for a moment, then lets the crowd re-plan the next stretch.
 */
function survives(at: number, shift: number): boolean {
  const from = Math.max(0, at + Math.min(0, shift) - 1);
  const { b: b0, dyn: d0 } = snaps[from]!;
  const b = { ...b0 }, dyn = cloneDynamics(d0);
  const before = steps[at - 1]!, after = steps[at]!;
  const end = Math.min(steps.length, at + Math.max(0, shift) + FOLLOW);
  for (let i = from; i < end; i++) {
    let c = steps[i]!;
    if (shift > 0 && i >= at && i < at + shift) c = { ...before, jumpPressed: false };
    if (shift < 0 && i >= at + shift && i < at) c = after;
    if (shift > 0 && i === at + shift) c = { ...after, jumpPressed: after.jumpHeld && !before.jumpHeld };
    if (stepBody(b, c, L, dyn)) return false;
  }
  if (end >= steps.length) return true;
  // Re-plan: can the crowd still get RECOVER tiles further from here?
  return solve(L, Math.min(b.x + RECOVER, L.goalX - 0.5), 150, 12, { b, dyn }).ok;
}

/** Largest shift in 0..MAX_SHIFT (one direction) that is still recoverable, by binary search. */
function windowSize(at: number, dir: 1 | -1): number {
  if (!survives(at, dir)) return 0;
  let lo = 1, hi = MAX_SHIFT;
  if (survives(at, dir * hi)) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (survives(at, dir * mid)) lo = mid; else hi = mid;
  }
  return lo;
}

const phi = (z: number) => 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3)));
interface Moment { at: number; x: number; zone: number; early: number; late: number }
const moments: Moment[] = [];
let unmeasured = 0;
for (let i = 1; i < steps.length; i++) {
  const a = steps[i - 1]!, c = steps[i]!;
  if (a.move === c.move && a.jumpHeld === c.jumpHeld) continue;
  if (!survives(i, 0)) { unmeasured++; continue; } // the recovery planner can't judge this one
  const late = windowSize(i, 1), early = windowSize(i, -1);
  if (late >= MAX_SHIFT && early >= MAX_SHIFT) continue; // not a critical moment
  moments.push({ at: i, x: snaps[i]!.b.x, zone: zoneAt(L, snaps[i]!.b.x).index, early, late });
}

console.log(`route: ${(steps.length / 60 / 60).toFixed(2)} min, ${moments.length} critical moments (${unmeasured} unmeasurable)\n`);
for (const [label, sigma] of Object.entries(SIGMA)) {
  console.log(label);
  let all = 1;
  L.zones.forEach((z, zi) => {
    let p = 1;
    // A crowd aims at the middle of each window, so only its width matters.
    for (const m of moments) if (m.zone === zi) { const half = (m.early + m.late) / 2 / 60; p *= phi(half / sigma) - phi(-half / sigma); }
    all *= p;
    console.log(`  ${z.name.padEnd(14)} pass ${(100 * p).toFixed(0).padStart(3)}%   target ${(100 * TARGETS[zi]!).toFixed(0)}%`);
  });
  console.log(`  whole level: 1 win per ${Math.round(1 / Math.max(all, 1e-12)).toLocaleString('en-US')} attempts\n`);
}
const hardest = [...moments].sort((p, q) => (p.early + p.late) - (q.early + q.late)).slice(0, 12);
console.log('tightest moments (x, zone, window ms early/late):');
for (const m of hardest) console.log(`  x ${m.x.toFixed(1).padStart(7)}  ${L.zones[m.zone]!.name.padEnd(14)} -${Math.round(m.early * 1000 / 60)} / +${Math.round(m.late * 1000 / 60)} ms`);
