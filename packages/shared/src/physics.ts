import type { Control } from './blend';
import { DT, PHYS } from './constants';
import { crumbleGone, type Dynamics } from './dynamics';
import { CRUSHER_TEETH, MOVER_THICKNESS, entityState, type EntityState } from './entities';
import {
  tileAt, T_CONVEYOR_L, T_CONVEYOR_R, T_CRUMBLE, T_ONEWAY, T_SOLID, T_SPIKE_DOWN, T_SPIKE_UP, T_SPRING, type Level,
} from './level';

/** Hazard names used in death messages (spec §6.5). 'press' is the Big Press (crusher). */
export type Cause = 'spikes' | 'ceiling spikes' | 'pit' | 'press' | 'saw' | 'chomp';

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
/**
 * Entity geometry is not tile-aligned and clients predict from float32 frames, so contacts
 * with entities use a looser tolerance: within this, touching is not overlapping, and a body
 * this close above a platform top counts as standing on it.
 */
const ENT_EPS = 1e-3;

/** Floor spikes kill in their lower 60% and middle 70%; ceiling spikes are mirrored. */
const SPIKE_INSET_X = 0.15;
const SPIKE_DEPTH = 0.6;
/** A pit kills once the body's center sinks this many rows above the level's bottom edge. */
const PIT_DEATH_ROWS = 2.5;
/** The Big Chomp starts chasing once the blob gets this far past its start line. */
const CHOMP_TRIGGER = 8;
/** Entities further than this (plus their own reach) from the blob are skipped for the step. */
const CULL_TILES = 24;

/** A surface the body can land on from above: mover platforms and crusher tops. */
interface Plat { x0: number; x1: number; px0: number; px1: number; top0: number; top1: number }
interface Rect { l: number; r: number; t: number; b: number }
interface Circle { x: number; y: number; r: number }
/** Entity geometry for one step: at its start (t0) and end (t1). */
interface Ents { plats: Plat[]; solids: Rect[]; press: Rect[]; saws: Circle[] }
interface Ctx { level: Level; dyn: Dynamics | undefined; ents: Ents }

const NO_ENTS: Ents = { plats: [], solids: [], press: [], saws: [] };

/** Whether a tile blocks from every side. Crumbles block until they give way. */
function solidAt(ctx: Ctx, tx: number, ty: number): boolean {
  const t = tileAt(ctx.level, tx, ty);
  if (t === T_SOLID || t === T_SPRING || t === T_CONVEYOR_R || t === T_CONVEYOR_L) return true;
  return t === T_CRUMBLE && !(ctx.dyn && crumbleGone(ctx.dyn, ty * ctx.level.width + tx));
}

/** Inclusive tile range covered by the open interval (lo, hi). */
const span = (lo: number, hi: number): [number, number] => [Math.floor(lo + EPS), Math.floor(hi - EPS)];

/** The tile row a body centered at height `y` rests exactly on, or null if it is between rows. */
function floorRow(y: number): number | null {
  const bottom = y + PHYS.halfH;
  const ty = Math.round(bottom);
  return Math.abs(bottom - ty) > 1e-6 ? null : ty;
}

/** Whether any tile of `kind` lies in row `ty` under the body's width. */
function anyUnder(level: Level, b: Body, ty: number, kind: number): boolean {
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  for (let tx = tx0; tx <= tx1; tx++) if (tileAt(level, tx, ty) === kind) return true;
  return false;
}

