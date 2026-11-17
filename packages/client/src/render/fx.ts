// Screen effects for the big moments: the new-zone banner, confetti, the death flash and
// vignette, the reduced-motion cover fade, and the record flag standing in the world.
import type { Layout } from '../layout.ts';
import { bannerFrame } from '../moments.ts';
import { uiScale } from './hud.ts';
import { BLOB, CREAM, CREAM_HI, CREAM_SHADE, FONT_DISPLAY, HAZARD, INK } from './palette.ts';
import type { SceneBanner, SceneFx, SceneLevel } from './scene.ts';
import { isFloorTile, TILE_CEIL_SPIKE, TILE_SPIKE } from './tiles.ts';

// ---- record flag --------------------------------------------------------------------

/**
 * Row whose top the record flag stands on at world x: the highest floor in that column
 * with headroom above it (skipping the tops of hanging spike blocks), or the level's
 * bottom over a pit.
 */
export function flagGroundRow(level: SceneLevel, x: number): number {
  const tx = Math.floor(x);
  for (let ty = 2; ty < level.height; ty++) {
    const t = level.tileAt(tx, ty);
    if (!isFloorTile(t)) continue;
    const above1 = level.tileAt(tx, ty - 1), above2 = level.tileAt(tx, ty - 2);
    if (isFloorTile(above1) || above1 === TILE_SPIKE || isFloorTile(above2)) continue;
    // a hanging block with ceiling spikes under it is a ceiling, not a floor
    let hanging = false;
    for (let k = 1; k <= 3; k++) if (level.tileAt(tx, ty + k) === TILE_CEIL_SPIKE) hanging = true;
    if (hanging) continue;
    return ty;
  }
  return level.height + 2;
}

/** The record flag in the world: a pole with a waving pink pennant showing the record. */
export function drawRecordFlag(
  g: CanvasRenderingContext2D, T: number, sx: (x: number) => number, sy: (y: number) => number,
  level: SceneLevel, x: number, label: string, timeS: number, viewW: number,
): void {
  const px = sx(x);
  if (px < -T * 3 || px > viewW + T) return;
  const row = flagGroundRow(level, x);
  const baseY = sy(row);
  const poleH = T * 3.1;
  const topY = baseY - poleH;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // little cream footing
  g.beginPath();
  g.ellipse(px, baseY - T * 0.04, T * 0.34, T * 0.13, 0, Math.PI, 0);
  g.closePath();
  g.fillStyle = CREAM;
  g.fill();
  g.lineWidth = T * 0.07;
  g.strokeStyle = INK;
  g.stroke();
  // pole
  g.beginPath();
  g.roundRect(px - T * 0.07, topY, T * 0.14, poleH, T * 0.07);
  g.fillStyle = CREAM_HI;
  g.fill();
  g.lineWidth = T * 0.07;
  g.stroke();
  // pennant, waving
  const fw = T * 1.75, fh = T * 1.05;
  const N = 10;
  const wave = (k: number) => Math.sin(timeS * 5 - k * 3.2) * T * 0.09 * k;
  const flag = new Path2D();
  flag.moveTo(px + T * 0.05, topY + T * 0.08);
  for (let i = 1; i <= N; i++) {
    const k = i / N;
    flag.lineTo(px + T * 0.05 + fw * k, topY + T * 0.08 + fh * 0.5 * k * 0.92 + wave(k));
  }
  for (let i = N; i >= 0; i--) {
    const k = i / N;
    flag.lineTo(px + T * 0.05 + fw * k, topY + T * 0.08 + fh - fh * 0.5 * k * 0.92 + wave(k) - (i === N ? 0 : 0));
  }
  flag.closePath();
  g.fillStyle = HAZARD;
  g.fill(flag);
  g.save();
  g.clip(flag);
  g.fillStyle = 'rgba(255,255,255,.22)';
  g.fillRect(px, topY, fw + T * 0.2, fh * 0.28);
  g.restore();
  g.lineWidth = T * 0.075;
  g.strokeStyle = INK;
  g.stroke(flag);
  // the record, written on the flag
  g.font = `${(T * 0.36).toFixed(1)}px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = CREAM_HI;
  g.fillText(label, px + T * 0.05 + fw * 0.36, topY + T * 0.08 + fh * 0.5 + wave(0.36));
  // knob on top
  g.beginPath();
  g.arc(px, topY - T * 0.05, T * 0.14, 0, Math.PI * 2);
  g.fillStyle = BLOB;
  g.fill();
  g.lineWidth = T * 0.06;
  g.stroke();
  g.restore();
}

// ---- overlays -----------------------------------------------------------------------

/** Flash, vignette and cover fade, drawn over the world and under the HUD. */
export function drawOverlays(g: CanvasRenderingContext2D, L: Layout, fx: SceneFx): void {
  if (fx.vignette > 0.004) {
    const r0 = Math.min(L.w, L.h) * 0.3, r1 = Math.hypot(L.w, L.h) * 0.62;
    const gr = g.createRadialGradient(L.w / 2, L.h * 0.52, r0, L.w / 2, L.h * 0.52, r1);
    gr.addColorStop(0, 'rgba(42,27,61,0)');
    gr.addColorStop(1, `rgba(42,27,61,${(0.62 * fx.vignette).toFixed(3)})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, L.w, L.h);
  }
  if (fx.flash > 0.004) {
    g.fillStyle = `rgba(255,251,241,${fx.flash.toFixed(3)})`;
    g.fillRect(0, 0, L.w, L.h);
  }
  if (fx.fade > 0.004) {
    g.fillStyle = `rgba(255,241,214,${Math.min(1, fx.fade).toFixed(3)})`;
    g.fillRect(0, 0, L.w, L.h);
  }
}

