// Runs the solver over a level and reports whether it is beatable, the perfect-run time,
// and the time at which each zone was reached.
// Usage: npx tsx tools/solve-level.ts [level id, default 1] [beam, default 250] [--chain] [--zone=N]
//   (default)  solve from spawn to the end of each zone in turn (each solve starts at spawn).
//   --chain    solve each zone from where the previous zone's plan ended: much faster, and its
//              total is an upper bound on the perfect run (the full solve may find better joins).
//   --zone=N   solve only zone N (1-based), starting at its first column at run time 0:
//              for iterating on one zone's design. Add --t=<s> to start at another run time.
import { createBody, createDynamics, LEVELS, PHYS, stepBody, tileAt, T_EMPTY, type Body, type Control, type Dynamics, type Level } from '../packages/shared/src/index';
import { HOLD_STEPS, solve } from './lib/solver';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}`))?.split('=')[1] ?? (args.includes(`--${k}`) ? '' : undefined);
const id = Number(pos[0] ?? 1);
const beam = Number(pos[1] ?? 250);
const level = LEVELS.find((l) => l.id === id);
if (!level) throw new Error(`no level ${id} (have ${LEVELS.map((l) => l.id).join(', ')})`);

const targetOf = (z: Level['zones'][number]) => Math.min(z.endX, level.goalX - 0.5);
const replay = (start: { b: Body; dyn: Dynamics }, plan: Control[]) => {
  const b = { ...start.b }, dyn = { ...start.dyn, crumbles: new Map(start.dyn.crumbles) };
  for (const c of plan) for (let i = 0; i < HOLD_STEPS; i++) stepBody(b, c, level, dyn);
  return { b, dyn };
};
/** A body standing on the first floor below any ceiling in the zone's second column. */
function standAt(x: number): Body {
  const tx = Math.floor(x);
  let ty = 0;
  while (ty < level.height && tileAt(level, tx, ty) !== T_EMPTY) ty++;
  while (ty < level.height && tileAt(level, tx, ty) === T_EMPTY) ty++;
  const b = createBody(level);
  return { ...b, x, y: ty - PHYS.halfH, vx: 0, vy: 0, grounded: true, coyote: PHYS.coyoteS };
}

const t0 = Date.now();
const zoneArg = flag('zone');
if (zoneArg !== undefined) {
  const z = level.zones[Number(zoneArg) - 1]!;
  const dyn = createDynamics();
  dyn.t = Number(flag('t') ?? 0);
  const start = z.index === 0 ? { b: createBody(level), dyn } : { b: standAt(z.startX + 1.5), dyn };
  const r = solve(level, targetOf(z), beam, 600, start);
  console.log(`${z.name}: ${r.ok ? `${r.seconds.toFixed(1)}s` : `STUCK at x=${r.maxX.toFixed(1)} (zone ${z.startX}..${z.endX})`}`);
} else if (flag('chain') !== undefined) {
  let start = { b: createBody(level), dyn: createDynamics() };
  let total = 0;
  for (const z of level.zones) {
    const r = solve(level, targetOf(z), beam, 600, start);
    if (!r.ok) { console.log(`${z.name.padEnd(18)} STUCK at x=${r.maxX.toFixed(1)} (zone ${z.startX}..${z.endX})`); break; }
    total += r.seconds;
    console.log(`${z.name.padEnd(18)} +${r.seconds.toFixed(1).padStart(6)}s  total ${total.toFixed(1)}s (${(total / 60).toFixed(2)} min)`);
    start = replay(start, r.plan);
  }
} else {
  let prev = 0;
  for (const z of level.zones) {
    const target = targetOf(z);
    const r = solve(level, target, beam, 1200);
    const s = r.ok ? r.seconds.toFixed(1) : 'STUCK';
    console.log(`${z.name.padEnd(18)} reach x=${target.toFixed(0).padStart(5)}  at ${s}s  (+${r.ok ? (r.seconds - prev).toFixed(1) : '-'}s)${r.ok ? '' : `  stuck at x=${r.maxX.toFixed(1)}`}`);
    if (!r.ok) break;
    prev = r.seconds;
  }
}
console.log(`solver wall time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
