import { describe, expect, test } from 'vitest';
import { parseLevel, DEATH_FREEZE_S, DEATH_HOLD_S, type ServerEvent, type VoteCounts } from '@blobocracy/shared';
import { World } from '../src/world';

/** 18-row room from a ground profile string: '#' floor at row 13, '_' pit. */
function room(profile: string, spawnAt = -1, goalAt = -1): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 18; r++) {
    let row = '';
    for (let c = 0; c < profile.length; c++) {
      if (r === 12 && c === spawnAt) row += '@';
      else if (r === 12 && c === goalAt) row += 'G';
      else row += r >= 13 && profile[c] === '#' ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

// Zone 0 covers x 0..6, zone 1 starts at x 6; pit at x 10..13; wall at the end.
const LEVEL = parseLevel(99, 1, [
  { name: 'A', sky: 'blue', rooms: [room('######', 1)] },
  { name: 'B', sky: 'blue', rooms: [room('####____######', -1, 13)] },
]);

const NOBODY: VoteCounts = { left: 0, right: 0, jump: 0, active: 0 };
const RIGHT: VoteCounts = { left: 0, right: 1, jump: 0, active: 1 };
const STAND: VoteCounts = { left: 0, right: 0, jump: 0, active: 1 };

function runUntil(w: World, votes: VoteCounts, pred: (e: ServerEvent) => boolean, max = 2000): ServerEvent[] {
  const all: ServerEvent[] = [];
  for (let i = 0; i < max; i++) {
    const ev = w.step(votes);
    all.push(...ev);
    if (ev.some(pred)) return all;
  }
  throw new Error('condition never reached');
}

describe('World', () => {
  test('with nobody active the world pauses and the blob does not move', () => {
    const w = new World(LEVEL);
    w.step(STAND); // settle
    const before = { ...w.body };
    for (let i = 0; i < 600; i++) w.step(NOBODY);
    expect(w.phase).toBe('paused');
    expect(w.body.x).toBe(before.x);
    expect(w.body.y).toBe(before.y);
    w.step(STAND);
    expect(w.phase).toBe('running');
  });

  test('a lone voter holding right reaches zone 2, then dies in the pit', () => {
    const w = new World(LEVEL);
    const events = runUntil(w, RIGHT, (e) => e.t === 'death');
    const zones = events.filter((e) => e.t === 'zone');
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ index: 1, run: 1 });
    const death = events.find((e) => e.t === 'death')!;
    expect(death).toMatchObject({ t: 'death', run: 1, cause: 'pit', deaths: 1, nearRecord: false });
    expect(events.some((e) => e.t === 'record')).toBe(true);
    expect(w.deaths).toBe(1);
    expect(w.record?.run).toBe(1);
    expect(w.phase).toBe('dying');
  });

  test('the dying hold lasts freeze + hold, then the run resets to spawn', () => {
    const w = new World(LEVEL);
    runUntil(w, RIGHT, (e) => e.t === 'death');
    const hold = Math.round((DEATH_FREEZE_S + DEATH_HOLD_S) * 60);
    const frozen = { x: w.body.x, y: w.body.y };
    for (let i = 0; i < hold - 1; i++) {
      expect(w.step(RIGHT).some((e) => e.t === 'reset')).toBe(false);
      expect(w.phase).toBe('dying');
    }
    expect(w.body.x).toBe(frozen.x);
    const ev = w.step(RIGHT);
    expect(ev).toContainEqual({ t: 'reset', run: 2 });
    expect(w.run).toBe(2);
    expect(w.body.x).toBeCloseTo(LEVEL.spawn.x);
    expect(w.zone).toBe(0);
  });

  test('a worse second run sets no record; nearRecord follows the 5% rule', () => {
    const w = new World(LEVEL, { deaths: 0, record: { progress: 0.9, run: 7 } });
    const events = runUntil(w, RIGHT, (e) => e.t === 'death');
    const death = events.find((e) => e.t === 'death') as Extract<ServerEvent, { t: 'death' }>;
    expect(events.some((e) => e.t === 'record')).toBe(false);
    expect(death.nearRecord).toBe(death.progress >= 0.85);
    expect(w.record).toEqual({ progress: 0.9, run: 7 });
  });

  test('dying near a tiny record is not a near miss', () => {
    const w = new World(LEVEL, { deaths: 0, record: { progress: 0.05, run: 1 } });
    const events = runUntil(w, RIGHT, (e) => e.t === 'death');
    const death = events.find((e) => e.t === 'death') as Extract<ServerEvent, { t: 'death' }>;
    expect(death.progress).toBeGreaterThan(0.05);
    expect(death.nearRecord).toBe(false);
  });

  test('constructed with prior deaths it continues the run count', () => {
    const w = new World(LEVEL, { deaths: 41, record: { progress: 0.5, run: 12 } });
    expect(w.run).toBe(42);
    expect(w.welcome(3)).toMatchObject({ t: 'welcome', deaths: 41, run: 42, online: 3, record: { progress: 0.5, run: 12 }, zone: 0 });
  });
});

describe('World dynamics', () => {
  // Spawn on a crumble over a pit: standing still, it gives way and the blob falls in.
  const rows = room('#######', 2, 6).map((r, y) => (y === 13 ? '#~~~###' : y > 13 ? '#...###' : r));
  const CRUMBLY = parseLevel(98, 1, [{ name: 'A', sky: 'blue', rooms: [rows] }]);
  const tile = 13 * CRUMBLY.width + 2;

  test('the run clock advances while running and stands still while paused', () => {
    const w = new World(CRUMBLY);
    for (let i = 0; i < 10; i++) w.step(STAND);
    expect(w.dyn.t).toBeCloseTo(10 / 60, 9);
    for (let i = 0; i < 100; i++) w.step(NOBODY);
    expect(w.dyn.t).toBeCloseTo(10 / 60, 9);
  });

  test('a reset recreates dynamics: the crumbled tile is back next run', () => {
    const w = new World(CRUMBLY);
    const events = runUntil(w, STAND, (e) => e.t === 'death');
    expect(events.find((e) => e.t === 'death')).toMatchObject({ cause: 'pit' });
    expect(w.dyn.crumbles.has(tile)).toBe(true);
    runUntil(w, STAND, (e) => e.t === 'reset');
    expect(w.dyn.t).toBe(0);
    expect(w.dyn.crumbles.size).toBe(0);
    for (let i = 0; i < 20; i++) w.step(STAND);
    expect(w.body.grounded).toBe(true);
    expect(w.body.y).toBeCloseTo(CRUMBLY.spawn.y, 9);
  });
});
