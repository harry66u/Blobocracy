// Tile codes shared by the renderer (same values as @blobocracy/shared's T_* codes).
/** Tile codes: 0 empty, 1 solid, 2 one-way platform, 3 floor spike (points up), 4 ceiling spike (points down). */
export const TILE_EMPTY = 0;
export const TILE_SOLID = 1;
export const TILE_ONEWAY = 2;
export const TILE_SPIKE = 3;
export const TILE_CEIL_SPIKE = 4;
/** Solid until stood on, then shakes and breaks apart. */
export const TILE_CRUMBLE = 5;
/** Solid; launches the blob. */
export const TILE_SPRING = 6;
/** Solid belts that push right / left. */
export const TILE_CONVEYOR_R = 7;
export const TILE_CONVEYOR_L = 8;

/** Tiles drawn every frame (they animate or vanish), never baked into the level chunks. */
export function isDynamicTile(t: number): boolean {
  return t >= TILE_CRUMBLE && t <= TILE_CONVEYOR_L;
}

/** Tiles the blob can stand on (a broken crumble tile is handled separately). */
export function isFloorTile(t: number): boolean {
  return t === TILE_SOLID || t === TILE_ONEWAY || isDynamicTile(t);
}
