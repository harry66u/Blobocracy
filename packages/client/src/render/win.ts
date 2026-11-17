// The win (spec §6.7): the golden crown floating over the goal, its glow and light rays,
// the crown's flight onto the blob's head, fireworks across the sky, and the big
// "The internet did it!" card with the run's numbers and a slot for "Share the clip".
// Everything is a pure function of the win's age (plus deterministic particle state), so
// the live game and an exported clip draw the same celebration.
import type { Layout } from '../layout.ts';
import { FIREWORKS_FROM, WIN_BANNER_OUT, WIN_BANNER_IN, winBannerFrame, winLines } from '../moments.ts';
import { uiScale } from './hud.ts';
import { BLOB, BLOB_SHADE, CREAM, CREAM_HI, FONT_DISPLAY, FONT_TEXT, HAZARD, INK, ONLINE, SWEAT } from './palette.ts';
import type { SceneLevel, SceneWin, ShareSlot } from './scene.ts';
import { isFloorTile } from './tiles.ts';

export const GOLD = '#FFC72E';
export const GOLD_HI = '#FFE98A';
export const GOLD_SHADE = '#E59A00';

// ---- the crown ----------------------------------------------------------------------

/**
 * A cartoon crown centered on (cx, baseY = bottom of the band), `w` wide. Points end in
 * round balls (so it never reads as a spike), with gems on the band.
 */
export function drawCrown(g: CanvasRenderingContext2D, cx: number, baseY: number, w: number, opts: { line?: number; shine?: number } = {}): void {
  const h = w * 0.72;
  const band = h * 0.3;
  const lw = opts.line ?? Math.max(1.5, w * 0.065);
  const top = baseY - h;
  const x0 = cx - w / 2, x1 = cx + w / 2;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // body: band plus three points (outer two lean out a little)
  const p = new Path2D();
  p.moveTo(x0 + w * 0.04, baseY);
  p.lineTo(x0 - w * 0.02, top + h * 0.2);
  p.lineTo(x0 + w * 0.27, top + h * 0.48);
  p.lineTo(cx, top + h * 0.02);
  p.lineTo(x1 - w * 0.27, top + h * 0.48);
  p.lineTo(x1 + w * 0.02, top + h * 0.2);
  p.lineTo(x1 - w * 0.04, baseY);
  p.closePath();
  g.fillStyle = GOLD;
  g.fill(p);
  g.save();
  g.clip(p);
  g.fillStyle = GOLD_SHADE;
  g.fillRect(cx + w * 0.12, top, w, h); // right side in shade
  g.fillStyle = 'rgba(255,255,255,.5)';
  g.beginPath();
  g.ellipse(x0 + w * 0.22, top + h * 0.55, w * 0.06, h * 0.22, -0.35, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke(p);
  // band
  g.beginPath();
  g.roundRect(x0 + w * 0.02, baseY - band, w * 0.96, band, band * 0.35);
  g.fillStyle = GOLD_HI;
  g.fill();
  g.stroke();
  // gems on the band
  const gems: [number, string][] = [[-0.3, SWEAT], [0, '#FFFFFF'], [0.3, SWEAT]];
  for (const [k, c] of gems) {
    g.beginPath();
    g.ellipse(cx + k * w, baseY - band / 2, band * (k === 0 ? 0.3 : 0.24), band * (k === 0 ? 0.3 : 0.24), 0, 0, Math.PI * 2);
    g.fillStyle = c;
    g.fill();
    g.lineWidth = lw * 0.7;
    g.stroke();
  }
  // balls on the tips
  for (const [bx, by, r] of [[x0 - w * 0.02, top + h * 0.2, 0.085], [cx, top + h * 0.02, 0.1], [x1 + w * 0.02, top + h * 0.2, 0.085]] as const) {
    g.beginPath();
    g.arc(bx, by, w * r, 0, Math.PI * 2);
    g.fillStyle = GOLD_HI;
    g.fill();
    g.lineWidth = lw * 0.85;
    g.stroke();
  }
  const shine = opts.shine ?? 0;
  if (shine > 0.01) {
    // a glint sweeping across
    g.globalAlpha = shine;
    sparkle(g, cx - w * 0.18, top + h * 0.45, w * 0.16, lw * 0.6);
  }
  g.restore();
}

/** A four-point cartoon sparkle. */
export function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number, fill = '#FFFFFF'): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
  g.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  g.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
  g.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
}

