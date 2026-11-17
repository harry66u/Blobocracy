import { describe, expect, test } from 'vitest';
import {
  parseLevel, tileAt, zoneAt, progressOf,
  T_EMPTY, T_SOLID, T_ONEWAY, T_SPIKE_UP, T_SPIKE_DOWN,
  type ZoneDef,
} from '../src/level';

/** Builds an 18-row room: `bottom` rows are placed at the bottom, empty rows fill the top. */
function room(width: number, bottom: string[]): string[] {
  const top = Array.from({ length: 18 - bottom.length }, () => '.'.repeat(width));
  return [...top, ...bottom];
}

const roomA = room(5, [
  '.@.v.',
  '.^=..',
  '#####',
]);
const roomB = room(7, [
  '.... G.',
  '#######',
]);
const twoRooms: ZoneDef[] = [{ name: 'Start', sky: 'blue', rooms: [roomA, roomB] }];

describe('parseLevel', () => {
  test('concatenates rooms left to right', () => {
    const lvl = parseLevel(3, 7, twoRooms);
    expect(lvl.id).toBe(3);
    expect(lvl.version).toBe(7);
    expect(lvl.width).toBe(12);
    expect(lvl.height).toBe(18);
    expect(lvl.tiles.length).toBe(12 * 18);
    expect(lvl.zones).toEqual([{ index: 0, name: 'Start', sky: 'blue', startX: 0, endX: 12 }]);
  });

  test('maps every character to its tile code', () => {
    const lvl = parseLevel(1, 1, twoRooms);
    expect(tileAt(lvl, 0, 17)).toBe(T_SOLID);
    expect(tileAt(lvl, 2, 16)).toBe(T_ONEWAY);
    expect(tileAt(lvl, 1, 16)).toBe(T_SPIKE_UP);
    expect(tileAt(lvl, 3, 15)).toBe(T_SPIKE_DOWN);
    expect(tileAt(lvl, 0, 15)).toBe(T_EMPTY); // '.'
    expect(tileAt(lvl, 9, 16)).toBe(T_EMPTY); // ' '
    expect(tileAt(lvl, 1, 15)).toBe(T_EMPTY); // '@'
    expect(tileAt(lvl, 10, 16)).toBe(T_EMPTY); // 'G'
    expect(tileAt(lvl, 11, 17)).toBe(T_SOLID); // second room
  });

  test('@ sets the spawn at the bottom-center of its tile, standing', () => {
    const lvl = parseLevel(1, 1, twoRooms);
    expect(lvl.spawn.x).toBeCloseTo(1.5, 10);
    expect(lvl.spawn.y).toBeCloseTo(15 + 1 - 0.6, 10);
  });

  test('G sets goalX', () => {
    const lvl = parseLevel(1, 1, twoRooms);
    expect(lvl.goalX).toBeCloseTo(10.5, 10);
  });

  test('zone bounds follow the zone order', () => {
    const lvl = parseLevel(1, 1, [
      { name: 'One', sky: 'blue', rooms: [roomA] },
      { name: 'Two', sky: 'sunset', rooms: [roomB] },
    ]);
    expect(lvl.zones.map((z) => [z.index, z.name, z.sky, z.startX, z.endX])).toEqual([
      [0, 'One', 'blue', 0, 5],
      [1, 'Two', 'sunset', 5, 12],
    ]);
    expect(zoneAt(lvl, 0).index).toBe(0);
    expect(zoneAt(lvl, 4.99).index).toBe(0);
    expect(zoneAt(lvl, 5).index).toBe(1);
    expect(zoneAt(lvl, -3).index).toBe(0);
    expect(zoneAt(lvl, 99).index).toBe(1);
  });

  test('rows of unequal length throw with room and row', () => {
    const bad = [...roomB];
    bad[4] = '....';
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [roomA, bad] }]))
      .toThrow(/room \d+ row \d+/);
  });

  test('a room without 18 rows throws', () => {
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [roomA, roomB.slice(1)] }]))
      .toThrow(/room 1/);
  });

  test('zero or two spawns throw', () => {
    const noSpawn = roomA.map((r) => r.replace('@', '.'));
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [noSpawn, roomB] }])).toThrow(/@/);
    const twoSpawns = [...roomA];
    twoSpawns[0] = '@....';
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [twoSpawns, roomB] }])).toThrow(/@/);
  });

  test('spawn outside the first room or goal outside the last room throws', () => {
    const spawnInB = [...roomB];
    spawnInB[0] = '@......';
    const noSpawnA = roomA.map((r) => r.replace('@', '.'));
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [noSpawnA, spawnInB] }])).toThrow(/@/);
    const goalInA = [...roomA];
    goalInA[0] = 'G....';
    const noGoalB = roomB.map((r) => r.replace('G', '.'));
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [goalInA, noGoalB] }])).toThrow(/G/);
  });

  test('zero or two goals throw', () => {
    const noGoal = roomB.map((r) => r.replace('G', '.'));
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [roomA, noGoal] }])).toThrow(/G/);
    const twoGoals = [...roomB];
    twoGoals[0] = 'G......';
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [roomA, twoGoals] }])).toThrow(/G/);
  });

  test('unknown characters throw', () => {
    const bad = [...roomB];
    bad[0] = '...X...';
    expect(() => parseLevel(1, 1, [{ name: 'Z', sky: 'blue', rooms: [roomA, bad] }])).toThrow(/room 1 row 0/);
  });
});

describe('tileAt out of bounds', () => {
  const lvl = parseLevel(1, 1, twoRooms);
  test('left of the level is a solid wall', () => {
    expect(tileAt(lvl, -1, 5)).toBe(T_SOLID);
    expect(tileAt(lvl, -1, 17)).toBe(T_SOLID);
  });
  test('right of the level is a solid wall', () => {
    expect(tileAt(lvl, 12, 5)).toBe(T_SOLID);
    expect(tileAt(lvl, 40, 17)).toBe(T_SOLID);
  });
  test('above and below are empty', () => {
    expect(tileAt(lvl, 3, -1)).toBe(T_EMPTY);
    expect(tileAt(lvl, 3, 18)).toBe(T_EMPTY);
    expect(tileAt(lvl, 3, 30)).toBe(T_EMPTY);
  });
});

describe('progressOf', () => {
  const lvl = parseLevel(1, 1, twoRooms);
  test('is 0 at spawn and 1 at goal', () => {
    expect(progressOf(lvl, lvl.spawn.x)).toBe(0);
    expect(progressOf(lvl, lvl.goalX)).toBe(1);
  });
  test('is linear between and clamped outside', () => {
    expect(progressOf(lvl, (lvl.spawn.x + lvl.goalX) / 2)).toBeCloseTo(0.5, 10);
    expect(progressOf(lvl, -5)).toBe(0);
    expect(progressOf(lvl, 50)).toBe(1);
  });
});
