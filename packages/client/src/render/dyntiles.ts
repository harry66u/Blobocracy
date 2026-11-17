// Tiles that animate or vanish, drawn every frame on top of the cached level chunks:
// crumble blocks (cracked bricks that shake, then burst into falling chunks), springs
// (a coil under a yellow pad that squashes and boings) and conveyor belts (chevrons
// rolling the way the belt pushes). All drawing is in tile units (the caller sets the
// transform), with the same thick plum outlines and cream surfaces as the ground.
import { CRUMBLE_SHAKE_S, crumbleTouchedAt, HALF_H } from './danger.ts';
import { hash2 } from './level.ts';
import { CREAM, CREAM_HI, CREAM_SHADE, INK } from './palette.ts';
import type { SceneBlob, SceneCrumble, SceneLevel } from './scene.ts';
import { TILE_CONVEYOR_L, TILE_CONVEYOR_R, TILE_CRUMBLE, TILE_SPRING } from './tiles.ts';

/** How long the broken pieces of a crumble tile keep falling. */
export const CRUMBLE_FALL_S = 1.1;
const SPRING_PAD = '#FFC93C';
const SPRING_PAD_SHADE = '#F29E00';
const COIL = '#E4DDF0';

export interface ViewRect { x0: number; y0: number; x1: number; y1: number }
export interface BeltRun { x0: number; x1: number; y: number; dir: 1 | -1 }

/** Where the dynamic tiles of a level are, scanned once per level. */
export interface DynamicIndex {
  /** Flat [x, y, x, y, ...] lists, sorted by x. */
  crumble: number[];
  spring: number[];
  belts: BeltRun[];
}

export function indexDynamicTiles(level: SceneLevel): DynamicIndex {
  const crumble: number[] = [], spring: number[] = [], belts: BeltRun[] = [];
  const open = new Map<number, BeltRun>(); // per row, the belt being extended
  for (let x = 0; x < level.width; x++) {
    for (let y = 0; y < level.height; y++) {
      const t = level.tileAt(x, y);
      if (t === TILE_CRUMBLE) crumble.push(x, y);
      else if (t === TILE_SPRING) spring.push(x, y);
      const dir = t === TILE_CONVEYOR_R ? 1 : t === TILE_CONVEYOR_L ? -1 : 0;
      const run = open.get(y);
      if (dir !== 0 && run && run.x1 === x && run.dir === dir) run.x1 = x + 1;
      else if (dir !== 0) {
        const r: BeltRun = { x0: x, x1: x + 1, y, dir: dir as 1 | -1 };
        belts.push(r);
        open.set(y, r);
      }
    }
  }
  return { crumble, spring, belts };
}

/** Per-level animation state for the dynamic tiles. */
export class DynamicTiles {
  private level: SceneLevel | null = null;
  private index: DynamicIndex = { crumble: [], spring: [], belts: [] };
  private readonly springLaunch = new Map<number, number>();

  draw(ctx: CanvasRenderingContext2D, level: SceneLevel, view: ViewRect, blob: SceneBlob | null, runTime: number, crumbles: readonly SceneCrumble[], timeS: number): void {
    if (level !== this.level) {
      this.level = level;
      this.index = indexDynamicTiles(level);
      this.springLaunch.clear();
    }
    const { crumble, spring, belts } = this.index;
    const vx0 = view.x0 - 2, vx1 = view.x1 + 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const r of belts) {
      if (r.x1 < vx0 || r.x0 > vx1) continue;
      drawBelt(ctx, r, timeS);
    }
    for (let i = 0; i < spring.length; i += 2) {
      const x = spring[i]!, y = spring[i + 1]!;
      if (x < vx0 || x > vx1) continue;
      drawSpring(ctx, x, y, this.springSquash(x + y * level.width, x, y, blob, timeS));
    }
    for (let i = 0; i < crumble.length; i += 2) {
      const x = crumble[i]!, y = crumble[i + 1]!;
      if (x < vx0 - 2 || x > vx1) continue;
      const at = crumbleTouchedAt(crumbles, x, y);
      drawCrumble(ctx, x, y, at === null ? -1 : runTime - at);
    }
  }

  /** -1.6 (coil stretched after a launch) .. 0 (rest) .. 1 (pad squashed under a landing blob). */
  private springSquash(key: number, x: number, y: number, b: SceneBlob | null, timeS: number): number {
    let squash = 0;
    if (b && !b.dead) {
      const dx = Math.abs(b.x - (x + 0.5));
      const feet = b.y + HALF_H;
      if (dx < 1.05) {
        const last = this.springLaunch.get(key) ?? -10;
        if (b.vy < -9 && feet < y + 0.15 && feet > y - 2.5 && timeS - last > 0.6) this.springLaunch.set(key, timeS);
        if (b.vy >= 0 && feet <= y + 0.1 && feet > y - 1) squash = Math.max(0, 1 - (y - feet)) * (b.grounded ? 0.7 : 0.55);
      }
    }
    const a = timeS - (this.springLaunch.get(key) ?? -10);
    if (a < 0.9) {
      const boing = Math.exp(-a * 4.5) * Math.cos(a * 17);
      squash = boing > 0 ? Math.max(squash, boing) : boing * 1.6;
    }
    return squash;
  }
}

