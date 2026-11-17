import { BLEND, LEVEL1, createBody, createDynamics, stepBody, type Control } from '../packages/shared/src/index';
import { solve } from './lib/solver';
for (const robust of [false, true]) {
  const b = createBody(LEVEL1), dyn = createDynamics();
  const speed = Math.pow(0.78, BLEND.moveCurve);
  const r = solve(LEVEL1, b.x + 30, 120, 40, { b, dyn }, speed, robust);
  const bb = createBody(LEVEL1), dd = createDynamics(); const xs: string[] = [];
  r.plan.forEach((c, k) => { if (c.jumpHeld && !(r.plan[k - 1]?.jumpHeld)) xs.push(bb.x.toFixed(2)); for (let i = 0; i < 6; i++) stepBody(bb, c, LEVEL1, dd); });
  console.log('robust', robust, 'jumps at x', xs.join(' '));
}
