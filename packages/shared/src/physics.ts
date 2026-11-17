import type { Control } from './blend';
import { DT, PHYS } from './constants';
import { tileAt, T_ONEWAY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, type Level } from './level';

/** Hazard names used in death messages (spec §6.5). */
export type Cause = 'spikes' | 'ceiling spikes' | 'pit';

/**
 * The shared blob. `x, y` is the center of a `2·halfW × 2·halfH` box; y grows down.
 * `coyote` and `buffer` are seconds left; `landed` is the impact speed on the step it landed, else 0.
 */
export interface Body {
  x: number; y: number; vx: number; vy: number;
  grounded: boolean; coyote: number; buffer: number; rising: boolean; prevJumpHeld: boolean;
  facing: 1 | -1; landed: number;
}

/** Keeps touching edges from counting as overlap. */
const EPS = 1e-9;

/** Floor spikes kill in their lower 60% and middle 70%; ceiling spikes are mirrored. */
const SPIKE_INSET_X = 0.15;
const SPIKE_DEPTH = 0.6;
/** A pit kills once the body's center sinks this many rows above the level's bottom edge. */
const PIT_DEATH_ROWS = 2.5;

const solidAt = (level: Level, tx: number, ty: number) => tileAt(level, tx, ty) === T_SOLID;

/** Inclusive tile range covered by the open interval (lo, hi). */
const span = (lo: number, hi: number): [number, number] => [Math.floor(lo + EPS), Math.floor(hi - EPS)];

/** Whether the body's bottom rests exactly on a solid or one-way tile top. */
function supported(level: Level, x: number, y: number): boolean {
  const bottom = y + PHYS.halfH;
  const ty = Math.round(bottom);
  if (Math.abs(bottom - ty) > 1e-6) return false;
  const [tx0, tx1] = span(x - PHYS.halfW, x + PHYS.halfW);
  for (let tx = tx0; tx <= tx1; tx++) {
    const t = tileAt(level, tx, ty);
    if (t === T_SOLID || t === T_ONEWAY) return true;
  }
  return false;
}

/** A body at rest on the level's spawn. */
export function createBody(level: Level): Body {
  const { x, y } = level.spawn;
  const grounded = supported(level, x, y);
  return {
    x, y, vx: 0, vy: 0, grounded, coyote: grounded ? PHYS.coyoteS : 0, buffer: 0,
    rising: false, prevJumpHeld: false, facing: 1, landed: 0,
  };
}

const countDown = (t: number) => (t - DT > EPS ? t - DT : 0);
const approach = (v: number, target: number, step: number) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

/** Moves along x and pushes out of solid tiles. */
function moveX(b: Body, level: Level): void {
  b.x += b.vx * DT;
  const [ty0, ty1] = span(b.y - PHYS.halfH, b.y + PHYS.halfH);
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  if (b.vx > 0) {
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(level, tx, ty)) { b.x = tx - PHYS.halfW; b.vx = 0; return; }
      }
    }
  } else if (b.vx < 0) {
    for (let tx = tx1; tx >= tx0; tx--) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(level, tx, ty)) { b.x = tx + 1 + PHYS.halfW; b.vx = 0; return; }
      }
    }
  }
}

/** Moves along y by `dy`, lands on solid or one-way tops, bumps solid ceilings. Returns true on landing. */
function moveY(b: Body, level: Level, dy: number): boolean {
  const prevBottom = b.y + PHYS.halfH;
  b.y += dy;
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  const [ty0, ty1] = span(b.y - PHYS.halfH, b.y + PHYS.halfH);
  if (dy > 0) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tileAt(level, tx, ty);
        if (t === T_SOLID || (t === T_ONEWAY && prevBottom <= ty + EPS)) {
          b.y = ty - PHYS.halfH;
          return true;
        }
      }
    }
  } else if (dy < 0) {
    for (let ty = ty1; ty >= ty0; ty--) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (solidAt(level, tx, ty)) {
          b.y = ty + 1 + PHYS.halfH;
          b.vy = Math.max(b.vy, 0);
          b.rising = false;
          return false;
        }
      }
    }
  }
  return false;
}

/** The spike the body touches, if any, using the inset spike hitboxes. */
function spikeHit(b: Body, level: Level): Cause | null {
  const left = b.x - PHYS.halfW, right = b.x + PHYS.halfW;
  const top = b.y - PHYS.halfH, bottom = b.y + PHYS.halfH;
  const [tx0, tx1] = span(left, right);
  const [ty0, ty1] = span(top, bottom);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = tileAt(level, tx, ty);
      if (t !== T_SPIKE_UP && t !== T_SPIKE_DOWN) continue;
      if (right <= tx + SPIKE_INSET_X || left >= tx + 1 - SPIKE_INSET_X) continue;
      if (t === T_SPIKE_UP && bottom > ty + 1 - SPIKE_DEPTH) return 'spikes';
      if (t === T_SPIKE_DOWN && top < ty + SPIKE_DEPTH) return 'ceiling spikes';
    }
  }
  return null;
}

/**
 * Advances the body by exactly one `DT` under control `c`, mutating it.
 * Returns the cause of death if the body died this step, else null.
 */
export function stepBody(b: Body, c: Control, level: Level): Cause | null {
  // Jump input: a rising edge buffers a jump; it fires once the body can jump.
  const edge = (c.jumpHeld && !b.prevJumpHeld) || c.jumpPressed === true;
  b.buffer = edge ? PHYS.bufferS : countDown(b.buffer);
  b.prevJumpHeld = c.jumpHeld;
  if (b.buffer > 0 && (b.grounded || b.coyote > 0)) {
    b.vy = -PHYS.jumpVelocity;
    b.buffer = 0;
    b.coyote = 0;
    b.grounded = false;
    b.rising = true;
  }
  if (b.rising && !c.jumpHeld) b.vy = Math.max(b.vy, -PHYS.jumpCutVelocity);

  // Horizontal: approach the target speed; less grip in the air.
  if (c.move > 0) b.facing = 1;
  else if (c.move < 0) b.facing = -1;
  const accel = b.grounded ? PHYS.accelGround : PHYS.accelAir;
  b.vx = approach(b.vx, PHYS.runSpeed * c.move, accel * DT);
  moveX(b, level);

  // Vertical: exact integration under constant gravity (average of old and new velocity).
  const vy0 = b.vy;
  const vy1 = Math.min(vy0 + PHYS.gravity * DT, PHYS.maxFall);
  b.vy = vy1;
  const wasGrounded = b.grounded;
  const landedNow = moveY(b, level, ((vy0 + vy1) / 2) * DT);
  b.landed = landedNow && !wasGrounded ? vy1 : 0;
  if (landedNow) b.vy = 0;
  b.grounded = landedNow;
  if (b.vy >= 0) b.rising = false;
  b.coyote = b.grounded ? PHYS.coyoteS : countDown(b.coyote);

  const spike = spikeHit(b, level);
  if (spike) return spike;
  // Kill while the blob is still visible in the pit, so the death freeze shows it.
  if (b.y > level.height - PIT_DEATH_ROWS) return 'pit';
  return null;
}
