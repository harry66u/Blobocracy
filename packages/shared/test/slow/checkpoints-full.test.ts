import { describe, expect, test } from 'vitest';
import { LEVELS, checkpointsOf, createBodyAt, createDynamics } from '../../src/index';
import { solve } from '../helpers/solver';

// Slow: run with `npm run test:level`. After a death everyone respawns at a checkpoint on a fresh
// run clock, so every checkpoint must be a start from which the rest of the level is beatable.
for (const level of LEVELS) {
  describe(`level ${level.id}`, () => {
    for (const c of checkpointsOf(level)) {
      test(`is beatable from checkpoint ${c.index} (x=${c.x}) to the crown`, () => {
        const start = { b: createBodyAt(level, c.x, c.y), dyn: createDynamics() };
        // level 2's ferries are timing-sensitive: a narrow beam can miss a crossing that exists
        const r = solve(level, level.goalX - 0.5, level.id === 2 ? 800 : 250, 1200, start);
        expect(r.ok, `got stuck at x=${r.maxX.toFixed(1)}`).toBe(true);
      }, 3_600_000);
    }
  });
}
