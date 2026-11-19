// Checkpoints (every 20% of the way to the goal): a death sends everyone back to the last one
// the blob reached instead of the very start. Their positions are authored data, picked by
// tools/gen-checkpoints.ts from the solver's perfect-run route so each sits on safe, flat ground
// that route passes. The data records the level's geometry hash: change the level and the
// checkpoints go stale (tests fail) until the tool is run again.
import { CHECKPOINT_DATA } from './levels/checkpoints';
import { LEVEL_HEIGHT } from './constants';
import { PHYS } from './constants';
import { levelHash, progressOf, tileAt, T_EMPTY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, type Level } from './level';

export interface Checkpoint {
  /** 1-based: checkpoint 1 is the 20% one. 0 means the level's start. */
  index: number;
  /** The progress it stands at, 0..1. */
  progress: number;
  /** Where the blob respawns: x is a tile centre, y puts it standing on the ground. */
  x: number;
  y: number;
}

/** Progress spacing between checkpoints. */
export const CHECKPOINT_STEP = 0.2;

const cache = new WeakMap<Level, Checkpoint[]>();

/** The level's checkpoints in order (empty when the level has none or they are stale). */
export function checkpointsOf(level: Level): Checkpoint[] {
  let list = cache.get(level);
  if (!list) {
    const data = CHECKPOINT_DATA[level.id];
    list = data && data.hash === levelHash(level)
      ? data.points.map(([x, y], i) => ({ index: i + 1, progress: progressOf(level, x), x, y }))
      : [];
    cache.set(level, list);
  }
  return list;
}

/** The respawn point for checkpoint `index` (0 = the level's spawn). */
export function startOf(level: Level, index: number): { x: number; y: number } {
  const c = index > 0 ? checkpointsOf(level)[index - 1] : undefined;
  return c ? { x: c.x, y: c.y } : { ...level.spawn };
}

/**
 * Is a 3-wide flat solid pad under (x, y) clear to respawn on? It needs four empty rows above,
 * no spikes within three columns, no moving hazard or platform reaching within three columns,
 * and to be well above the pit.
 */
export function padIsSafe(level: Level, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const r = Math.round(y + PHYS.halfH);
  if (Math.abs(y + PHYS.halfH - r) > 1e-9 || r >= LEVEL_HEIGHT - 4 || r < 5) return false;
  for (let dx = -1; dx <= 1; dx++) {
    if (tileAt(level, tx + dx, r) !== T_SOLID) return false;
    for (let up = 1; up <= 4; up++) if (tileAt(level, tx + dx, r - up) !== T_EMPTY) return false;
  }
  for (let dx = -3; dx <= 3; dx++) {
    for (let row = r - 4; row <= r; row++) {
      const t = tileAt(level, tx + dx, row);
      if (t === T_SPIKE_UP || t === T_SPIKE_DOWN) return false;
    }
  }
  for (const e of level.entities) {
    let lo: number, hi: number;
    switch (e.kind) {
      case 'crusher': lo = e.x - 1; hi = e.x + e.w + 1; break;
      case 'mover': lo = e.x + Math.min(0, e.dx) - 1; hi = e.x + e.w + Math.max(0, e.dx) + 1; break;
      case 'saw': lo = e.x - e.r - Math.abs(e.dx) - 1; hi = e.x + e.r + Math.abs(e.dx) + 1; break;
      default: continue; // wind only pushes, and the chomp is behind the blob by design
    }
    if (tx - 3 < hi && tx + 4 > lo) return false;
  }
  return true;
}