// ---- zone banner --------------------------------------------------------------------

/** Where the banner rests (center y, CSS px) and how tall it is. */
export function bannerBox(L: Layout): { cy: number; h: number } {
  const s = uiScale(L);
  return L.phone ? { cy: 196 * s, h: 96 * s } : { cy: 226 * s, h: 118 * s };
}

/**
 * "Zone 3" on a pink sticker over a cream ribbon reading "The Grinder", dropping in from
 * the top with a playful tilt and bounce. Fades back if the blob climbs up under it.
 */
export function drawBanner(g: CanvasRenderingContext2D, L: Layout, b: SceneBanner, reduced: boolean, blobTopY: number): void {
  const f = bannerFrame(b.age, reduced);
  if (!f.visible) return;
  const s = uiScale(L);
  const box = bannerBox(L);
  const nameSize = (L.phone ? 34 : 50) * s;
  let font = `${nameSize.toFixed(1)}px ${FONT_DISPLAY}`;
  g.font = font;
  let tw = g.measureText(b.name).width;
  const maxW = L.w - (L.phone ? 96 : 200) * s;
  let size = nameSize;
  if (tw > maxW) {
    size = nameSize * (maxW / tw);
    font = `${size.toFixed(1)}px ${FONT_DISPLAY}`;
    g.font = font;
    tw = g.measureText(b.name).width;
  }
  const rw = tw + 64 * s, rh = size * 1.45;
  const tail = 26 * s;
  const cx = L.w / 2;
  const cy = box.cy + f.y * (box.cy + box.h);
  // stay out of the blob's way
  const bottom = cy + rh / 2 + 6 * s;
  const clear = blobTopY - bottom;
  const dodge = clear < 0 ? 0.25 : clear < 30 * s ? 0.25 + 0.75 * (clear / (30 * s)) : 1;

  g.save();
  g.globalAlpha = f.alpha * dodge;
  g.translate(cx, cy);
  g.rotate(-0.045 + f.rot);
  g.scale(f.scale, 2 - f.scale);
  g.lineJoin = 'round';

  // ribbon tails (behind), folded down at both ends
  for (const d of [-1, 1]) {
    const x0 = d * (rw / 2 - 8 * s), x1 = d * (rw / 2 + tail);
    const yt = -rh * 0.18, yb = rh * 0.5 + 10 * s;
    const p = new Path2D();
    p.moveTo(x0, yt);
    p.lineTo(x1, yt);
    p.lineTo(x1 - d * tail * 0.45, (yt + yb) / 2);
    p.lineTo(x1, yb);
    p.lineTo(x0, yb);
    p.closePath();
    g.fillStyle = INK;
    g.save();
    g.translate(0, 5 * s);
    g.fill(p);
    g.restore();
    g.fillStyle = CREAM_SHADE;
    g.fill(p);
    g.lineWidth = 3.5 * s;
    g.strokeStyle = INK;
    g.stroke(p);
  }
  // ribbon body
  g.fillStyle = INK;
  g.beginPath();
  g.roundRect(-rw / 2, -rh / 2 + 6 * s, rw, rh, 16 * s);
  g.fill();
  g.beginPath();
  g.roundRect(-rw / 2, -rh / 2, rw, rh, 16 * s);
  g.fillStyle = CREAM;
  g.fill();
  g.lineWidth = 3.5 * s;
  g.strokeStyle = INK;
  g.stroke();
  // a soft band of highlight
  g.save();
  g.clip();
  g.fillStyle = CREAM_HI;
  g.fillRect(-rw / 2, -rh / 2, rw, rh * 0.3);
  g.restore();
  g.beginPath();
  g.roundRect(-rw / 2, -rh / 2, rw, rh, 16 * s);
  g.stroke();
  // the zone name
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = INK;
  g.fillText(b.name, 0, size * 0.06);

  // "Zone 3" sticker over the top-left corner, tilted the other way
  const label = `Zone ${b.index + 1}`;
  const lf = `${((L.phone ? 15 : 18) * s).toFixed(1)}px ${FONT_DISPLAY}`;
  g.font = lf;
  const lw = g.measureText(label).width + 26 * s, lh = (L.phone ? 27 : 32) * s;
  const pop = reduced ? 1 : Math.min(1, Math.max(0, (b.age - 0.3) / 0.22));
  if (pop > 0) {
    const k = reduced ? 1 : 1 + 2.6 * Math.pow(pop - 1, 3) + 1.6 * Math.pow(pop - 1, 2);
    g.save();
    g.translate(-rw / 2 + lw * 0.42, -rh / 2 - 2 * s);
    g.rotate(0.13);
    g.scale(k, k);
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(-lw / 2, -lh / 2 + 3.5 * s, lw, lh, lh / 2);
    g.fill();
    g.beginPath();
    g.roundRect(-lw / 2, -lh / 2, lw, lh, lh / 2);
    g.fillStyle = HAZARD;
    g.fill();
    g.lineWidth = 3 * s;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = CREAM_HI;
    g.fillText(label, 0, 1.5 * s);
    g.restore();
  }
  g.restore();
}