// ---- crumble --------------------------------------------------------------------

/** The crack network of one tile: a center point and where each crack meets the edges (top, right, bottom, left). */
function crackPoints(x: number, y: number): number[] {
  const h = (s: number) => hash2(x, y, s);
  const cx = x + 0.38 + h(1) * 0.24, cy = y + 0.36 + h(2) * 0.26;
  return [cx, cy, x + 0.22 + h(3) * 0.5, y, x + 1, y + 0.25 + h(4) * 0.5, x + 0.25 + h(5) * 0.5, y + 1, x, y + 0.25 + h(6) * 0.5];
}

function brickBody(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.roundRect(x + 0.045, y + 0.03, 0.91, 0.94, 0.17);
}

function drawCrumble(ctx: CanvasRenderingContext2D, x: number, y: number, age: number): void {
  if (age >= CRUMBLE_SHAKE_S + CRUMBLE_FALL_S) return;
  if (age >= CRUMBLE_SHAKE_S) {
    drawCrumbleBreak(ctx, x, y, age - CRUMBLE_SHAKE_S);
    return;
  }
  const k = age < 0 ? 0 : age / CRUMBLE_SHAKE_S; // 0 untouched .. 1 about to break
  ctx.save();
  if (age >= 0) {
    const amp = 0.035 + 0.06 * k;
    ctx.translate(x + 0.5 + Math.sin(age * 95 + x) * amp, y + 0.5 + Math.abs(Math.cos(age * 70)) * 0.03 * k);
    ctx.rotate(Math.sin(age * 63 + y) * 0.06 * k);
    ctx.translate(-x - 0.5, -y - 0.5);
  }
  brickBody(ctx, x, y);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = CREAM_SHADE;
  ctx.fillRect(x, y + 0.64, 1, 0.4);
  ctx.fillStyle = CREAM_HI;
  ctx.beginPath();
  ctx.roundRect(x + 0.2, y + 0.12, 0.6, 0.09, 0.045);
  ctx.fill();
  // cracks: a wedge-shaped split from the top plus thinner branches; they open up while shaking
  const p = crackPoints(x, y);
  const cx = p[0]!, cy = p[1]!;
  const open = 0.035 + 0.05 * k;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(p[2]! - open * 1.4, y - 0.05);
  ctx.lineTo(cx - 0.05 - open, cy - 0.12);
  ctx.lineTo(cx, cy + open * 0.6);
  ctx.lineTo(cx + 0.05 + open * 0.3, cy - 0.14);
  ctx.lineTo(p[2]! + open * 1.4, y - 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.05 + 0.03 * k;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo((cx + p[4]!) / 2 + 0.04, (cy + p[5]!) / 2 - 0.07);
  ctx.lineTo(p[4]! - 0.12, p[5]!);
  ctx.moveTo(cx, cy);
  ctx.lineTo((cx + p[6]!) / 2 - 0.06, (cy + p[7]!) / 2);
  ctx.lineTo(p[6]! + 0.02 * k, p[7]! - 0.2 + 0.2 * k);
  if (k > 0.25) {
    ctx.moveTo(cx, cy);
    ctx.lineTo((cx + p[8]!) / 2, (cy + p[9]!) / 2 + 0.05);
    ctx.lineTo(p[8]!, p[9]!);
  }
  ctx.stroke();
  // a chipped notch on one bottom corner
  ctx.fillStyle = CREAM_SHADE;
  const nx = hash2(x, y, 9) < 0.5 ? x + 0.2 : x + 0.62;
  ctx.beginPath();
  ctx.ellipse(nx + 0.09, y + 0.82, 0.07, 0.045, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  brickBody(ctx, x, y);
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  // grit trickling out underneath while it shakes
  if (age >= 0) {
    ctx.fillStyle = CREAM_SHADE;
    for (let i = 0; i < 5; i++) {
      const ph = (age * 2.6 + i / 5 + hash2(x, i, 3)) % 1;
      const gx = x + 0.15 + 0.7 * hash2(x, y, 20 + i);
      const gy = y + 1.02 + ph * ph * 1.2;
      ctx.globalAlpha = 1 - ph;
      ctx.beginPath();
      ctx.arc(gx, gy, 0.045 + 0.03 * hash2(y, i, 5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawCrumbleBreak(ctx: CanvasRenderingContext2D, x: number, y: number, a: number): void {
  const p = crackPoints(x, y);
  const cx = p[0]!, cy = p[1]!;
  // four chunks split along the cracks: (corner, edge point, center, previous edge point)
  const corners = [x, y, x + 1, y, x + 1, y + 1, x, y + 1];
  const fade = 1 - Math.max(0, (a - CRUMBLE_FALL_S + 0.35) / 0.35);
  for (let i = 0; i < 4; i++) {
    const ex0 = p[2 + i * 2]!, ey0 = p[3 + i * 2]!;
    const j = (i + 1) % 4;
    const ex1 = p[2 + j * 2]!, ey1 = p[3 + j * 2]!;
    const kx = corners[j * 2]!, ky = corners[j * 2 + 1]!;
    // centroid of the chunk, so it spins about itself
    const mx = (ex0 + kx + ex1 + cx) / 4, my = (ey0 + ky + ey1 + cy) / 4;
    const hv = hash2(x * 7 + i, y, 31);
    const vx = (mx - (x + 0.5)) * 3.2 + (hv - 0.5) * 0.8;
    const vy = -1.6 - hash2(x, y * 3 + i, 33) * 1.8;
    const ox = vx * a, oy = vy * a + 0.5 * 30 * a * a;
    const rot = (hv - 0.5) * 9 * a + (mx < x + 0.5 ? -1 : 1) * 2.5 * a;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(mx + ox, my + oy);
    ctx.rotate(rot);
    ctx.translate(-mx, -my);
    const shrink = 0.92;
    const P = (px: number, py: number) => [mx + (px - mx) * shrink, my + (py - my) * shrink] as const;
    ctx.beginPath();
    ctx.moveTo(...P(ex0, ey0));
    ctx.lineTo(...P(kx, ky));
    ctx.lineTo(...P(ex1, ey1));
    ctx.lineTo(...P(cx, cy));
    ctx.closePath();
    ctx.fillStyle = ky > y + 0.5 ? CREAM_SHADE : CREAM;
    ctx.fill();
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.restore();
  }
  // a puff of dust where it stood
  if (a < 0.6) {
    const k = a / 0.6;
    ctx.lineWidth = 0.04;
    ctx.strokeStyle = INK;
    ctx.fillStyle = CREAM_HI;
    ctx.globalAlpha = Math.min(1, (1 - k) * 1.8);
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI * (0.05 + 0.9 * (i / 5)) + (hash2(x, i, 41) - 0.5) * 0.3;
      const d = 0.25 + k * (1.1 + hash2(y, i, 43) * 0.5);
      const px = x + 0.5 + Math.cos(ang) * d;
      const py = y + 0.75 - Math.sin(ang) * d * 0.45 - k * 0.25;
      const r = (0.1 + 0.09 * hash2(x, y + i, 47)) * (1 - k * 0.5);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ---- spring --------------------------------------------------------------------

function drawSpring(ctx: CanvasRenderingContext2D, x: number, y: number, squash: number): void {
  const baseTop = y + 0.7;
  const padH = 0.28;
  const padTop = y - 0.12 + (squash > 0 ? squash * 0.3 : squash * 0.45);
  const coilTop = padTop + padH - 0.04, coilBot = baseTop + 0.06;
  // coil: an ink zigzag with a light core
  const turns = 3;
  const pts: number[] = [];
  for (let i = 0; i <= turns * 2; i++) {
    const yy = coilTop + ((coilBot - coilTop) * i) / (turns * 2);
    const xx = i === 0 || i === turns * 2 ? x + 0.5 : i % 2 ? x + 0.12 : x + 0.88;
    pts.push(xx, yy);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.24;
  ctx.stroke();
  ctx.strokeStyle = COIL;
  ctx.lineWidth = 0.11;
  ctx.stroke();
  // base: a squat cream block with an up arrow
  ctx.beginPath();
  ctx.roundRect(x + 0.07, baseTop, 0.86, 1 - (baseTop - y) - 0.01, 0.1);
  ctx.fillStyle = CREAM_SHADE;
  ctx.fill();
  ctx.lineWidth = 0.09;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // pad
  ctx.beginPath();
  ctx.roundRect(x - 0.02, padTop, 1.04, padH, 0.12);
  ctx.fillStyle = SPRING_PAD;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = SPRING_PAD_SHADE;
  ctx.fillRect(x - 0.1, padTop + padH * 0.62, 1.2, padH);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath();
  ctx.roundRect(x + 0.14, padTop + 0.06, 0.42, 0.065, 0.03);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(x - 0.02, padTop, 1.04, padH, 0.12);
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // chevron on the base so it reads as "up" without color
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(x + 0.36, baseTop + 0.22);
  ctx.lineTo(x + 0.5, baseTop + 0.1);
  ctx.lineTo(x + 0.64, baseTop + 0.22);
  ctx.stroke();
}

// ---- conveyor -----------------------------------------------------------------

const BELT_SPEED = 1.4; // tiles/s, visual only

function drawBelt(ctx: CanvasRenderingContext2D, r: BeltRun, timeS: number): void {
  const { x0, x1, y, dir } = r;
  const w = x1 - x0;
  const shift = timeS * BELT_SPEED * dir;
  const body = () => { ctx.beginPath(); ctx.roundRect(x0 + 0.03, y + 0.04, w - 0.06, 0.92, 0.3); };
  body();
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = CREAM_SHADE;
  ctx.fillRect(x0, y + 0.74, w, 0.3);
  // treads along the top surface, moving with the belt
  ctx.strokeStyle = 'rgba(42,27,61,.38)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  const gap = 0.32;
  for (let k = Math.floor((x0 - shift) / gap) - 1; k * gap + shift < x1 + 0.5; k++) {
    const tx = k * gap + shift;
    ctx.moveTo(tx, y + 0.1);
    ctx.lineTo(tx + 0.05 * dir, y + 0.19);
  }
  ctx.stroke();
  ctx.restore();
  // track window with chevrons rolling the push direction
  const tx0 = x0 + 0.16, tw = w - 0.32, ty0 = y + 0.27, th = 0.44;
  ctx.beginPath();
  ctx.roundRect(tx0, ty0, tw, th, th / 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (w >= 2) {
    ctx.beginPath();
    ctx.rect(x0 + 0.66, y, w - 1.32, 1);
    ctx.clip();
  }
  ctx.strokeStyle = CREAM_HI;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  const step = 0.62;
  const mid = ty0 + th / 2;
  for (let k = Math.floor((tx0 - shift) / step) - 1; k * step + shift < tx0 + tw + 0.5; k++) {
    const cx = k * step + shift;
    ctx.moveTo(cx - 0.1 * dir, mid - 0.13);
    ctx.lineTo(cx + 0.1 * dir, mid);
    ctx.lineTo(cx - 0.1 * dir, mid + 0.13);
  }
  ctx.stroke();
  ctx.restore();
  // rollers at both ends
  if (w >= 2) {
    const spin = (timeS * BELT_SPEED * dir) / 0.2;
    for (const rx of [x0 + 0.42, x1 - 0.42]) {
      ctx.beginPath();
      ctx.arc(rx, mid, 0.19, 0, Math.PI * 2);
      ctx.fillStyle = CREAM_SHADE;
      ctx.fill();
      ctx.lineWidth = 0.06;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      for (let s = 0; s < 3; s++) {
        const an = spin + (s * Math.PI * 2) / 3;
        ctx.moveTo(rx, mid);
        ctx.lineTo(rx + Math.cos(an) * 0.13, mid + Math.sin(an) * 0.13);
      }
      ctx.stroke();
    }
  }
  body();
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
