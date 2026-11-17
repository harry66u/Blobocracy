// The blob: body, shade, highlight, big eyes that look toward the crowd's pull, a calm
// face normally, effort face during a tug of war, panic face (worried brows, "o" mouth,
// sweat, alarm lines) when a hazard or gap is close ahead, sleeping when paused, and a
// flattened pancake with X eyes when dead. Also owns jump/landing dust and the arc trail.
import { BLOB, BLOB_SHADE, CREAM, CREAM_HI, INK, SWEAT } from './palette.ts';
import { TILE_CEIL_SPIKE, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE, type SceneBlob, type SceneLevel } from './scene.ts';

/** Hitbox half height in tiles (hitbox is 1.1 × 1.2). */
export const HALF_H = 0.6;

/** True when a spike, ceiling spike or bottomless gap is within 3 tiles ahead of the direction of travel. */
export function dangerAhead(level: SceneLevel, b: Pick<SceneBlob, 'x' | 'y' | 'vx' | 'facing'>): boolean {
  const dir = Math.abs(b.vx) > 0.5 ? Math.sign(b.vx) : b.facing;
  const feet = b.y + HALF_H;
  const r0 = Math.floor(b.y - 1.8), r1 = Math.floor(feet + 0.5);
  const c0 = Math.floor(b.x), c1 = Math.floor(b.x + dir * 3.55);
  const step = dir > 0 ? 1 : -1;
  for (let cx = c0; step > 0 ? cx <= c1 : cx >= c1; cx += step) {
    if (cx < 0 || cx >= level.width) continue;
    for (let ry = r0; ry <= r1; ry++) {
      if (ry < 0 || ry >= level.height) continue;
      const t = level.tileAt(cx, ry);
      if (t === TILE_SPIKE || t === TILE_CEIL_SPIKE) return true;
    }
    // a gap: nothing to stand on anywhere below the feet in this column
    let floor = false;
    for (let ry = Math.max(0, Math.floor(feet - 0.3)); ry < level.height; ry++) {
      const t = level.tileAt(cx, ry);
      if (t === TILE_SOLID || t === TILE_ONEWAY) { floor = true; break; }
    }
    if (!floor) return true;
  }
  return false;
}

const N_PARTICLES = 48;
const TRAIL = 12;

/** Per-blob animation state that persists between frames. */
export class BlobView {
  private prevGrounded = true;
  private prevVy = 0;
  private landT = -10;
  private landAmp = 0;
  private deadT = -10;
  private wasDead = false;
  private blinkNext = 2;
  private blinkT = -10;
  private dangerLevel = 0; // eased 0..1 so the face doesn't flicker
  private pullEased = 0;
  private tiltEased = 0;
  // dust particles (world tiles)
  private readonly px = new Float32Array(N_PARTICLES);
  private readonly py = new Float32Array(N_PARTICLES);
  private readonly pvx = new Float32Array(N_PARTICLES);
  private readonly pvy = new Float32Array(N_PARTICLES);
  private readonly plife = new Float32Array(N_PARTICLES);
  private readonly pmax = new Float32Array(N_PARTICLES);
  private readonly pr = new Float32Array(N_PARTICLES);
  private pNext = 0;
  // jump arc trail (world tiles)
  private readonly tx = new Float32Array(TRAIL);
  private readonly ty = new Float32Array(TRAIL);
  private readonly tage = new Float32Array(TRAIL).fill(99);
  private tNext = 0;
  private tAcc = 0;