/** Row whose top is the floor under the goal. */
export function goalFloorRow(level: SceneLevel, x: number): number {
  for (let ty = 2; ty < level.height; ty++) if (isFloorTile(level.tileAt(Math.floor(x), ty))) return ty;
  return level.height;
}

/** Where the floating crown sits: its center x and the bottom of its band (tiles). */
export function goalCrownSpot(level: SceneLevel, timeS: number): { x: number; base: number } | null {
  if (level.goalX === undefined) return null;
  const row = goalFloorRow(level, level.goalX);
  return { x: level.goalX, base: row - 2.15 + Math.sin(timeS * 2.1) * 0.12 };
}

/** Golden light rays turning slowly behind a point (screen px). */
export function drawRays(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, timeS: number, alpha: number, n = 14): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
  grad.addColorStop(0, 'rgba(255,240,170,.95)');
  grad.addColorStop(0.45, 'rgba(255,214,90,.45)');
  grad.addColorStop(1, 'rgba(255,214,90,0)');
  g.fillStyle = grad;
  g.beginPath();
  const rot = timeS * 0.35;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2, da = (Math.PI / n) * 0.55;
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, a - da, a + da);
    g.closePath();
  }
  g.fill();
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.42);
  core.addColorStop(0, 'rgba(255,250,215,.85)');
  core.addColorStop(1, 'rgba(255,240,170,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * The crown floating over the goal with a soft glow and twinkles, and a glowing disc on the
 * floor under it. `taken`: only the disc is left (the blob is wearing the crown).
 */
export function drawGoalCrown(
  g: CanvasRenderingContext2D, T: number, sx: (x: number) => number, sy: (y: number) => number,
  level: SceneLevel, timeS: number, viewW: number, o: { taken: boolean; glow: number },
): void {
  const spot = goalCrownSpot(level, timeS);
  if (!spot) return;
  const px = sx(spot.x);
  if (px < -T * 6 || px > viewW + T * 6) return;
  const floorY = sy(goalFloorRow(level, spot.x));
  g.save();
  // glowing disc on the floor
  const pulse = 0.5 + 0.5 * Math.sin(timeS * 3);
  const disc = g.createRadialGradient(px, floorY, 0, px, floorY, T * 1.6);
  disc.addColorStop(0, `rgba(255,226,120,${(0.75 + 0.2 * pulse).toFixed(3)})`);
  disc.addColorStop(1, 'rgba(255,226,120,0)');
  g.fillStyle = disc;
  g.beginPath();
  g.ellipse(px, floorY, T * 1.6, T * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  if (!o.taken) {
    const cy = sy(spot.base);
    // a soft column of light from the disc up to the crown
    const beam = g.createLinearGradient(0, floorY, 0, cy - T);
    beam.addColorStop(0, 'rgba(255,236,150,.55)');
    beam.addColorStop(1, 'rgba(255,236,150,0)');
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(px - T * 0.5, floorY);
    g.lineTo(px - T * 1.0, cy - T);
    g.lineTo(px + T * 1.0, cy - T);
    g.lineTo(px + T * 0.5, floorY);
    g.closePath();
    g.fill();
    drawRays(g, px, cy - T * 0.55, T * (2.2 + 1.8 * o.glow), timeS, 0.38 + 0.55 * o.glow, 12);
    const w = T * 1.9 * (1 + 0.1 * o.glow * Math.sin(timeS * 20));
    drawCrown(g, px, cy, w, { line: T * 0.1, shine: 0.5 + 0.5 * Math.sin(timeS * 2.6) });
    // twinkles around it
    for (let i = 0; i < 4; i++) {
      const ph = (timeS * 0.7 + i * 0.25) % 1;
      const a = i * 1.7 + 0.6;
      const k = Math.sin(ph * Math.PI);
      sparkle(g, px + Math.cos(a) * T * 1.45, cy - T * 0.7 + Math.sin(a) * T * 0.95, T * 0.2 * k, T * 0.05, i % 2 ? BLOB : '#FFFFFF');
    }
  }
  g.restore();
}

/** The crown arcing from its spot over the goal onto the blob's head; `k` 0..1 of the flight. */
export function drawFlyingCrown(
  g: CanvasRenderingContext2D, T: number, from: { x: number; y: number }, to: { x: number; y: number }, k: number,
): void {
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const x = from.x + (to.x - from.x) * e;
  const arc = Math.sin(Math.PI * e) * T * 2.4;
  const y = from.y + (to.y - from.y) * e - arc;
  const w = T * (1.9 + (1.05 - 1.9) * e);
  g.save();
  drawRays(g, x, y - w * 0.35, T * 1.6, k * 6, 0.6 * (1 - e * 0.6), 10);
  g.translate(x, y);
  g.rotate(Math.sin(e * Math.PI) * -0.6 + e * Math.PI * 2);
  drawCrown(g, 0, w * 0.36, w, { line: T * 0.09, shine: 1 });
  g.restore();
  // a little trail of sparkles behind it
  for (let i = 1; i <= 3; i++) {
    const kk = Math.max(0, e - i * 0.08);
    const tx = from.x + (to.x - from.x) * kk, ty = from.y + (to.y - from.y) * kk - Math.sin(Math.PI * kk) * T * 2.4;
    g.globalAlpha = 0.9 - i * 0.22;
    sparkle(g, tx, ty, T * 0.22 * (1 - i * 0.2), T * 0.04, i % 2 ? BLOB : '#FFFFFF');
  }
  g.globalAlpha = 1;
}

// ---- fireworks ------------------------------------------------------------------------

let L_PHONE = false;
const FW_COLORS = [BLOB, HAZARD, '#FFFFFF', SWEAT, ONLINE, '#B98CFF'] as const;
const MAX_SPARKS = 1100;
const MAX_ROCKETS = 16;
/** Rockets climb fast (px/s² at ui scale 1): about half a second to burst. */
const ROCKET_G = 2600;

/** Fireworks in screen space: rockets climb from the bottom and burst into chunky outlined sparks. */
export class Fireworks {
  private n = 0;
  private readonly x = new Float32Array(MAX_SPARKS);
  private readonly y = new Float32Array(MAX_SPARKS);
  private readonly vx = new Float32Array(MAX_SPARKS);
  private readonly vy = new Float32Array(MAX_SPARKS);
  private readonly life = new Float32Array(MAX_SPARKS);
  private readonly max = new Float32Array(MAX_SPARKS);
  private readonly size = new Float32Array(MAX_SPARKS);
  private readonly col = new Uint8Array(MAX_SPARKS);
  private readonly star = new Uint8Array(MAX_SPARKS);
  private rockets: { x: number; y: number; vx: number; vy: number; ty: number; col: number; t: number }[] = [];
  private flashes: { x: number; y: number; r: number; t: number; col: number }[] = [];
  private next = 0;
  private seed = 7;

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  /** Clear everything (a new celebration, or a seek in a clip). */
  reset(seed = 7): void {
    this.n = 0;
    this.rockets = [];
    this.flashes = [];
    this.next = 0;
    this.seed = seed;
  }

  get active(): boolean { return this.n > 0 || this.rockets.length > 0; }

  /** Launch whatever is due by celebration age `age`; `on` false stops new launches. */
  schedule(age: number, on: boolean, L: Layout): void {
    L_PHONE = L.phone;
    if (!on) { this.next = Math.max(this.next, age); return; }
    if (this.next === 0) {
      this.next = FIREWORKS_FROM;
      // the crown lands: two bursts right away, high on either side
      const s = uiScale(L);
      this.burst(L.w * 0.24, L.h * (L.phone ? 0.26 : 0.2), 1, s);
      this.burst(L.w * 0.76, L.h * (L.phone ? 0.2 : 0.16), 0, s);
    }
    while (this.next <= age) {
      // a finale-ish rhythm: quick volleys at the start, then a steady show
      const k = this.next;
      const volley = k < 3.2 ? 2 : 1;
      for (let v = 0; v < volley && this.rockets.length < MAX_ROCKETS; v++) this.launch(L);
      this.next += k < 3.2 ? 0.34 : 0.55 + this.rnd() * 0.35;
    }
  }

  private launch(L: Layout): void {
    const s = uiScale(L);
    const x = L.w * (0.1 + this.rnd() * 0.8);
    const ty = L.h * (L.phone ? 0.2 + this.rnd() * 0.3 : 0.12 + this.rnd() * 0.32);
    const y0 = L.h * 0.82;
    const vy = -Math.sqrt(2 * ROCKET_G * s * (y0 - ty)) * 0.96;
    this.rockets.push({ x, y: y0, vx: (L.w / 2 - x) * 0.04 + (this.rnd() - 0.5) * 40 * s, vy, ty, col: Math.floor(this.rnd() * FW_COLORS.length), t: 0 });
  }

  private burst(x: number, y: number, col: number, s: number): void {
    const count = 40 + Math.floor(this.rnd() * 20);
    const speed = (230 + this.rnd() * 160) * s * (L_PHONE ? 0.8 : 1);
    const two = this.rnd() < 0.45 ? (col + 1 + Math.floor(this.rnd() * 3)) % FW_COLORS.length : col;
    for (let i = 0; i < count; i++) {
      const j = this.n < MAX_SPARKS ? this.n++ : Math.floor(this.rnd() * MAX_SPARKS);
      const a = (i / count) * Math.PI * 2 + this.rnd() * 0.12;
      const sp = speed * (0.75 + this.rnd() * 0.3);
      this.x[j] = x; this.y[j] = y;
      this.vx[j] = Math.cos(a) * sp;
      this.vy[j] = Math.sin(a) * sp;
      this.max[j] = this.life[j] = 1.1 + this.rnd() * 0.6;
      this.size[j] = (3.8 + this.rnd() * 2.6) * s;
      this.col[j] = i % 2 ? col : two;
      this.star[j] = i % 5 === 0 ? 1 : 0;
    }
    this.flashes.push({ x, y, r: speed * 0.35, t: 0, col });
  }

  update(dt: number, L: Layout): void {
    const s = uiScale(L);
    const grav = ROCKET_G * s;
    for (const r of this.rockets) {
      r.t += dt;
      r.vy += grav * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }
    const keep: typeof this.rockets = [];
    for (const r of this.rockets) {
      if (r.vy >= -40 * s || r.y <= r.ty) this.burst(r.x, r.y, r.col, s);
      else keep.push(r);
    }
    this.rockets = keep;
    for (const f of this.flashes) f.t += dt;
    this.flashes = this.flashes.filter((f) => f.t < 0.35);
    let w = 0;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.n; i++) {
      this.life[i]! -= dt;
      this.vx[i]! *= drag;
      this.vy[i] = this.vy[i]! * drag + 160 * s * dt;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      if (this.life[i]! <= 0) continue;
      if (w !== i) {
        this.x[w] = this.x[i]!; this.y[w] = this.y[i]!; this.vx[w] = this.vx[i]!; this.vy[w] = this.vy[i]!;
        this.life[w] = this.life[i]!; this.max[w] = this.max[i]!; this.size[w] = this.size[i]!; this.col[w] = this.col[i]!; this.star[w] = this.star[i]!;
      }
      w++;
    }
    this.n = w;
  }

  draw(g: CanvasRenderingContext2D, L: Layout): void {
    const s = uiScale(L);
    g.save();
    g.lineCap = 'round';
    // rockets: a bright head and a fading tail
    for (const r of this.rockets) {
      const len = 0.06;
      g.strokeStyle = 'rgba(255,240,200,.7)';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.moveTo(r.x, r.y);
      g.lineTo(r.x - r.vx * len, r.y - r.vy * len);
      g.stroke();
      g.beginPath();
      g.arc(r.x, r.y, 4 * s, 0, Math.PI * 2);
      g.fillStyle = FW_COLORS[r.col]!;
      g.fill();
      g.lineWidth = 2 * s;
      g.strokeStyle = INK;
      g.stroke();
    }
    for (const f of this.flashes) {
      const k = f.t / 0.35;
      g.globalAlpha = (1 - k) * 0.55;
      g.beginPath();
      g.arc(f.x, f.y, f.r * (0.4 + k * 0.8), 0, Math.PI * 2);
      g.fillStyle = '#FFF6D0';
      g.fill();
    }
    g.lineWidth = 1.6 * s;
    g.strokeStyle = INK;
    for (let i = 0; i < this.n; i++) {
      const k = this.life[i]! / this.max[i]!;
      g.globalAlpha = Math.min(1, k * 2.2);
      const sz = this.size[i]! * (0.55 + 0.45 * k);
      const x = this.x[i]!, y = this.y[i]!;
      // a short streak along the motion, then the chunky spark
      g.strokeStyle = FW_COLORS[this.col[i]!]!;
      g.lineWidth = sz * 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - this.vx[i]! * 0.035, y - this.vy[i]! * 0.035);
      g.stroke();
      g.lineWidth = 1.6 * s;
      g.strokeStyle = INK;
      if (this.star[i]) sparkle(g, x, y, sz * 1.5, 1.4 * s, FW_COLORS[this.col[i]!]!);
      else {
        g.beginPath();
        g.arc(x, y, sz, 0, Math.PI * 2);
        g.fillStyle = FW_COLORS[this.col[i]!]!;
        g.fill();
        g.stroke();
      }
    }
    g.restore();
  }
}

