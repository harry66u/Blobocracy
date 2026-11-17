// The game camera: follows the blob with look-ahead in the direction of travel (turning
// around gradually when the crowd changes its mind), a small vertical deadzone so hops
// don't bob the view, short shakes on deaths and big landings, and the swoop back to
// the start after a death. Works in tiles; the renderer snaps to device pixels.
import { GROUND_ROW, type Layout } from './layout.ts';
import { LAND_SHAKE, shakeEnvelope, swoopFrame } from './moments.ts';

/** Speed (tiles/s) that counts as clearly heading one way. */
const LOOK_SPEED = 2.5;
/** How long a new direction must hold before the camera starts turning (s). */
const LOOK_DWELL_S = 0.3;
/** Turn rate of the look-ahead (1/s, exponential). */
const LOOK_RATE = 2.2;
/** Vertical deadzone half-height (tiles). */
const DEADZONE = 1.2;
/** Landings faster than this (tiles/s) shake the camera. */
const BIG_LANDING = 19;
const FOLLOW_RATE = 5;
const MAX_SPEED = 40;

/** Which way to look: the direction of clear travel, otherwise wherever it already looks. */
export function lookTarget(vx: number, prev: number): number {
  return vx > LOOK_SPEED ? 1 : vx < -LOOK_SPEED ? -1 : prev;
}

/** Ease the look-ahead (-1 left … 1 right) toward its target. */
export function stepLook(look: number, target: number, dt: number): number {
  return look + (target - look) * (1 - Math.exp(-LOOK_RATE * Math.max(0, dt)));
}

/** Keep `ref` unless `y` leaves the band ref ± zone, then drag it along. */
export function deadzoneY(ref: number, y: number, zone: number): number {
  if (y > ref + zone) return y - zone;
  if (y < ref - zone) return y + zone;
  return ref;
}

/**
 * Where the view's left/top edge wants to be. `look` 1 puts the blob `lookAhead` tiles
 * from the left edge (room to see ahead to the right), -1 mirrors it, 0 centers it.
 * `refY` is the deadzoned height the camera follows.
 */
export function cameraTarget(L: Layout, focus: { x: number }, look: number, refY: number): { x: number; y: number } {
  const viewW = L.w / L.tile;
  const fromLeft = viewW / 2 + (L.lookAhead - viewW / 2) * look;
  const above = L.groundY / L.tile;
  const anchor = GROUND_ROW - above;
  return { x: focus.x - fromLeft, y: Math.min(anchor, refY - above * 0.55) };
}

export interface CameraFocus { x: number; y: number; vx: number; vy: number; grounded: boolean }

export class CameraRig {
  private pos: { x: number; y: number } | null = null;
  private look = 1;
  private lookGoal = 1;
  private pendingDir = 1;
  private pendingT = 0;
  private refY: number | null = null;
  private prevGrounded = true;
  private prevVy = 0;
  private shakeAmp = 0;
  private shakeDur = 1;
  private shakeAge = 99;
  private seed = 0;
  private swoopFrom: { x: number; y: number } | null = null;
  private swoopT = 0;
  private swoopDur = 1;
  private swoopReduced = false;
  /** Celebrating: a fixed framing instead of the look-ahead, or null. */
  private framing: number | null = null;

  /**
   * The win: frame the blob for the party instead of looking ahead (the level ends just
   * ahead). Wide views put it toward the right with the conquered level behind it, clear
   * of the win card in the middle; tall views center it under the card.
   */
  celebrate(on: boolean, phone: boolean): void {
    this.framing = on ? (phone ? 0 : -1.35) : null;
    if (!on && this.lookGoal !== this.pendingDir) this.lookGoal = this.pendingDir;
  }

  /** Drop all easing (e.g. after the tab comes back): the next update lands on target. */
  snap(): void {
    this.pos = null;
    this.refY = null;
    this.swoopFrom = null;
  }

