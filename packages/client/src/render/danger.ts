// "Danger ahead" for the blob's worried face: static hazards and gaps from the tiles,
// plus the moving things (saws, slamming presses, crumbling floor, the Big Chomp).
import { CRUSHER_TEETH, entityState, MOVER_THICKNESS, type Entity } from '@blobocracy/shared';
import type { SceneBlob, SceneCrumble, SceneLevel } from './scene.ts';
import { isFloorTile, TILE_CEIL_SPIKE, TILE_CRUMBLE, TILE_SPIKE } from './tiles.ts';

/** Hitbox half height in tiles (hitbox is 1.1 × 1.2). */
export const HALF_H = 0.6;
/** A touched crumble tile shakes this long, then breaks. */
export const CRUMBLE_SHAKE_S = 0.5;
/** How far behind the blob the Big Chomp starts to worry it. */
export const CHOMP_WORRY = 6;
const AHEAD = 3.55;

/** The moving parts of the world at one moment of the run. */
export interface DangerWorld {
  entities: readonly Entity[];
  runTime: number;
  chompStart: number | null;
  crumbles: readonly SceneCrumble[];
}

/** Run time a crumble tile was first touched, or null if it hasn't been. */
export function crumbleTouchedAt(crumbles: readonly SceneCrumble[], tx: number, ty: number): number | null {
  for (const c of crumbles) if (c.tx === tx && c.ty === ty) return c.at;
  return null;
}

/** True once a touched crumble tile has broken apart (it no longer holds anything up). */
export function crumbleGone(crumbles: readonly SceneCrumble[], tx: number, ty: number, runTime: number): boolean {
  const at = crumbleTouchedAt(crumbles, tx, ty);
  return at !== null && runTime - at >= CRUMBLE_SHAKE_S;
}

/**
 * True when a spike, a bottomless gap, a saw or a slamming press is within about 3 tiles
 * ahead of the direction of travel, when the floor under the blob is crumbling, or when
 * the Big Chomp is within CHOMP_WORRY tiles behind.
 */
export function dangerAhead(level: SceneLevel, b: Pick<SceneBlob, 'x' | 'y' | 'vx' | 'facing'>, world?: DangerWorld): boolean {
  const dir = Math.abs(b.vx) > 0.5 ? Math.sign(b.vx) : b.facing;
  const feet = b.y + HALF_H;
  const t = world?.runTime ?? 0;
  const crumbles = world?.crumbles ?? [];
  const states = [];
  for (const e of world?.entities ?? []) {
    // skip anything far away (rails are short; the chomp is checked wherever it is)
    if (e.kind !== 'chomp' && Math.abs(e.x - b.x) > 16) continue;
    states.push(entityState(e, t, world?.chompStart ?? null));
  }

  // ---- moving things ----
  const wx0 = Math.min(b.x - dir * 1, b.x + dir * AHEAD), wx1 = Math.max(b.x - dir * 1, b.x + dir * AHEAD);
  const wy0 = b.y - 2.5, wy1 = feet + 0.5;
  for (const s of states) {
    if (s.kind === 'saw') {
      const nx = Math.max(wx0, Math.min(s.x, wx1)), ny = Math.max(wy0, Math.min(s.y, wy1));
      if (Math.hypot(s.x - nx, s.y - ny) < s.r) return true;
    } else if (s.kind === 'crusher') {
      if (s.moving !== 'down' && s.moving !== 'hold') continue;
      const bottom = s.y + s.h + CRUSHER_TEETH;
      if (s.x < wx1 && s.x + s.w > wx0 && s.y < feet && bottom > b.y - 3) return true;
    } else if (s.kind === 'chomp') {
      if (world?.chompStart != null && s.x > b.x - CHOMP_WORRY) return true;
    }
  }
  // the floor is crumbling under (or right next to) the blob
  for (const c of crumbles) {
    const age = t - c.at;
    if (age < 0 || age > CRUMBLE_SHAKE_S + 0.25) continue;
    if (Math.abs(c.tx + 0.5 - b.x) < 1.6 && c.ty >= feet - 0.6 && c.ty <= feet + 1.5) return true;
  }

  // ---- tiles ----
  const floorAt = (cx: number, ry: number) => {
    const tile = level.tileAt(cx, ry);
    if (!isFloorTile(tile)) return false;
    return tile !== TILE_CRUMBLE || !crumbleGone(crumbles, cx, ry, t);
  };
  const r0 = Math.floor(b.y - 1.8), r1 = Math.floor(feet + 0.5);
  const c0 = Math.floor(b.x), c1 = Math.floor(b.x + dir * AHEAD);
  const step = dir > 0 ? 1 : -1;
  for (let cx = c0; step > 0 ? cx <= c1 : cx >= c1; cx += step) {
    if (cx < 0 || cx >= level.width) continue;
    for (let ry = r0; ry <= r1; ry++) {
      if (ry < 0 || ry >= level.height) continue;
      const tile = level.tileAt(cx, ry);
      if (tile === TILE_SPIKE || tile === TILE_CEIL_SPIKE) return true;
    }
    // a gap: nothing to stand on anywhere below the feet in this column
    let floor = false;
    for (let ry = Math.max(0, Math.floor(feet - 0.3)); ry < level.height; ry++) {
      if (floorAt(cx, ry)) { floor = true; break; }
    }
    if (!floor) {
      for (const s of states) {
        if (s.kind === 'mover' && s.x < cx + 1 && s.x + s.w > cx && s.y + MOVER_THICKNESS >= feet - 0.3) { floor = true; break; }
      }
    }
    if (!floor) return true;
  }
  return false;
}
