// Runs the solver over LEVEL1 and reports whether it is beatable, the perfect-run time,
// and the time at which each zone was reached. Usage: npx tsx tools/solve-level.ts [beam]
import { LEVEL1 } from '../packages/shared/src/index';
import { solve } from '../packages/shared/test/helpers/solver';

const beam = Number(process.argv[2] ?? 250);
const t0 = Date.now();
let prev = 0;
for (const z of LEVEL1.zones) {
  const target = Math.min(z.endX, LEVEL1.goalX - 0.5);
  const r = solve(LEVEL1, target, beam, 1200);
  const s = r.ok ? r.seconds.toFixed(1) : 'STUCK';
  console.log(`${z.name.padEnd(14)} reach x=${target.toFixed(0).padStart(5)}  at ${s}s  (+${r.ok ? (r.seconds - prev).toFixed(1) : '-'}s)${r.ok ? '' : `  stuck at x=${r.maxX.toFixed(1)}`}`);
  if (!r.ok) break;
  prev = r.seconds;
}
console.log(`solver wall time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
