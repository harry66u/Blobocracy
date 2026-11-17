import { describe, expect, test } from 'vitest';
import { DT, LEVEL1 } from '@blobocracy/shared';
import { Voters } from '../src/crowd';
import { VirtualCrowd } from '../src/virtual';
import { World } from '../src/world';

/** Runs the world with only a virtual crowd for `seconds` of sim time; returns the best progress reached. */
function simulate(count: number, seconds: number, seed: number): { best: number; deaths: number } {
  const voters = new Voters();
  const world = new World(LEVEL1);
  const crowd = new VirtualCrowd(voters, count, seed);
  let best = 0;
  for (let t = 0; t < seconds; t += DT) {
    crowd.update(t, world);
    world.step(voters.counts(t));
    best = Math.max(best, world.maxProgress);
  }
  return { best, deaths: world.deaths };
}

describe('virtual crowd', () => {
  // A purposeful-but-messy crowd should get somewhere: it is how we feel-test blending.
  test('300 bots usually get past the first few rooms of zone 1', () => {
    const results = [1, 2, 3].map((seed) => simulate(300, 180, seed).best);
    const median = results.sort()[1]!;
    expect(median).toBeGreaterThan(0.12);
  }, 60_000);

  test('the crowd still dies sometimes: it is not a perfect autopilot', () => {
    const r = simulate(300, 300, 7);
    expect(r.deaths).toBeGreaterThan(0);
  }, 60_000);
});