// ---- the win card ---------------------------------------------------------------------

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * "The internet did it!": drops in a couple of seconds after the touch, stays for the
 * celebration, and lifts away before the level-up. Returns where "Share the clip" goes.
 */
export function drawWinCard(g: CanvasRenderingContext2D, L: Layout, win: SceneWin, reduced: boolean, celebrateS: number, avoidY = Infinity): ShareSlot | null {
  const age = win.age - WIN_BANNER_IN;
  if (age < 0 || win.age >= WIN_BANNER_OUT) return null;
  const f = winBannerFrame(age, reduced);
  if (f.alpha <= 0.01) return null;
  const words = winLines(win, { name: win.name, next: win.next, encore: win.encore });
  const s0 = uiScale(L);
  const s = s0 * (L.phone ? 0.98 : 1.18);
  const cw = Math.min(L.phone ? L.w - 28 : 470 * s, L.w - 28);
  const pad = 22 * s;
  g.font = `${(44 * s).toFixed(1)}px ${FONT_DISPLAY}`;
  const titleSize = 44 * s * Math.min(1, (cw - 2 * pad - 8 * s) / (g.measureText(words.title).width * 1.06));
  const lineFont = `800 ${(17 * s).toFixed(1)}px ${FONT_TEXT}`;
  const statBig = `${(L.phone ? 21 : 24) * s}px ${FONT_DISPLAY}`;
  const statSmall = `700 ${(12 * s).toFixed(1)}px ${FONT_TEXT}`;
  const slotH = win.clip ? 58 * s : 0;
  const stickerH = 34 * s;
  const ch = 26 * s + titleSize * 1.1 + 30 * s + 74 * s + slotH + 40 * s;
  // below the death counter, so its celebratory wave stays in view
  const cy0 = L.phone ? 166 * s0 : 182 * s0;
  const mid = L.w / 2;
  const offY = f.y * (cy0 + ch + 40);
  const left = celebrateS - win.age;
  // keep the crowned blob in view: shrink the card (from its top) to end above `avoidY`
  const fit = L.phone ? Math.max(0.7, Math.min(1, (avoidY - 10 * s0 - cy0) / (ch + 7 * s))) : 1;
  const mid0 = cy0 + ch / 2; // the card's center as drawn, before fitting
  const ccy = cy0 + (ch * fit) / 2; // and on screen

  let slot: ShareSlot | null = null;
  if (win.clip) {
    const slotY = cy0 + 26 * s + titleSize * 1.1 + 30 * s + 74 * s + slotH / 2 + 4 * s;
    const dy = (slotY - mid0) * fit * f.scale;
    slot = {
      x: mid - dy * Math.sin(f.rot), y: ccy + offY + dy * Math.cos(f.rot),
      w: Math.min(220 * s, cw - 40 * s) * fit, h: 46 * s * fit, rotDeg: (f.rot * 180) / Math.PI, alpha: f.alpha, scale: s * fit,
    };
  }

  g.save();
  g.globalAlpha = f.alpha;
  g.translate(mid, ccy + offY);
  g.rotate(f.rot);
  g.scale(f.scale * fit, f.scale * fit);
  g.translate(-mid, -mid0);
  const x0 = mid - cw / 2;
  g.lineJoin = 'round';
  // shadow, card, a band of gold across the top
  g.fillStyle = INK;
  g.beginPath();
  g.roundRect(x0, cy0 + 7 * s, cw, ch, 26 * s);
  g.fill();
  g.beginPath();
  g.roundRect(x0, cy0, cw, ch, 26 * s);
  g.fillStyle = CREAM;
  g.fill();
  g.save();
  g.clip();
  const band = g.createLinearGradient(0, cy0, 0, cy0 + 26 * s + titleSize * 1.25);
  band.addColorStop(0, GOLD_HI);
  band.addColorStop(1, CREAM);
  g.fillStyle = band;
  g.fillRect(x0, cy0, cw, 26 * s + titleSize * 1.25);
  // confetti flecks printed on the card
  for (let i = 0; i < 16; i++) {
    const fx = x0 + ((i * 97.3) % 100) / 100 * cw, fy = cy0 + ((i * 53.7) % 100) / 100 * ch;
    if (Math.abs(fx - mid) < cw * 0.36 && fy > cy0 + 18 * s) continue;
    g.fillStyle = [HAZARD, SWEAT, ONLINE, BLOB][i % 4]!;
    g.save();
    g.translate(fx, fy);
    g.rotate(i);
    g.fillRect(-4 * s, -2 * s, 8 * s, 4 * s);
    g.restore();
  }
  g.restore();
  g.beginPath();
  g.roundRect(x0, cy0, cw, ch, 26 * s);
  g.lineWidth = 4 * s;
  g.strokeStyle = INK;
  g.stroke();

  // the title: big, yellow, outlined (like the death card's percentage)
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  let y = cy0 + 26 * s + titleSize * 0.95;
  g.font = `${titleSize.toFixed(1)}px ${FONT_DISPLAY}`;
  const spaced = 'letterSpacing' in g;
  if (spaced) (g as unknown as { letterSpacing: string }).letterSpacing = `${(titleSize * 0.035).toFixed(1)}px`;
  g.lineWidth = Math.max(4, titleSize * 0.15);
  g.strokeStyle = INK;
  g.strokeText(words.title, mid, y);
  g.fillStyle = BLOB;
  g.fillText(words.title, mid, y);
  if (spaced) (g as unknown as { letterSpacing: string }).letterSpacing = '0px';
  y += 30 * s;
  g.font = lineFont;
  g.fillStyle = INK;
  g.fillText(fitText(g, words.line, cw - 2 * pad), mid, y);

  // three stat chips
  y += 14 * s;
  const gap = 8 * s;
  const chipW = (cw - 2 * pad - 2 * gap) / 3, chipH = 62 * s;
  words.stats.forEach((st, i) => {
    const cx = x0 + pad + i * (chipW + gap);
    g.beginPath();
    g.roundRect(cx, y, chipW, chipH, 14 * s);
    g.fillStyle = i === 0 ? GOLD_HI : CREAM_HI;
    g.fill();
    g.lineWidth = 2.5 * s;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = INK;
    g.font = statBig;
    let big = st.big;
    if (g.measureText(big).width > chipW - 10 * s) {
      g.font = `${((L.phone ? 21 : 24) * s * (chipW - 10 * s) / g.measureText(big).width).toFixed(1)}px ${FONT_DISPLAY}`;
    }
    g.fillText(big, cx + chipW / 2, y + 30 * s);
    g.font = statSmall;
    g.fillStyle = 'rgba(42,27,61,.75)';
    big = fitText(g, st.small, chipW - 8 * s);
    g.fillText(big, cx + chipW / 2, y + 49 * s);
  });
  y += chipH + slotH;

  // footer: what happens next, counting down
  const footY = y + 28 * s;
  g.strokeStyle = 'rgba(42,27,61,.18)';
  g.lineWidth = 2 * s;
  g.setLineDash([2 * s, 5 * s]);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0 + 26 * s, footY - 20 * s);
  g.lineTo(x0 + cw - 26 * s, footY - 20 * s);
  g.stroke();
  g.setLineDash([]);
  g.font = `700 ${(14 * s).toFixed(1)}px ${FONT_TEXT}`;
  g.fillStyle = 'rgba(42,27,61,.8)';
  g.fillText(words.next(left), mid, footY);

  // the sticker on the corner: "Level 1 · beaten!"
  const label = win.encore ? 'Encore beaten!' : `Level ${win.levelId} beaten!`;
  const stickerFont = `${(16 * s).toFixed(1)}px ${FONT_DISPLAY}`;
  g.font = stickerFont;
  const sw = g.measureText(label).width + 26 * s;
  const pop = reduced ? 1 : Math.min(1, Math.max(0, (age - 0.35) / 0.25));
  if (pop > 0) {
    const k = reduced ? 1 : 1 + 2.6 * Math.pow(pop - 1, 3) + 1.6 * Math.pow(pop - 1, 2);
    g.save();
    g.translate(x0 + 18 * s + sw / 2, cy0 - 2 * s);
    g.rotate(-0.12);
    g.scale(k, k);
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(-sw / 2, -stickerH / 2 + 3.5 * s, sw, stickerH, stickerH / 2);
    g.fill();
    g.beginPath();
    g.roundRect(-sw / 2, -stickerH / 2, sw, stickerH, stickerH / 2);
    g.fillStyle = HAZARD;
    g.fill();
    g.lineWidth = 3 * s;
    g.stroke();
    g.fillStyle = CREAM_HI;
    g.textBaseline = 'middle';
    g.fillText(label, 0, 1.5 * s);
    g.restore();
  }
  // a crown medal on the other corner
  const mk = reduced ? 1 : Math.min(1, Math.max(0, (age - 0.5) / 0.3));
  if (mk > 0) {
    const k = reduced ? 1 : 1 + 2.6 * Math.pow(mk - 1, 3) + 1.6 * Math.pow(mk - 1, 2);
    const mx = x0 + cw - 30 * s, my = cy0 + 2 * s, r = 30 * s;
    g.save();
    g.translate(mx, my);
    g.rotate(0.14);
    g.scale(k, k);
    g.fillStyle = INK;
    g.beginPath();
    g.arc(0, 3.5 * s, r, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = BLOB;
    g.fill();
    g.lineWidth = 3 * s;
    g.strokeStyle = INK;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.76, 0, Math.PI * 2);
    g.fillStyle = BLOB_SHADE;
    g.fill();
    drawCrown(g, 0, r * 0.38, r * 1.15, { line: 2.4 * s, shine: 0.6 });
    g.restore();
  }
  g.restore();
  return slot;
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** A warm golden flash and soft vignette of light at the touch. */
export function drawWinFlash(g: CanvasRenderingContext2D, L: Layout, flash: number, cx: number, cy: number): void {
  if (flash <= 0.004) return;
  const r = Math.hypot(L.w, L.h);
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.7);
  gr.addColorStop(0, `rgba(255,250,220,${Math.min(1, flash * 1.4).toFixed(3)})`);
  gr.addColorStop(0.5, `rgba(255,226,120,${(flash * 0.7).toFixed(3)})`);
  gr.addColorStop(1, `rgba(255,200,80,${(flash * 0.3).toFixed(3)})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, L.w, L.h);
}