  update(b: SceneBlob, level: SceneLevel, dt: number, timeS: number): void {
    const feet = b.y + HALF_H;
    if (b.dead && !this.wasDead) this.deadT = timeS;
    this.wasDead = b.dead;
    if (!b.dead) {
      if (this.prevGrounded && !b.grounded && b.vy < -2) this.puff(b.x, feet, 7, 1);
      if (!this.prevGrounded && b.grounded) {
        const impact = Math.min(1, Math.max(0, this.prevVy) / 20);
        if (impact > 0.15) {
          this.landT = timeS;
          this.landAmp = impact;
          this.puff(b.x, feet, Math.round(3 + impact * 5), 0.7);
        }
      }
    }
    this.prevGrounded = b.grounded;
    this.prevVy = b.vy;

    const target = !b.dead && dangerAhead(level, b) ? 1 : 0;
    this.dangerLevel += (target - this.dangerLevel) * (1 - Math.exp(-dt * (target ? 14 : 4)));
    this.pullEased += (b.pull - this.pullEased) * (1 - Math.exp(-dt * 10));
    const tilt = b.dead ? 0 : Math.max(-1, Math.min(1, b.pull * 0.8 + b.vx / 30));
    this.tiltEased += (tilt - this.tiltEased) * (1 - Math.exp(-dt * 8));

    if (timeS > this.blinkNext) {
      this.blinkT = timeS;
      this.blinkNext = timeS + 2.2 + ((Math.sin(timeS * 12.9898) * 43758.5453) % 1 + 1) % 1 * 3;
    }

    for (let i = 0; i < N_PARTICLES; i++) {
      if (this.plife[i]! <= 0) continue;
      this.plife[i]! -= dt;
      this.px[i]! += this.pvx[i]! * dt;
      this.py[i]! += this.pvy[i]! * dt;
      this.pvx[i]! *= Math.exp(-dt * 5);
      this.pvy[i]! = this.pvy[i]! * Math.exp(-dt * 5) - dt * 0.6;
    }

    // trail: sample the path every 40 ms while airborne
    for (let i = 0; i < TRAIL; i++) this.tage[i]! += dt;
    this.tAcc += dt;
    if (!b.grounded && !b.dead && this.tAcc > 0.04) {
      this.tAcc = 0;
      this.tx[this.tNext] = b.x;
      this.ty[this.tNext] = b.y;
      this.tage[this.tNext] = 0;
      this.tNext = (this.tNext + 1) % TRAIL;
    }
  }

  private puff(x: number, y: number, n: number, k: number): void {
    for (let j = 0; j < n; j++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % N_PARTICLES;
      const a = (j / Math.max(1, n - 1)) * Math.PI;
      this.px[i] = x + (Math.cos(a) * 0.5) * k;
      this.py[i] = y - 0.05;
      this.pvx[i] = Math.cos(a) * (1.4 + (j % 3) * 0.5) * k;
      this.pvy[i] = -0.3 - (j % 2) * 0.4;
      this.pmax[i] = this.plife[i] = 0.35 + (j % 3) * 0.08;
      this.pr[i] = (0.09 + (j % 4) * 0.035) * (0.7 + k * 0.4);
    }
  }