/** Whether the body's bottom rests exactly on a solid or one-way tile top. */
function supported(level: Level, x: number, y: number): boolean {
  const ctx: Ctx = { level, dyn: undefined, ents: NO_ENTS };
  const ty = floorRow(y);
  if (ty === null) return false;
  const [tx0, tx1] = span(x - PHYS.halfW, x + PHYS.halfW);
  for (let tx = tx0; tx <= tx1; tx++) {
    if (solidAt(ctx, tx, ty) || tileAt(level, tx, ty) === T_ONEWAY) return true;
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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const overlapsX = (b: Body, l: number, r: number) => b.x + PHYS.halfW > l + ENT_EPS && b.x - PHYS.halfW < r - ENT_EPS;
const overlaps = (b: Body, q: Rect) =>
  overlapsX(b, q.l, q.r) && b.y + PHYS.halfH > q.t + ENT_EPS && b.y - PHYS.halfH < q.b - ENT_EPS;

/**
 * Advances the run clock one step and lays out the entities near the body for it.
 * Crushers are solid while waiting or rising and deadly (block and teeth) while slamming or holding;
 * their tops can be stood on in every state.
 */
function layOut(level: Level, dyn: Dynamics, bx: number): Ents {
  const t0 = dyn.t;
  dyn.t += DT;
  const t1 = dyn.t;
  const ents: Ents = { plats: [], solids: [], press: [], saws: [] };
  for (const e of level.entities) {
    if (e.kind === 'chomp') continue;
    const reach = e.kind === 'saw' ? e.r + Math.abs(e.dx) : e.w + (e.kind === 'mover' ? Math.abs(e.dx) : 0);
    if (Math.abs(e.x - bx) > CULL_TILES + reach) continue;
    const s1 = entityState(e, t1);
    if (s1.kind === 'saw') { ents.saws.push({ x: s1.x, y: s1.y, r: s1.r }); continue; }
    const s0 = entityState(e, t0) as Exclude<EntityState, { kind: 'saw' | 'chomp' }>;
    if (s1.kind === 'mover') {
      ents.plats.push({ x0: s1.x, x1: s1.x + s1.w, px0: s0.x, px1: s0.x + s0.w, top0: s0.y, top1: s1.y });
    } else if (s1.kind === 'crusher') {
      ents.plats.push({ x0: s1.x, x1: s1.x + s1.w, px0: s0.x, px1: s0.x + s0.w, top0: s0.y, top1: s1.y });
      const deadly = s1.moving === 'down' || s1.moving === 'hold';
      if (deadly) ents.press.push({ l: s1.x, r: s1.x + s1.w, t: s1.y, b: s1.y + s1.h + CRUSHER_TEETH });
      else ents.solids.push({ l: s1.x, r: s1.x + s1.w, t: s1.y, b: s1.y + s1.h });
    }
  }
  return ents;
}

/** Moves along x by `dx` and pushes out of solid tiles and solid entities. `vel`: stop on contact. */
function moveX(b: Body, ctx: Ctx, dx: number, vel: boolean): void {
  b.x += dx;
  const [ty0, ty1] = span(b.y - PHYS.halfH, b.y + PHYS.halfH);
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  if (dx > 0) {
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(ctx, tx, ty)) { b.x = tx - PHYS.halfW; if (vel) b.vx = 0; return; }
      }
    }
  } else if (dx < 0) {
    for (let tx = tx1; tx >= tx0; tx--) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (solidAt(ctx, tx, ty)) { b.x = tx + 1 + PHYS.halfW; if (vel) b.vx = 0; return; }
      }
    }
  }
  for (const q of ctx.ents.solids) {
    if (!overlaps(b, q)) continue;
    const toLeft = dx > 0 || (dx === 0 && b.x < (q.l + q.r) / 2);
    b.x = toLeft ? q.l - PHYS.halfW : q.r + PHYS.halfW;
    if (vel) b.vx = 0;
  }
}

const LAND_NONE = 0, LAND_TILE = 1, LAND_PLATFORM = 2;

/**
 * Moves along y by `dy`: lands on solid or one-way tile tops and on platform tops (from above
 * only, including a platform rising into the body), bumps solid ceilings. Returns how it landed.
 */
function moveY(b: Body, ctx: Ctx, dy: number): number {
  const prevBottom = b.y + PHYS.halfH;
  const prevTop = b.y - PHYS.halfH;
  b.y += dy;
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  const [ty0, ty1] = span(b.y - PHYS.halfH, b.y + PHYS.halfH);
  let land = Infinity;
  let how = LAND_NONE;
  if (dy > 0) {
    scan: for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (solidAt(ctx, tx, ty) || (tileAt(ctx.level, tx, ty) === T_ONEWAY && prevBottom <= ty + EPS)) {
          land = ty;
          how = LAND_TILE;
          break scan;
        }
      }
    }
  } else if (dy < 0) {
    for (let ty = ty1; ty >= ty0; ty--) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (solidAt(ctx, tx, ty)) return bump(b, ty + 1);
      }
    }
    for (const q of ctx.ents.solids) {
      if (overlaps(b, q) && prevTop >= q.b - ENT_EPS) return bump(b, q.b);
    }
  }
  const bottom = b.y + PHYS.halfH;
  for (const p of ctx.ents.plats) {
    if (p.top1 < land && overlapsX(b, p.x0, p.x1) && prevBottom <= Math.max(p.top0, p.top1) + ENT_EPS
      && bottom >= p.top1 && bottom <= p.top1 + MOVER_THICKNESS + ENT_EPS) {
      land = p.top1;
      how = LAND_PLATFORM;
    }
  }
  if (how !== LAND_NONE) b.y = land - PHYS.halfH;
  return how;
}

function bump(b: Body, ceiling: number): number {
  b.y = ceiling + PHYS.halfH;
  b.vy = Math.max(b.vy, 0);
  b.rising = false;
  return LAND_NONE;
}

