import { describe, expect, test } from 'vitest';
import { DT, LEVEL1, createDynamics, parseLevel, type EntitySpec } from '@blobocracy/shared';
import { Voters } from '../src/crowd';
import { VirtualCrowd, hazardAhead } from '../src/virtual';
import { World } from '../src/world';

/** Runs the world with only a virtual crowd for `seconds` of sim time; returns the furthest x reached (tiles). */
function simulate(count: number, seconds: number, seed: number): { best: number; deaths: number } {
  const voters = new Voters();
  const world = new World(LEVEL1);
  const crowd = new VirtualCrowd(voters, count, seed);
  let best = 0;
  for (let t = 0; t < seconds; t += DT) {
    crowd.update(t, world);
    world.step(voters.counts(t));
    best = Math.max(best, world.body.x);
  }
  return { best, deaths: world.deaths };
}

describe('virtual crowd', () => {
  // A purposeful-but-messy crowd should get somewhere: it is how we feel-test blending.
  test('300 bots usually get past the first few rooms of zone 1', () => {
    const results = [1, 2, 3].map((seed) => simulate(300, 180, seed).best);
    const median = results.sort((a, b) => a - b)[1]!;
    expect(median).toBeGreaterThan(80);
  }, 60_000);

  test('the crowd still dies sometimes: it is not a perfect autopilot', () => {
    const r = simulate(300, 300, 7);
    expect(r.deaths).toBeGreaterThan(0);
  }, 60_000);
});

describe('hazardAhead', () => {
  /** Flat ground at row 13 with the blob at column 2; `marks` are [x, y, ch]. */
  function lvl(marks: [number, number, string][], entities: Record<string, EntitySpec> = {}) {
    const rows = Array.from({ length: 18 }, (_, r) => (r >= 13 ? '#'.repeat(30) : '.'.repeat(30)).split(''));
    for (const [x, y, ch] of [...marks, [2, 12, '@'], [29, 12, 'G']] as [number, number, string][]) rows[y]![x] = ch;
    return parseLevel(1, 1, [{ name: 'z', sky: 'blue', rooms: [{ rows: rows.map((r) => r.join('')), entities }] }]);
  }
  const look = (L: ReturnType<typeof lvl>, t = 0) => {
    const d = createDynamics();
    d.t = t;
    return hazardAhead(L, 2.5, 12.4, 1, 4, d);
  };

  test('crumble, spring and conveyor floors are walkable', () => {
    const marks: [number, number, string][] = [];
    for (let x = 3; x < 8; x++) marks.push([x, 13, '~'], [x, 14, '.'], [x, 15, '.'], [x, 16, '.'], [x, 17, '.']);
    expect(look(lvl(marks))).toBe(false);
    expect(look(lvl([[3, 13, '>'], [4, 13, '<'], [5, 13, '*']]))).toBe(false);
  });

  test('a crumble that has already given way is a gap', () => {
    const marks: [number, number, string][] = [];
    for (let x = 4; x < 6; x++) marks.push([x, 13, '~'], [x, 14, '.']);
    const L = lvl(marks);
    const d = createDynamics();
    d.t = 5;
    d.crumbles.set(13 * L.width + 4, 1);
    d.crumbles.set(13 * L.width + 5, 1);
    expect(hazardAhead(L, 2.5, 12.4, 1, 4)).toBe(false);
    expect(hazardAhead(L, 2.5, 12.4, 1, 4, d)).toBe(true);
  });

  test('a saw ahead is danger', () => {
    expect(look(lvl([[5, 12, 'S']], { S: { kind: 'saw', r: 0.6 } }))).toBe(true);
    expect(look(lvl([[20, 12, 'S']], { S: { kind: 'saw', r: 0.6 } }))).toBe(false);
  });

  test('a crusher ahead is danger while slamming or holding, not while waiting', () => {
    const L = lvl([[5, 3, 'A']], { A: { kind: 'crusher', w: 2, drop: 7, period: 3 } });
    expect(look(L, 0)).toBe(false); // waiting raised for 1.15 s
    expect(look(L, 1.3)).toBe(true); // slamming
    expect(look(L, 1.6)).toBe(true); // holding
  });
});
