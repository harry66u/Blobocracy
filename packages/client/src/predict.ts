import { BLEND, DT, PHYS, stepBody, type Body, type Dynamics, type Level, type StateFrame } from '@blobocracy/shared';

const MAX_AHEAD_S = 0.15;
const SNAP_TILES = 3;
const HALF_LIFE_S = 0.06;

/** Frames carry float32 positions; snap values within this of a tile edge back onto it. */
const SNAP = 1e-3;

/** Undo float32 rounding: put a body resting on a tile edge exactly back on that edge. */
function snapEdge(v: number, half: number): number {
  for (const edge of [Math.round(v - half) + half, Math.round(v + half) - half]) {
    if (Math.abs(v - edge) < SNAP) return edge;
  }
  return v;
}

/** Body state as carried by a server frame (no prediction). */
export function bodyFromFrame(f: StateFrame): Body {
  return {
    x: snapEdge(f.x, PHYS.halfW), y: snapEdge(f.y, PHYS.halfH), vx: f.vx, vy: f.vy, grounded: f.grounded, coyote: 0, buffer: 0,
    rising: f.vy < 0 && f.jumpHeld, prevJumpHeld: f.jumpHeld, facing: f.facing, landed: 0,
  };
}

/** The run's hazard state as carried by a server frame: clock, touched crumbles, chomp. */
export function dynamicsFromFrame(f: StateFrame): Dynamics {
  return { t: f.runTime, crumbles: new Map(f.crumbles.map((c) => [c.tile, c.at])), chompStart: f.chompStart };
}

/**
 * Runs the shared physics forward from a server frame using that frame's blended
 * control, so the blob appears where the server will have it by now.
 * Never predicts deaths, pauses or resets: only 'running' frames advance.
 */
export function predict(frame: StateFrame, level: Level, aheadS: number): Body {
  const b = bodyFromFrame(frame);
  if (frame.phase !== 'running') return b;
  const steps = Math.floor(Math.min(Math.max(aheadS, 0), MAX_AHEAD_S) / DT + 1e-9);
  const curved = Math.sign(frame.pull) * Math.pow(Math.abs(frame.pull), BLEND.moveCurve);
  const control = { move: curved * (1 - BLEND.strainSlow * frame.strain), jumpHeld: frame.jumpHeld };
  const dyn = dynamicsFromFrame(frame);
  for (let i = 0; i < steps; i++) {
    if (stepBody(b, control, level, dyn)) break;
  }
  return b;
}

/** Exponential correction toward the predicted position; snaps after big jumps (resets, teleports). */
export function smooth(prev: { x: number; y: number }, target: { x: number; y: number }, dtS: number): { x: number; y: number } {
  const dx = target.x - prev.x, dy = target.y - prev.y;
  if (Math.hypot(dx, dy) > SNAP_TILES) return { x: target.x, y: target.y };
  const k = 1 - Math.pow(0.5, dtS / HALF_LIFE_S);
  return { x: prev.x + dx * k, y: prev.y + dy * k };
}
