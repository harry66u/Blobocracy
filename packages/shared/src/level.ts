import { LEVEL_HEIGHT, PHYS } from './constants';
import { makeEntity, type Entity, type EntitySpec } from './entities';

/** Tile codes stored in `Level.tiles`. */
export const T_EMPTY = 0, T_SOLID = 1, T_ONEWAY = 2, T_SPIKE_UP = 3, T_SPIKE_DOWN = 4;
/** Solid until stood on, then gives way (see physics). */
export const T_CRUMBLE = 5;
/** Solid; standing on it launches the blob high. */
export const T_SPRING = 6;
/** Solid; standing on it pushes the blob right (R) or left (L). */
export const T_CONVEYOR_R = 7, T_CONVEYOR_L = 8;

export type Sky = 'blue' | 'sunset' | 'purple';

/**
 * Authoring form of a room: 18 equal-length rows, plus specs for any entity marker
 * letters in it (A–Z except G). A plain string[] is a room without entities.
 */
export interface RoomDef { rows: string[]; entities?: Record<string, EntitySpec> }

/**
 * Authoring form of a zone: rooms are concatenated left to right. `gravity` (optional)
 * scales gravity while the blob is in the zone: 0.6 makes jumps 1/0.6 higher and longer.
 */
export interface ZoneDef { name: string; sky: Sky; gravity?: number; rooms: (string[] | RoomDef)[] }

/**
 * A parsed zone, spanning columns `startX` (inclusive) to `endX` (exclusive).
 * `gravity` is present only for zones that set one (normal gravity otherwise).
 */
export interface Zone { index: number; name: string; sky: Sky; startX: number; endX: number; gravity?: number }

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
  /** Moving hazards and platforms, in authoring order; `id` is the index. */
  entities: Entity[];
}

const CHAR_TILE: Record<string, number> = {
  '#': T_SOLID, '=': T_ONEWAY, '^': T_SPIKE_UP, 'v': T_SPIKE_DOWN,
  '.': T_EMPTY, ' ': T_EMPTY, '@': T_EMPTY, 'G': T_EMPTY,
  '~': T_CRUMBLE, '*': T_SPRING, '>': T_CONVEYOR_R, '<': T_CONVEYOR_L,
};
const isMarker = (ch: string) => ch >= 'A' && ch <= 'Z' && ch !== 'G';
const rowsOf = (room: string[] | RoomDef): string[] => (Array.isArray(room) ? room : room.rows);

/**
 * Parses ASCII zones into a level. Throws on malformed rooms, unknown characters,
 * or anything but exactly one `@` (in the first room) and one `G` (in the last room).
 */
export function parseLevel(id: number, version: number, zones: ZoneDef[]): Level {
  const rooms = zones.flatMap((z) => z.rooms.map(rowsOf));
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
  const entities: Entity[] = [];

  let roomIndex = 0;
  let x0 = 0;
  zones.forEach((zone, index) => {
    const startX = x0;
    for (const roomDef of zone.rooms) {
      const room = rowsOf(roomDef);
      const specs = Array.isArray(roomDef) ? {} : roomDef.entities ?? {};
      room.forEach((row, ty) => {
        for (let cx = 0; cx < row.length; cx++) {
          const ch = row[cx]!;
          if (isMarker(ch)) {
            const spec = specs[ch];
            if (!spec) throw new Error(`room ${roomIndex} row ${ty} col ${cx}: marker '${ch}' has no entity spec`);
            entities.push(makeEntity(spec, -1, x0 + cx, ty));
            continue; // markers leave an empty tile
          }
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
    if (zone.gravity !== undefined && !(zone.gravity > 0)) throw new Error(`zone '${zone.name}' gravity must be positive`);
    parsedZones.push({ index, name: zone.name, sky: zone.sky, startX, endX: x0, ...(zone.gravity !== undefined ? { gravity: zone.gravity } : {}) });
  });

  // Ids follow reading order through the level: left to right, then top to bottom.
  entities.sort((a, b) => a.x - b.x || ('y' in a && 'y' in b ? a.y - b.y : 0));
  entities.forEach((e, i) => { e.id = i; });

  if (spawns.length !== 1) throw new Error(`level needs exactly one '@', found ${spawns.length}`);
  if (goals.length !== 1) throw new Error(`level needs exactly one 'G', found ${goals.length}`);
  const spawn = spawns[0]!;
  const goal = goals[0]!;
  if (spawn.room !== 0) throw new Error(`'@' must be in the first room, found in room ${spawn.room}`);
  if (goal.room !== rooms.length - 1) throw new Error(`'G' must be in the last room, found in room ${goal.room}`);

  return {
    id, version, width, height: LEVEL_HEIGHT, tiles, zones: parsedZones,
    spawn: { x: spawn.x, y: spawn.y }, goalX: goal.x, entities,
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

/** The gravity multiplier at world x: its zone's `gravity`, else 1. */
export function gravityAt(level: Level, x: number): number {
  return zoneAt(level, x).gravity ?? 1;
}

/** Run progress at world x: 0 at spawn, 1 at the goal, clamped. */
export function progressOf(level: Level, x: number): number {
  const p = (x - level.spawn.x) / (level.goalX - level.spawn.x);
  return Math.min(1, Math.max(0, p));
}

/**
 * A short fingerprint of a level's geometry and entities (FNV-1a, hex), recorded per
 * level version (spec §9 `level_versions.geometry_hash`) so a retune is visible in the data.
 */
export function levelHash(level: Level): string {
  let h = 0x811c9dc5;
  const mix = (b: number) => { h ^= b & 255; h = Math.imul(h, 0x01000193) >>> 0; };
  mix(level.width); mix(level.width >> 8); mix(level.height);
  for (let i = 0; i < level.tiles.length; i++) mix(level.tiles[i]!);
  const ents = JSON.stringify(level.entities);
  for (let i = 0; i < ents.length; i++) mix(ents.charCodeAt(i));
  return h.toString(16).padStart(8, '0');
}