  /** Dust and trail, drawn behind the blob. */
  drawBehind(ctx: CanvasRenderingContext2D, T: number, sx: (x: number) => number, sy: (y: number) => number): void {
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < TRAIL; i++) {
      const age = this.tage[i]!;
      if (age > 0.45) continue;
      const k = 1 - age / 0.45;
      ctx.globalAlpha = 0.12 + k * 0.45;
      ctx.beginPath();
      ctx.arc(sx(this.tx[i]!), sy(this.ty[i]! + 0.3), T * 0.045 * (0.5 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, T * 0.04);
    ctx.strokeStyle = INK;
    for (let i = 0; i < N_PARTICLES; i++) {
      const l = this.plife[i]!;
      if (l <= 0) continue;
      const k = l / this.pmax[i]!;
      const r = this.pr[i]! * T * (0.6 + 0.4 * k);
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.beginPath();
      ctx.arc(sx(this.px[i]!), sy(this.py[i]!) - r * 0.6, r, 0, Math.PI * 2);
      ctx.fillStyle = CREAM_HI;
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D, T: number, cx: number, feetY: number, b: SceneBlob, paused: boolean, timeS: number): void {
    if (b.dead) {
      this.drawDead(ctx, T, cx, feetY, timeS);
      return;
    }
    const r = T * 0.8;
    const danger = this.dangerLevel;
    const strain = b.strain;
    let kx = 1, ky = 1;
    if (!b.grounded) {
      const s = Math.min(1, Math.abs(b.vy) / 18);
      ky = 1 + 0.16 * s;
      kx = 1 - 0.14 * s;
    } else {
      const breathe = Math.sin(timeS * (paused ? 1.6 : 2.6)) * (paused ? 0.03 : 0.018);
      ky += breathe;
      kx -= breathe * 0.6;
    }
    const lt = timeS - this.landT;
    if (lt < 0.45) {
      const e = Math.exp(-lt * 9) * Math.cos(lt * 22) * this.landAmp;
      ky -= 0.24 * e;
      kx += 0.2 * e;
    }
    if (strain > 0.01 && b.grounded) {
      kx += 0.06 * strain;
      ky -= 0.05 * strain;
    }
    const bw = r * kx, bh = r * ky;
    const tremble = strain > 0.3 ? Math.sin(timeS * 70) * T * 0.02 * strain : 0;
    const tilt = this.tiltEased * 0.15; // radians, ~8.5° at full pull

    ctx.save();
    ctx.translate(cx + tremble, feetY);
    ctx.rotate(tilt);
    ctx.translate(0, -bh);

    // body: slightly pear-shaped
    const body = new Path2D();
    body.moveTo(0, -bh);
    body.bezierCurveTo(bw * 0.62, -bh, bw * 1.05, -bh * 0.42, bw * 1.04, bh * 0.18);
    body.bezierCurveTo(bw * 1.03, bh * 0.78, bw * 0.58, bh, 0, bh);
    body.bezierCurveTo(-bw * 0.58, bh, -bw * 1.03, bh * 0.78, -bw * 1.04, bh * 0.18);
    body.bezierCurveTo(-bw * 1.05, -bh * 0.42, -bw * 0.62, -bh, 0, -bh);
    body.closePath();
    ctx.fillStyle = BLOB;
    ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = BLOB_SHADE;
    ctx.beginPath();
    ctx.ellipse(bw * 0.35, bh * 0.95, bw * 1.2, bh * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.ellipse(-bw * 0.5, -bh * 0.62, bw * 0.2, bh * 0.11, -35 * Math.PI / 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = T * 0.1;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke(body);

    // face, shifted toward where it's heading
    const look = Math.max(-1, Math.min(1, this.pullEased));
    const faceX = b.facing * bw * 0.05 + look * bw * 0.05;
    ctx.translate(faceX, 0);
    const eyeY = -bh * 0.18;
    const erx = bw * 0.3;
    const eryOpen = bh * (0.3 + 0.04 * danger);
    const bt = timeS - this.blinkT;
    const blink = bt < 0.13 ? Math.sin((bt / 0.13) * Math.PI) : 0;
    const ery = eryOpen * (1 - blink * 0.9);
    const asleep = paused;
    const efforting = !asleep && danger < 0.5 && strain > 0.45;

    ctx.lineCap = 'round';
    for (const d of [-1, 1] as const) {
      const ex = d * bw * 0.36;
      if (asleep) {
        ctx.lineWidth = T * 0.07;
        ctx.beginPath();
        ctx.moveTo(ex - erx * 0.7, eyeY + ery * 0.1);
        ctx.quadraticCurveTo(ex, eyeY + ery * 0.6, ex + erx * 0.7, eyeY + ery * 0.1);
        ctx.stroke();
        continue;
      }
      const ey = efforting ? eyeY + ery * 0.12 : eyeY;
      const eRy = efforting ? ery * 0.72 : ery;
      ctx.fillStyle = '#FFFFFF';
      ctx.lineWidth = T * 0.06;
      ctx.beginPath();
      ctx.ellipse(ex, ey, erx, Math.max(eRy, 0.5), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (blink < 0.6) {
        // pupils: pin-pricked and looking down-ahead in panic, otherwise toward the pull
        const dirX = Math.abs(b.vx) > 0.5 ? Math.sign(b.vx) : b.facing;
        const prCalm = erx * 0.5, prPanic = erx * 0.36;
        const pr = prCalm + (prPanic - prCalm) * danger;
        const lx = look * erx * 0.34 * (1 - danger) + dirX * erx * 0.32 * danger;
        const ly = (Math.max(-1, Math.min(1, b.vy / 20)) * eRy * 0.3) * (1 - danger) + eRy * 0.4 * danger;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ex, ey, erx, Math.max(eRy, 0.5), 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(ex + lx, ey + ly, pr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(ex + lx - pr * 0.3, ey + ly - pr * 0.38, pr * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // brows
      const bx = ex, byy = eyeY - eryOpen - bh * 0.1;
      if (danger > 0.5) {
        ctx.lineWidth = T * 0.07;
        ctx.beginPath();
        ctx.moveTo(bx - erx * 0.8, byy + bh * (d < 0 ? 0.07 : -0.06));
        ctx.quadraticCurveTo(bx, byy - bh * 0.1, bx + erx * 0.8, byy + bh * (d < 0 ? -0.06 : 0.07));
        ctx.stroke();
      } else if (efforting) {
        ctx.lineWidth = T * 0.075;
        ctx.beginPath();
        ctx.moveTo(bx - d * erx * 0.85, byy + bh * 0.0);
        ctx.lineTo(bx + d * erx * 0.75, byy + bh * 0.12);
        ctx.stroke();
      }
    }

    // cheeks
    if (!efforting) {
      ctx.fillStyle = 'rgba(255,90,120,.28)';
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(d * bw * 0.62, bh * 0.22, bw * 0.13, bh * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // mouth
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    if (danger > 0.5) {
      const o = 0.85 + 0.15 * Math.sin(timeS * 9);
      ctx.beginPath();
      ctx.ellipse(bw * 0.06, bh * 0.42, bw * 0.12 * o, bh * 0.14 * o, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (asleep) {
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.42, bw * 0.07, bh * 0.05 + bh * 0.02 * Math.sin(timeS * 1.6), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (efforting) {
      const mw = bw * 0.42, mh = bh * 0.16;
      ctx.fillStyle = '#FFFFFF';
      ctx.lineWidth = T * 0.055;
      ctx.beginPath();
      ctx.roundRect(-mw / 2, bh * 0.36, mw, mh, mh * 0.45);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-mw / 2 + mh * 0.2, bh * 0.36 + mh / 2);
      ctx.lineTo(mw / 2 - mh * 0.2, bh * 0.36 + mh / 2);
      ctx.stroke();
    } else {
      ctx.lineWidth = T * 0.07;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.15, bh * 0.36);
      ctx.quadraticCurveTo(0, bh * 0.52, bw * 0.15, bh * 0.36);
      ctx.stroke();
    }
    ctx.restore();

    // sweat drops flung backward + alarm lines over the head
    if (danger > 0.5 || (efforting && strain > 0.7)) {
      const back = -(Math.abs(b.vx) > 0.5 ? Math.sign(b.vx) : b.facing);
      const a = danger > 0.5 ? 1 : 0.7;
      const bob = Math.sin(timeS * 8) * T * 0.04;
      drop(ctx, cx + back * r * 1.15, feetY - bh - r * 0.95 + bob, (T / 50) * 0.9 * a, back * 30);
      drop(ctx, cx + back * r * 1.45, feetY - bh - r * 0.45 - bob, (T / 50) * 0.6 * a, back * 55);
    }
    if (danger > 0.5) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = T * 0.06;
      ctx.lineCap = 'round';
      const hcx = cx, hcy = feetY - bh;
      const pulse = 0.08 * Math.sin(timeS * 14);
      ctx.beginPath();
      for (const deg of [-120, -95, -70]) {
        const a = (deg * Math.PI) / 180;
        const r1 = r * (1.45 + pulse), r2 = r * (1.75 + pulse);
        ctx.moveTo(hcx + Math.cos(a) * r1, hcy + Math.sin(a) * r1 * 1.1 * ky);
        ctx.lineTo(hcx + Math.cos(a) * r2, hcy + Math.sin(a) * r2 * 1.1 * ky);
      }
      ctx.stroke();
    }
    if (paused) drawZzz(ctx, T, cx + r * 0.7, feetY - bh * 2 - r * 0.1, timeS);
  }

  private drawDead(ctx: CanvasRenderingContext2D, T: number, cx: number, feetY: number, timeS: number): void {
    const t = timeS - this.deadT;
    // squash into a pancake with a little overshoot
    const k = t < 0 ? 1 : Math.min(1, 1 - Math.exp(-t * 18) * Math.cos(t * 26));
    const halfW = T * (0.8 + 0.55 * k);
    const hgt = T * (1.6 - 1.2 * k);
    const y = feetY;
    const x0 = cx - halfW, x1 = cx + halfW;
    ctx.save();
    ctx.fillStyle = BLOB;
    ctx.strokeStyle = INK;
    ctx.lineWidth = T * 0.09;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.bezierCurveTo(x0 - T * 0.1, y - hgt * 1.1, x0 + halfW * 0.45, y - hgt, cx, y - hgt);
    ctx.bezierCurveTo(x1 - halfW * 0.45, y - hgt, x1 + T * 0.1, y - hgt * 1.1, x1, y);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = BLOB_SHADE;
    ctx.fillRect(x0 - T, y - hgt * 0.38, halfW * 2 + 2 * T, hgt);
    ctx.restore();
    ctx.stroke();
    // splats
    const seeds = [0.12, 0.31, 0.47, 0.63, 0.8, 0.93];
    for (let i = 0; i < seeds.length; i++) {
      const a = Math.PI + seeds[i]! * Math.PI;
      const dist = T * (1.1 + ((i * 7) % 5) * 0.25) * Math.min(1, t * 6);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * dist * 1.4, y - T * 0.15 + Math.sin(a) * dist * 0.7, T * (0.06 + (i % 3) * 0.04), 0, Math.PI * 2);
      ctx.lineWidth = T * 0.04;
      ctx.fill();
      ctx.stroke();
    }
    // X eyes
    const ey = y - hgt * 0.5;
    ctx.lineWidth = T * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const d of [-1, 1]) {
      const xx = cx + d * T * 0.24, s = T * 0.11;
      ctx.moveTo(xx - s, ey - s); ctx.lineTo(xx + s, ey + s);
      ctx.moveTo(xx + s, ey - s); ctx.lineTo(xx - s, ey + s);
    }
    ctx.stroke();
    // impact stars
    if (t < 1.6) {
      const a = Math.min(1, (1.6 - t) * 2);
      ctx.globalAlpha = a;
      star(ctx, cx - T * 1.6, y - T * 1.1, 0.9 * T / 50, timeS);
      star(ctx, cx + T * 1.7, y - T * 1.5, 0.7 * T / 50, timeS + 1);
      star(ctx, cx + T * 1.1, y - T * 2.3, 0.5 * T / 50, timeS + 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

function drop(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rotDeg: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rotDeg * Math.PI) / 180);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(4, -3, 7, 1, 7, 5);
  ctx.arc(0, 5, 7, 0, Math.PI);
  ctx.bezierCurveTo(-7, 1, -4, -3, 0, -10);
  ctx.closePath();
  ctx.fillStyle = SWEAT;
  ctx.fill();
  ctx.lineWidth = 2.2 / s * (s > 0 ? Math.min(1, s * 1.2) : 1);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 3) * 0.3);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, -10); ctx.lineTo(3, -3); ctx.lineTo(10, 0); ctx.lineTo(3, 3);
  ctx.lineTo(0, 10); ctx.lineTo(-3, 3); ctx.lineTo(-10, 0); ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 2 / s;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function drawZzz(ctx: CanvasRenderingContext2D, T: number, x: number, y: number, timeS: number): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const ph = ((timeS * 0.45 + i / 3) % 1);
    const size = T * (0.32 + ph * 0.4);
    const px = x + ph * T * 0.9 + Math.sin(ph * 6.28 + i) * T * 0.12;
    const py = y - ph * T * 1.6;
    ctx.globalAlpha = Math.min(1, ph * 5) * Math.min(1, (1 - ph) * 3);
    ctx.font = `${size.toFixed(1)}px 'Bagel Fat One', sans-serif`;
    ctx.lineWidth = Math.max(2, size * 0.16);
    ctx.strokeStyle = INK;
    ctx.strokeText('z', px, py);
    ctx.fillStyle = CREAM_HI;
    ctx.fillText('z', px, py);
  }
  ctx.restore();
}