/** A body standing on a platform at the start of the step rides along with it. */
function carry(b: Body, ctx: Ctx): void {
  if (!b.grounded) return;
  const bottom = b.y + PHYS.halfH;
  for (const p of ctx.ents.plats) {
    if (Math.abs(bottom - p.top0) <= ENT_EPS && overlapsX(b, p.px0, p.px1)) {
      moveX(b, ctx, p.x0 - p.px0, false);
      b.y += p.top1 - p.top0;
      return;
    }
  }
}

/** Extra target speed from conveyors the body stands on. */
function conveyorPush(level: Level, b: Body): number {
  if (!b.grounded) return 0;
  const ty = floorRow(b.y);
  if (ty === null) return 0;
  const r = anyUnder(level, b, ty, T_CONVEYOR_R) ? 1 : 0;
  const l = anyUnder(level, b, ty, T_CONVEYOR_L) ? 1 : 0;
  return (r - l) * PHYS.conveyorSpeed;
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

/** Deaths by moving hazards; also triggers the Big Chomp once the blob passes its line. */
function entityHit(b: Body, ctx: Ctx): Cause | null {
  for (const q of ctx.ents.press) if (overlaps(b, q)) return 'press';
  const l = b.x - PHYS.halfW, r = b.x + PHYS.halfW, top = b.y - PHYS.halfH, bottom = b.y + PHYS.halfH;
  for (const s of ctx.ents.saws) {
    const dx = s.x - clamp(s.x, l, r), dy = s.y - clamp(s.y, top, bottom);
    if (dx * dx + dy * dy < s.r * s.r) return 'saw';
  }
  const dyn = ctx.dyn!;
  for (const e of ctx.level.entities) {
    if (e.kind !== 'chomp') continue;
    if (dyn.chompStart === null && b.x >= e.x + CHOMP_TRIGGER) dyn.chompStart = dyn.t;
    // Only a triggered chomp bites, so the blob can pass its start line on the way in.
    if (dyn.chompStart !== null && l < entityState(e, dyn.t, dyn.chompStart).x) return 'chomp';
    break; // one Big Chomp per level
  }
  return null;
}

/**
 * Advances the body by exactly one `DT` under control `c`, mutating it.
 * With `dyn`, also advances the run clock (`dyn.t += DT`) and plays the time-based features:
 * crumbles give way, movers carry, crushers, saws and the Big Chomp kill. Without it, crumbles
 * never give way and entities are ignored.
 * Returns the cause of death if the body died this step, else null.
 */
export function stepBody(b: Body, c: Control, level: Level, dyn?: Dynamics): Cause | null {
  const ctx: Ctx = { level, dyn, ents: dyn ? layOut(level, dyn, b.x) : NO_ENTS };
  carry(b, ctx);

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
  b.vx = approach(b.vx, PHYS.runSpeed * c.move + conveyorPush(level, b), accel * DT);
  moveX(b, ctx, b.vx * DT, true);

  // Vertical: exact integration under constant gravity (average of old and new velocity).
  const vy0 = b.vy;
  const vy1 = Math.min(vy0 + PHYS.gravity * DT, PHYS.maxFall);
  b.vy = vy1;
  const wasGrounded = b.grounded;
  const how = moveY(b, ctx, ((vy0 + vy1) / 2) * DT);
  const landedNow = how !== LAND_NONE;
  b.landed = landedNow && !wasGrounded ? vy1 : 0;
  if (landedNow) b.vy = 0;
  b.grounded = landedNow;
  if (b.vy >= 0) b.rising = false;
  b.coyote = b.grounded ? PHYS.coyoteS : countDown(b.coyote);

  if (how === LAND_TILE) {
    const ty = Math.round(b.y + PHYS.halfH);
    if (dyn) markCrumbles(b, level, dyn, ty);
    if (anyUnder(level, b, ty, T_SPRING)) {
      // A spring always gives its full bounce: not a jump, so releasing jump can't cut it.
      b.vy = -PHYS.springVelocity;
      b.grounded = false;
      b.coyote = 0;
      b.rising = false;
    }
  }

  const spike = spikeHit(b, level);
  if (spike) return spike;
  if (dyn) {
    const hit = entityHit(b, ctx);
    if (hit) return hit;
  }
  // Kill while the blob is still visible in the pit, so the death freeze shows it.
  if (b.y > level.height - PIT_DEATH_ROWS) return 'pit';
  return null;
}

/** Starts the countdown on every crumble the body has just stood on (once per tile per run). */
function markCrumbles(b: Body, level: Level, dyn: Dynamics, ty: number): void {
  const [tx0, tx1] = span(b.x - PHYS.halfW, b.x + PHYS.halfW);
  for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * level.width + tx;
    if (tileAt(level, tx, ty) === T_CRUMBLE && !dyn.crumbles.has(idx)) dyn.crumbles.set(idx, dyn.t);
  }
}
