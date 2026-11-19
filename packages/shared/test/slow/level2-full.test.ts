import { expect, test } from 'vitest';
import { LEVEL2 } from '../../src/index';
import { solve } from '../helpers/solver';

// Slow (about 15 minutes; perfect run about 10 min): run with `npm run test:level`.
test('level 2 is beatable from spawn to the crown with 100 ms inputs, in 9 to 13 minutes', () => {
  // beam 800: the ferries near x=3855 are timing-sensitive and a narrower beam can miss a crossing that exists
  const r = solve(LEVEL2, LEVEL2.goalX - 0.5, 800, 1200);
  expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
  console.log(`perfect run: ${(r.seconds / 60).toFixed(2)} min`);
  expect(r.seconds).toBeGreaterThanOrEqual(9 * 60);
  expect(r.seconds).toBeLessThanOrEqual(13 * 60);
}, 3_600_000);
