// The crowd: every dot is one sampled player. Each slot has a stable home offset around
// the blob that depends on what that player is pressing (left-pushers settle on the
// left, right-pushers on the right, jumpers higher), eases toward it, and leans with a
// tail toward its input so the swarm visibly fights over left versus right.
import { BLOB, CREAM_HI, DOT, FONT_TEXT, INK } from './palette.ts';
import type { SceneDot } from './scene.ts';

const SLOTS = 256;
const OWN = SLOTS; // extra index for the local player's dot
const N = SLOTS + 1;
/** At most this many names are drawn at once (the nearest dots first), so the crowd never turns into a wall of text. */
const MAX_LABELS = 12;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DotHome { dx: number; dy: number }

/** Home offset (tiles, relative to the blob center) for a dot given its stable gaussians and input. */
export function homeOffset(g1: number, g2: number, dir: -1 | 0 | 1, jump: boolean, dead: boolean, out: DotHome): DotHome {
  let dx: number, dy: number;
  if (dir !== 0) {
    dx = g1 * 1.05 + (dir > 0 ? 2.2 : -2.3);
    dy = g2 * 0.95 - 0.35 - (jump ? 0.7 : 0);
  } else if (jump) {
    dx = g1 * 1.05;
    dy = g2 * 0.95 - 0.35 - 1.9;
  } else {
    dx = g1 * 1.5;
    dy = g2 * 0.7 - 0.55;
  }
  if (dead) { dx *= 1.5; dy = dy * 0.6 + 0.6; }
  const dist = Math.hypot(dx, dy * 1.2);
  if (dist < 1.55) {
    // keep clear of the blob, spread over a band rather than piling on one circle
    const k = (1.55 + dist * 0.45) / Math.max(dist, 0.01);
    dx *= k;
    dy *= k;
  }
  out.dx = dx;
  out.dy = dy;
  return out;
}

export class CrowdView {
  private readonly g1 = new Float32Array(N);
  private readonly g2 = new Float32Array(N);
  private readonly phase = new Float32Array(N);
  private readonly ox = new Float32Array(N);
  private readonly oy = new Float32Array(N);
  private readonly lx = new Float32Array(N); // eased lean direction
  private readonly ly = new Float32Array(N);
  private readonly tail = new Float32Array(N); // eased tail length factor
  private readonly alpha = new Float32Array(N);
  private readonly names: (string | undefined)[] = new Array(N).fill(undefined);
  private readonly seen = new Uint32Array(N);
  private readonly sx = new Float32Array(N); // screen positions for this frame
  private readonly sy = new Float32Array(N);
  private readonly active = new Int16Array(SLOTS);
  private nActive = 0;
  private frame = 1;
  private readonly home: DotHome = { dx: 0, dy: 0 };