  /** Start a shake of `amp` tiles that dies out over `dur` seconds (the stronger one wins). */
  kick(amp: number, dur: number): void {
    const now = shakeEnvelope(this.shakeAge, this.shakeAmp, this.shakeDur);
    if (amp < now) return;
    this.shakeAmp = amp;
    this.shakeDur = dur;
    this.shakeAge = 0;
    this.seed = (this.seed + 1.7) % 100;
  }

  /** Fly from the current view to wherever the focus is next (the start), over `dur` seconds. */
  swoop(dur: number, reduced: boolean): void {
    if (!this.pos) return;
    this.swoopFrom = { ...this.pos };
    this.swoopT = 0;
    this.swoopDur = dur;
    this.swoopReduced = reduced;
    this.look = this.lookGoal = this.pendingDir = 1;
  }

  /** 0..1 progress of a running swoop, or null. */
  get swoopK(): number | null {
    return this.swoopFrom ? swoopFrame(this.swoopT, this.swoopDur, this.swoopReduced).k : null;
  }

  /** Reduced-motion cover fade of a running swoop, 0..1. */
  get swoopFade(): number {
    return this.swoopFrom ? swoopFrame(this.swoopT, this.swoopDur, this.swoopReduced).fade : 0;
  }

  /** Current shake offset in tiles (add it to the camera). */
  shakeOffset(): { x: number; y: number } {
    const a = shakeEnvelope(this.shakeAge, this.shakeAmp, this.shakeDur);
    if (a <= 0) return { x: 0, y: 0 };
    const t = this.shakeAge + this.seed;
    return {
      x: a * (Math.sin(t * 71 + 0.7) * 0.7 + Math.sin(t * 43 + 2.1) * 0.3),
      y: a * (Math.cos(t * 59 + 1.3) * 0.7 + Math.sin(t * 37 + 0.4) * 0.3),
    };
  }

  /** Advance one frame; returns the view's left/top edge in tiles (without shake). */
  update(L: Layout, f: CameraFocus, dtS: number, reduced: boolean): { x: number; y: number } {
    const dt = Math.min(Math.max(dtS, 0), 0.25);
    this.shakeAge += dt;
    if (reduced) this.shakeAmp = 0;

    // landing shake
    if (!this.prevGrounded && f.grounded && this.prevVy >= BIG_LANDING && !reduced) {
      this.kick(LAND_SHAKE.amp * Math.min(1.6, this.prevVy / BIG_LANDING), LAND_SHAKE.dur);
    }
    this.prevGrounded = f.grounded;
    this.prevVy = f.vy;

    // look-ahead: a new direction has to hold for a moment before the camera turns
    const dir = lookTarget(f.vx, this.pendingDir);
    if (dir !== this.pendingDir) { this.pendingDir = dir; this.pendingT = 0; }
    this.pendingT += dt;
    if (this.pendingT >= LOOK_DWELL_S) this.lookGoal = this.pendingDir;
    if (this.framing !== null) this.lookGoal = this.framing;
    this.look = stepLook(this.look, this.lookGoal, dt);

    // vertical deadzone; settle onto the floor height when standing
    if (this.refY === null) this.refY = f.y;
    if (f.grounded) this.refY += (f.y - this.refY) * (1 - Math.exp(-3 * dt));
    this.refY = deadzoneY(this.refY, f.y, DEADZONE);

    const target = cameraTarget(L, f, this.look, this.refY);
    if (this.swoopFrom) {
      this.swoopT += dt;
      const s = swoopFrame(this.swoopT, this.swoopDur, this.swoopReduced);
      this.pos = { x: this.swoopFrom.x + (target.x - this.swoopFrom.x) * s.k, y: this.swoopFrom.y + (target.y - this.swoopFrom.y) * s.k };
      if (s.done) this.swoopFrom = null;
      return this.pos;
    }
    if (!this.pos) {
      this.pos = target;
      return { ...target };
    }
    const k = 1 - Math.exp(-FOLLOW_RATE * dt);
    const lim = MAX_SPEED * dt;
    this.pos = {
      x: this.pos.x + clamp((target.x - this.pos.x) * k, -lim, lim),
      y: this.pos.y + clamp((target.y - this.pos.y) * k, -lim, lim),
    };
    return { ...this.pos };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
