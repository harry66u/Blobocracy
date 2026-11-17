import { BLEND } from './constants';

/** Weighted vote counts from active voters. A voter holding left and right together counts in neither. */
export interface VoteCounts { left: number; right: number; jump: number; active: number }

/** What the physics sees: `move` in −1..1 (already slowed by strain) and whether jump is held. */
export interface Control { move: number; jumpHeld: boolean }

/** Blended control plus the raw crowd readings the HUD and blob animation use. */
export interface BlendOut extends Control { pull: number; pressure: number; strain: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Blends crowd votes into one control (spec §7). Jump uses hysteresis: it turns on at
 * `BLEND.jumpOn` pressure and stays on until pressure drops below `BLEND.jumpOff`.
 */
export function blend(v: VoteCounts, prevJumpHeld: boolean): BlendOut {
  const a = Math.max(v.active, 1);
  const pull = clamp((v.right - v.left) / a, -1, 1);
  const pressure = clamp(v.jump / a, 0, 1);
  const strain = Math.min(1, (2 * Math.min(v.left, v.right)) / a);
  const move = pull * (1 - BLEND.strainSlow * strain);
  const jumpHeld = prevJumpHeld ? pressure >= BLEND.jumpOff : pressure >= BLEND.jumpOn;
  return { move, jumpHeld, pull, pressure, strain };
}