  constructor() {
    const r = rng(4242);
    const gauss = () => {
      let u = 0, v = 0;
      while (!u) u = r();
      while (!v) v = r();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    for (let i = 0; i < N; i++) {
      this.g1[i] = Math.max(-2.2, Math.min(2.2, gauss()));
      this.g2[i] = Math.max(-2.2, Math.min(2.2, gauss()));
      this.phase[i] = r() * Math.PI * 2;
    }
    // own dot: a fixed, visible spot just outside the crowd's inner ring
    this.g1[OWN] = 0.65;
    this.g2[OWN] = -0.35;
  }

  update(dots: readonly SceneDot[], you: { dir: -1 | 0 | 1; jump: boolean; name?: string } | null, dead: boolean, dt: number, timeS: number): void {
    const prev = this.frame;
    this.names.fill(undefined);
    this.frame++;
    this.nActive = 0;
    const kPos = 1 - Math.exp(-dt * 3.2);
    const kLean = 1 - Math.exp(-dt * 10);
    const fade = dt * 4;
    for (let j = 0; j < dots.length; j++) {
      const d = dots[j]!;
      const i = ((d.slot % SLOTS) + SLOTS) % SLOTS;
      this.step(i, d.dir, d.jump, dead, this.seen[i] !== prev, kPos, kLean, fade, timeS);
      this.seen[i] = this.frame;
      this.names[i] = d.name;
      if (this.nActive < SLOTS) this.active[this.nActive++] = i;
    }
    if (you) {
      this.step(OWN, you.dir, you.jump, dead, this.seen[OWN] !== prev, kPos, kLean, fade, timeS);
      this.seen[OWN] = this.frame;
      this.names[OWN] = you.name;
    }
  }

  private step(i: number, dir: -1 | 0 | 1, jump: boolean, dead: boolean, fresh: boolean, kPos: number, kLean: number, fade: number, timeS: number): void {
    const h = homeOffset(this.g1[i]!, this.g2[i]!, dir, jump, dead, this.home);
    const ph = this.phase[i]!;
    const wx = h.dx + Math.sin(timeS * 1.3 + ph) * 0.14;
    const wy = h.dy + Math.cos(timeS * 1.7 + ph * 1.3) * 0.12;
    let vx = dir, vy = jump ? (dir !== 0 ? -0.7 : -1) : 0.1;
    const len = Math.hypot(vx, vy);
    vx /= len; vy /= len;
    const tl = dir === 0 && !jump ? 0.25 : 1;
    if (fresh) {
      this.ox[i] = wx; this.oy[i] = wy; this.lx[i] = vx; this.ly[i] = vy; this.tail[i] = tl; this.alpha[i] = 0;
      return;
    }
    this.ox[i]! += (wx - this.ox[i]!) * kPos;
    this.oy[i]! += (wy - this.oy[i]!) * kPos;
    this.lx[i]! += (vx - this.lx[i]!) * kLean;
    this.ly[i]! += (vy - this.ly[i]!) * kLean;
    this.tail[i]! += (tl - this.tail[i]!) * kLean;
    this.alpha[i] = Math.min(1, this.alpha[i]! + fade);
  }

  /** Draw all sampled dots (batched: tails, bodies, outlines). */
  draw(ctx: CanvasRenderingContext2D, T: number, phone: boolean, bx: number, by: number, h: number): void {
    const rr = 0.12 * T * (phone ? 1.25 : 1);
    const tailLen = rr * 3.4;
    for (let j = 0; j < this.nActive; j++) {
      const i = this.active[j]!;
      this.sx[i] = bx + this.ox[i]! * T;
      this.sy[i] = by + this.oy[i]! * T;
    }
    // tails
    ctx.fillStyle = DOT;
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    for (let j = 0; j < this.nActive; j++) {
      const i = this.active[j]!;
      if (this.alpha[i]! < 0.5) continue;
      this.tailPath(ctx, i, rr, tailLen);
    }
    ctx.fill();
    // bodies (new dots fade in separately)
    ctx.globalAlpha = 1;
    ctx.beginPath();
    let fading = 0;
    for (let j = 0; j < this.nActive; j++) {
      const i = this.active[j]!;
      const y = this.sy[i]!;
      if (y < -rr * 4 || y > h + rr * 4) continue;
      if (this.alpha[i]! < 1) { fading++; continue; }
      this.bodyPath(ctx, i, rr);
    }
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, T * 0.022);
    ctx.stroke();
    if (fading) {
      for (let j = 0; j < this.nActive; j++) {
        const i = this.active[j]!;
        const a = this.alpha[i]!;
        if (a >= 1) continue;
        ctx.beginPath();
        this.bodyPath(ctx, i, rr);
        ctx.globalAlpha = a;
        ctx.fill();
        ctx.globalAlpha = a * 0.45;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.drawNames(ctx, T, phone, bx, by, h, rr);
  }

  /** Names of the nearest named dots, small and outlined so they read over anything; labels never overlap. */
  private drawNames(ctx: CanvasRenderingContext2D, T: number, phone: boolean, bx: number, by: number, h: number, rr: number): void {
    const named: number[] = [];
    for (let j = 0; j < this.nActive; j++) {
      const i = this.active[j]!;
      if (this.names[i] && this.alpha[i]! >= 1 && this.sy[i]! > 0 && this.sy[i]! < h) named.push(i);
    }
    if (named.length === 0) return;
    named.sort((a, b) => Math.hypot(this.sx[a]! - bx, this.sy[a]! - by) - Math.hypot(this.sx[b]! - bx, this.sy[b]! - by));
    const fs = phone ? 11 : 12.5;
    ctx.font = `700 ${fs}px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    const placed: [number, number, number, number][] = [];
    for (const i of named) {
      if (placed.length >= MAX_LABELS) break;
      const name = this.names[i]!;
      const w = ctx.measureText(name).width;
      const x = this.sx[i]!, y = this.sy[i]! - rr * 1.7;
      const box: [number, number, number, number] = [x - w / 2 - 2, y - fs, w + 4, fs + 4];
      if (placed.some((p) => box[0] < p[0] + p[2] && box[0] + box[2] > p[0] && box[1] < p[1] + p[3] && box[1] + box[3] > p[1])) continue;
      placed.push(box);
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = CREAM_HI;
      ctx.strokeText(name, x, y);
      ctx.fillStyle = INK;
      ctx.fillText(name, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private tailPath(ctx: CanvasRenderingContext2D, i: number, rr: number, tailLen: number): void {
    let vx = this.lx[i]!, vy = this.ly[i]!;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len; vy /= len;
    const x = this.sx[i]!, y = this.sy[i]!;
    const tl = tailLen * this.tail[i]!;
    const px = -vy, py = vx;
    ctx.moveTo(x + px * rr * 0.85, y + py * rr * 0.85);
    ctx.lineTo(x - vx * tl, y - vy * tl);
    ctx.lineTo(x - px * rr * 0.85, y - py * rr * 0.85);
    ctx.closePath();
  }

  private bodyPath(ctx: CanvasRenderingContext2D, i: number, rr: number): void {
    const x = this.sx[i]!, y = this.sy[i]!;
    const lean = (this.lx[i]! * 22 * Math.PI) / 180 * (Math.abs(this.ly[i]!) > 0.9 ? 0 : 1);
    const rx = rr * 0.92, ry = rr * 1.08;
    ctx.moveTo(x + rx * Math.cos(lean), y + rx * Math.sin(lean));
    ctx.ellipse(x, y, rx, ry, lean, 0, Math.PI * 2);
  }

  /** The local player's dot: yellow, ringed, with a "you" tag. Kept on screen. */
  drawOwn(ctx: CanvasRenderingContext2D, T: number, phone: boolean, bx: number, by: number, w: number, h: number): void {
    const i = OWN;
    const rr = 0.19 * T * (phone ? 1.25 : 1);
    const ring = rr * 2.1;
    const fs = phone ? 12 : 14;
    const label = this.names[OWN] ?? 'you';
    ctx.font = `800 ${fs}px ${FONT_TEXT}`;
    const pillW = Math.max(fs * 2.3, ctx.measureText(label).width + fs * 1.2), pillH = fs * 1.45;
    let x = bx + this.ox[i]! * T, y = by + this.oy[i]! * T;
    x = Math.max(ring + 6, Math.min(w - ring - pillW - 12, x));
    y = Math.max(ring + pillH + 6, Math.min(h - ring - 6, y));
    this.sx[i] = x;
    this.sy[i] = y;
    const a = this.alpha[i]!;
    ctx.globalAlpha = 0.5 * a;
    ctx.fillStyle = DOT;
    ctx.beginPath();
    this.tailPath(ctx, i, rr, rr * 3.0);
    ctx.fill();
    ctx.globalAlpha = a;
    ctx.beginPath();
    this.bodyPath(ctx, i, rr);
    ctx.fillStyle = BLOB;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, ring, 0, Math.PI * 2);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, ring + 2.4, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
    const lx = x + ring + 6, ly = y - ring - 2;
    ctx.beginPath();
    ctx.roundRect(lx, ly - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = BLOB;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `800 ${fs}px ${FONT_TEXT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, lx + pillW / 2, ly + fs * 0.36);
    ctx.globalAlpha = 1;
  }
}
