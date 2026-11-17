import { BLEND } from './constants';

/**
 * Weighted vote counts from active voters. A voter holding left and right together counts in neither.
 * `fresh`: voters whose jump press began within the last `BLEND.freshS` seconds.
 */
export interface VoteCounts { left: number; right: number; jump: number; active: number; fresh?: number }

/**
 * What the physics sees: `move` in −1..1 (already slowed by strain), whether jump is held
 * (controls jump height), and `jumpPressed`, a one-step pulse when a new burst of presses arrives.
 */
export interface Control { move: number; jumpHeld: boolean; jumpPressed?: boolean }

/** Blended control plus the raw crowd readings the HUD and blob animation use. */
export interface BlendOut extends Control { pull: number; pressure: number; strain: number; jumpPressed: boolean; freshHigh: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Blends crowd votes into one control (spec §7). Jump uses hysteresis: it turns on at
 * `BLEND.jumpOn` pressure and stays on until pressure drops below `BLEND.jumpOff`.
 * A crowd rarely lets go together, so a fresh burst of presses (at least `jumpOn` of the
 * active voters within `BLEND.freshS`) also fires a jump while jump is still held.
 */
export function blend(v: VoteCounts, prevJumpHeld: boolean, prevFreshHigh = false): BlendOut {
  const a = Math.max(v.active, 1);
  const pull = clamp((v.right - v.left) / a, -1, 1);
  const pressure = clamp(v.jump / a, 0, 1);
  const strain = Math.min(1, (2 * Math.min(v.left, v.right)) / a);
  // Response curve: a mostly-agreeing crowd feels decisive; a dead split still stands still.
  const curved = Math.sign(pull) * Math.pow(Math.abs(pull), BLEND.moveCurve);
  const move = curved * (1 - BLEND.strainSlow * strain);
  const jumpHeld = prevJumpHeld ? pressure >= BLEND.jumpOff : pressure >= BLEND.jumpOn;
  const freshShare = (v.fresh ?? 0) / a;
  // Same hysteresis as held jump, so a burst hovering near the threshold fires once.
  const freshHigh = prevFreshHigh ? freshShare >= BLEND.jumpOff : freshShare >= BLEND.jumpOn;
  const jumpPressed = freshHigh && !prevFreshHigh;
  return { move, jumpHeld, jumpPressed, freshHigh, pull, pressure, strain };
}
