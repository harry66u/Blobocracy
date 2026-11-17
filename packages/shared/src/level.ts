import { LEVEL_HEIGHT, PHYS } from './constants';

/** Tile codes stored in `Level.tiles`. */
export const T_EMPTY = 0, T_SOLID = 1, T_ONEWAY = 2, T_SPIKE_UP = 3, T_SPIKE_DOWN = 4;

export type Sky = 'blue' | 'sunset' | 'purple';

/** Authoring form of a zone: rooms are concatenated left to right; each room is 18 equal-length rows. */
export interface ZoneDef { name: string; sky: Sky; rooms: string[][] }

/** A parsed zone, spanning columns `startX` (inclusive) to `endX` (exclusive). */
export interface Zone { index: number; name: string; sky: Sky; startX: number; endX: number }

/** A parsed level. Tiles are row-major: `tiles[ty * width + tx]`. */
export interface Level {
  id: number;
  version: number;
  width: number;
  height: 18;
  tiles: Uint8Array;
  zones: Zone[];
  spawn: { x: number; y: number };
  goalX: number;
}

const CHAR_TILE: Record<string, number> = {
  '#': T_SOLID, '=': T_ONEWAY, '^': T_SPIKE_UP, 'v': T_SPIKE_DOWN,
  '.': T_EMPTY, ' ': T_EMPTY, '@': T_EMPTY, 'G': T_EMPTY,
};

/**
 * Parses ASCII zones into a level. Throws on malformed rooms, unknown characters,
 * or anything but exactly one `@` (in the first room) and one `G` (in the last room).
 */
export function parseLevel(id: number, version: number, zones: ZoneDef[]): Level {
  const rooms = zones.flatMap((z) => z.rooms);
  if (rooms.length === 0) throw new Error('level has no rooms');

  rooms.forEach((room, r) => {
    if (room.length !== LEVEL_HEIGHT) {
      throw new Error(`room ${r} has ${room.length} rows, expected ${LEVEL_HEIGHT}`);
    }
    const w = room[0]!.length;
    room.forEach((row, y) => {
      if (row.length !== w) throw new Error(`room ${r} row ${y} has length ${row.length}, expected ${w}`);
    });
  });

  const width = rooms.reduce((sum, room) => sum + room[0]!.length, 0);
  const tiles = new Uint8Array(width * LEVEL_HEIGHT);
  const parsedZones: Zone[] = [];
  const spawns: { x: number; y: number; room: number }[] = [];
  const goals: { x: number; room: number }[] = [];

  let roomIndex = 0;
  let x0 = 0;
  zones.forEach((zone, index) => {
    const startX = x0;
    for (const room of zone.rooms) {
      room.forEach((row, ty) => {
        for (let cx = 0; cx < row.length; cx++) {
          const ch = row[cx]!;
          const tile = CHAR_TILE[ch];
          if (tile === undefined) throw new Error(`room ${roomIndex} row ${ty} col ${cx}: unknown tile '${ch}'`);
          const tx = x0 + cx;
          tiles[ty * width + tx] = tile;
          if (ch === '@') spawns.push({ x: tx + 0.5, y: ty + 1 - PHYS.halfH, room: roomIndex });
          if (ch === 'G') goals.push({ x: tx + 0.5, room: roomIndex });
        }
      });
      x0 += room[0]!.length;
      roomIndex++;
    }
    parsedZones.push({ index, name: zone.name, sky: zone.sky, startX, endX: x0 });
  });

  if (spawns.length !== 1) throw new Error(`level needs exactly one '@', found ${spawns.length}`);
  if (goals.length !== 1) throw new Error(`level needs exactly one 'G', found ${goals.length}`);
  const spawn = spawns[0]!;
  const goal = goals[0]!;
  if (spawn.room !== 0) throw new Error(`'@' must be in the first room, found in room ${spawn.room}`);
  if (goal.room !== rooms.length - 1) throw new Error(`'G' must be in the last room, found in room ${goal.room}`);

  return {
    id, version, width, height: LEVEL_HEIGHT, tiles, zones: parsedZones,
    spawn: { x: spawn.x, y: spawn.y }, goalX: goal.x,
  };
}

/** Tile code at a tile coordinate. Left and right of the level are solid walls; above and below are empty. */
export function tileAt(level: Level, tx: number, ty: number): number {
  if (tx < 0 || tx >= level.width) return T_SOLID;
  if (ty < 0 || ty >= level.height) return T_EMPTY;
  return level.tiles[ty * level.width + tx]!;
}

/** The zone containing world x, clamped to the first and last zones. */
export function zoneAt(level: Level, x: number): Zone {
  for (const zone of level.zones) {
    if (x < zone.endX) return zone;
  }
  return level.zones[level.zones.length - 1]!;
}

/** Run progress at world x: 0 at spawn, 1 at the goal, clamped. */
export function progressOf(level: Level, x: number): number {
  const p = (x - level.spawn.x) / (level.goalX - level.spawn.x);
  return Math.min(1, Math.max(0, p));
}
