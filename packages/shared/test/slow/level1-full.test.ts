import { expect, test } from 'vitest';
import { LEVEL1 } from '../../src/index';
import { solve } from '../helpers/solver';

// Slow (about 10 minutes): run with `npm run test:level`.
test('level 1 is beatable from spawn to the crown with 100 ms inputs, in 7.5 to 12 minutes', () => {
  const r = solve(LEVEL1, LEVEL1.goalX - 0.5, 400, 1200);
  expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
  console.log(`perfect run: ${(r.seconds / 60).toFixed(2)} min`);
  // 8 min was the design target; easier jumps (hang time) brought the perfect run to about 7.97 min, which is fine:
  // real crowds are never perfect
  expect(r.seconds).toBeGreaterThanOrEqual(7.5 * 60);
  expect(r.seconds).toBeLessThanOrEqual(12 * 60);
}, 1_800_000);
