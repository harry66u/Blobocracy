/**
 * Per-run state of the level's time-based features: the run clock that drives entities,
 * which crumble tiles have been stood on, and when the Big Chomp was triggered.
 * Advanced only by `stepBody`, so a paused or dying world leaves it untouched.
 */
import type { Level } from './level';

export interface Dynamics {
  /** Run time in seconds (advanced by `stepBody`). */
  t: number;
  /** Crumble tile index (`ty * width + tx`) → run time it was first stood on. */
  crumbles: Map<number, number>;
  /** Run time the Big Chomp was triggered, or null while it waits. */
  chompStart: number | null;
}

/** A crumble tile gives way this long after first being stood on, and stays gone for the run. */
export const CRUMBLE_S = 0.5;

/** Absorbs float drift in the summed clock so a crumble goes after exactly CRUMBLE_S / DT steps. */
const CLOCK_EPS = 1e-9;

export function createDynamics(): Dynamics {
  return { t: 0, crumbles: new Map(), chompStart: null };
}

export function cloneDynamics(d: Dynamics): Dynamics {
  return { t: d.t, crumbles: new Map(d.crumbles), chompStart: d.chompStart };
}

/** Whether the crumble tile at `tileIndex` has given way by run time `d.t`. */
export function crumbleGone(d: Dynamics, tileIndex: number): boolean {
  const at = d.crumbles.get(tileIndex);
  return at !== undefined && d.t - at >= CRUMBLE_S - CLOCK_EPS;
}

/**
 * Touched crumble tiles whose centers are within `range` tiles of world x, nearest first
 * (ties by tile index), at most `max` of them. This is what a state frame carries.
 */
export function nearbyCrumbles(d: Dynamics, level: Level, x: number, range = 40, max = 16): { tile: number; at: number }[] {
  const near: { tile: number; at: number; dist: number }[] = [];
  for (const [tile, at] of d.crumbles) {
    const dist = Math.abs((tile % level.width) + 0.5 - x);
    if (dist <= range) near.push({ tile, at, dist });
  }
  near.sort((a, b) => a.dist - b.dist || a.tile - b.tile);
  return near.slice(0, max).map(({ tile, at }) => ({ tile, at }));
}