// ---- confetti -----------------------------------------------------------------------

const COLORS = ['#FFFFFF', BLOB, HAZARD] as const;
const MAX = 160;

/** Confetti in screen space: bursts from the top edge (zones) or from a point (records). */
export class Confetti {
  private n = 0;
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vy = new Float32Array(MAX);
  private readonly rot = new Float32Array(MAX);
  private readonly vr = new Float32Array(MAX);
  private readonly ph = new Float32Array(MAX);
  private readonly vph = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly kind = new Uint8Array(MAX);
  private readonly color = new Uint8Array(MAX);
  private readonly life = new Float32Array(MAX);
  private seed = 1;
  private gentle = false;

  private rnd(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  private add(x: number, y: number, vx: number, vy: number, size: number): void {
    const i = this.n < MAX ? this.n++ : Math.floor(this.rnd() * MAX);
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.rot[i] = this.rnd() * Math.PI * 2;
    this.vr[i] = (this.rnd() - 0.5) * 9;
    this.ph[i] = this.rnd() * Math.PI * 2;
    this.vph[i] = 5 + this.rnd() * 9;
    this.size[i] = size * (0.75 + this.rnd() * 0.5);
    this.kind[i] = Math.floor(this.rnd() * 3);
    this.color[i] = Math.floor(this.rnd() * 3);
    this.life[i] = 4.5;
  }

  /** A shower from the whole top edge. */
  burstTop(L: Layout, reduced: boolean, seed: number): void {
    this.seed = 1 + (seed * 7919) % 2147483646;
    this.gentle = reduced;
    const s = uiScale(L);
    const count = reduced ? 16 : L.phone ? 70 : 130;
    for (let k = 0; k < count; k++) {
      const x = this.rnd() * L.w;
      const fromMid = (x - L.w / 2) / (L.w / 2);
      this.add(x, -10 - this.rnd() * 60 * s, fromMid * 60 * s + (this.rnd() - 0.5) * 140 * s, reduced ? 40 * s : (60 + this.rnd() * 300) * s, 9 * s);
    }
  }

  /** A little pop of confetti from a point (e.g. the record text). */
  burstAt(x: number, y: number, s: number, reduced: boolean, seed: number): void {
    this.seed = 1 + (seed * 104729) % 2147483646;
    const count = reduced ? 8 : 28;
    for (let k = 0; k < count; k++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * Math.PI * 1.4;
      const sp = (reduced ? 60 : 160 + this.rnd() * 260) * s;
      this.add(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 7 * s);
    }
  }

  get active(): boolean {
    return this.n > 0;
  }

  update(dt: number, h: number): void {
    const g = this.gentle ? 90 : 520;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i]! -= dt;
      this.vx[i]! *= Math.exp(-dt * 1.6);
      this.vy[i] = Math.min(this.vy[i]! + g * dt, this.gentle ? 70 : 230 + this.size[i]! * 6);
      this.x[i]! += (this.vx[i]! + (this.gentle ? 0 : Math.sin(this.ph[i]!) * 26)) * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.vr[i]! * dt * (this.gentle ? 0.2 : 1);
      this.ph[i]! += this.vph[i]! * dt * (this.gentle ? 0.15 : 1);
      if (this.life[i]! <= 0 || this.y[i]! > h + 30) continue;
      if (w !== i) this.copy(i, w);
      w++;
    }
    this.n = w;
  }

  private copy(from: number, to: number): void {
    for (const a of [this.x, this.y, this.vx, this.vy, this.rot, this.vr, this.ph, this.vph, this.size, this.life]) a[to] = a[from]!;
    this.kind[to] = this.kind[from]!;
    this.color[to] = this.color[from]!;
  }

  draw(g: CanvasRenderingContext2D, s: number): void {
    if (!this.n) return;
    g.save();
    g.lineWidth = 1.6 * s;
    g.strokeStyle = INK;
    g.lineJoin = 'round';
    for (let i = 0; i < this.n; i++) {
      const sz = this.size[i]!;
      const flip = this.gentle ? 1 : Math.cos(this.ph[i]!);
      g.globalAlpha = Math.min(1, this.life[i]! / 0.6);
      g.save();
      g.translate(this.x[i]!, this.y[i]!);
      g.rotate(this.rot[i]!);
      g.scale(Math.abs(flip) < 0.15 ? 0.15 * Math.sign(flip || 1) : flip, 1);
      g.fillStyle = COLORS[this.color[i]!]!;
      g.beginPath();
      if (this.kind[i] === 0) g.roundRect(-sz * 0.6, -sz * 0.32, sz * 1.2, sz * 0.64, sz * 0.12);
      else if (this.kind[i] === 1) g.arc(0, 0, sz * 0.42, 0, Math.PI * 2);
      else { g.moveTo(0, -sz * 0.55); g.lineTo(sz * 0.5, sz * 0.4); g.lineTo(-sz * 0.5, sz * 0.4); g.closePath(); }
      g.fill();
      g.stroke();
      g.restore();
    }
    g.restore();
  }
}

