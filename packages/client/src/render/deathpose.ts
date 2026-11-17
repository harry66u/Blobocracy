// The blob's comic death poses, one per cause. `t` is seconds of world time since the
// impact: it stands still at 0 through the hit-stop, so the first half second shows the
// impact frame, then each pose plays out (pancake wobble, deflating pop, wave and fall,
// two wobbling halves, eyes peeking out of the Big Chomp's mouth).
import { BLOB, BLOB_SHADE, CREAM, CREAM_HI, FONT_DISPLAY, FONT_TEXT, HAZARD, INK } from './palette.ts';

const MAW = '#4A1238';
const TAU = Math.PI * 2;

/** The blob's body outline centered on (0, 0): half width bw, half height bh, slightly pear-shaped. */
function bodyPath(bw: number, bh: number): Path2D {
  const p = new Path2D();
  p.moveTo(0, -bh);
  p.bezierCurveTo(bw * 0.62, -bh, bw * 1.05, -bh * 0.42, bw * 1.04, bh * 0.18);
  p.bezierCurveTo(bw * 1.03, bh * 0.78, bw * 0.58, bh, 0, bh);
  p.bezierCurveTo(-bw * 0.58, bh, -bw * 1.03, bh * 0.78, -bw * 1.04, bh * 0.18);
  p.bezierCurveTo(-bw * 1.05, -bh * 0.42, -bw * 0.62, -bh, 0, -bh);
  p.closePath();
  return p;
}

/** Fill, shade, highlight and outline a body path (already positioned at the origin). */
function paintBody(g: CanvasRenderingContext2D, body: Path2D, bw: number, bh: number, T: number): void {
  g.fillStyle = BLOB;
  g.fill(body);
  g.save();
  g.clip(body);
  g.fillStyle = BLOB_SHADE;
  g.beginPath();
  g.ellipse(bw * 0.35, bh * 0.95, bw * 1.2, bh * 0.5, 0, 0, TAU);
  g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath();
  g.ellipse(-bw * 0.5, -bh * 0.62, bw * 0.2, bh * 0.11, -35 * Math.PI / 180, 0, TAU);
  g.fill();
  g.lineWidth = T * 0.1;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke(body);
}

function xEyes(g: CanvasRenderingContext2D, T: number, x: number, y: number, spread: number, size: number): void {
  g.strokeStyle = INK;
  g.lineWidth = T * 0.075;
  g.lineCap = 'round';
  g.beginPath();
  for (const d of [-1, 1]) {
    const xx = x + d * spread, s = size;
    g.moveTo(xx - s, y - s); g.lineTo(xx + s, y + s);
    g.moveTo(xx + s, y - s); g.lineTo(xx - s, y + s);
  }
  g.stroke();
}

/** Big round shocked eyes with pin-prick pupils looking toward (lx, ly) in -1..1. */
function shockedEyes(g: CanvasRenderingContext2D, T: number, x: number, y: number, spread: number, rx: number, ry: number, lx: number, ly: number): void {
  for (const d of [-1, 1]) {
    const ex = x + d * spread;
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = INK;
    g.lineWidth = T * 0.06;
    g.beginPath();
    g.ellipse(ex, y, rx, ry, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(ex + lx * rx * 0.45, y + ly * ry * 0.45, Math.min(rx, ry) * 0.3, 0, TAU);
    g.fill();
  }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, s: number, spin: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, -10); g.lineTo(3, -3); g.lineTo(10, 0); g.lineTo(3, 3);
  g.lineTo(0, 10); g.lineTo(-3, 3); g.lineTo(-10, 0); g.lineTo(-3, -3);
  g.closePath();
  g.fillStyle = CREAM;
  g.fill();
  g.lineWidth = 2 / s;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
}

/** A comic "POP!" burst: spiky cream star with pink lettering. */
function popBurst(g: CanvasRenderingContext2D, T: number, x: number, y: number, scale: number, alpha: number, rot: number): void {
  if (alpha <= 0 || scale <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(rot);
  g.scale(scale, scale);
  const R = T * 0.95, r = T * 0.62, n = 11;
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? R * (0.92 + ((i * 7) % 5) * 0.03) : r;
    g.lineTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = CREAM_HI;
  g.fill();
  g.lineWidth = T * 0.08;
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.stroke();
  g.font = `${(T * 0.62).toFixed(1)}px ${FONT_DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = T * 0.12;
  g.strokeText('POP!', 0, T * 0.04);
  g.fillStyle = HAZARD;
  g.fillText('POP!', 0, T * 0.04);
  g.restore();
}

const easeOut = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

export interface PoseCtx {
  g: CanvasRenderingContext2D;
  /** Tile size, px. */
  T: number;
  /** Feet center on screen. */
  cx: number;
  feetY: number;
  /** World seconds since impact (0 during the freeze). */
  t: number;
  timeS: number;
}

/** Draw the death pose for `cause` (anything unknown gets the pancake). */
export function drawDeathPose(cause: string | null | undefined, p: PoseCtx): void {
  p.g.save();
  switch (cause) {
    case 'spikes': popPose(p, false); break;
    case 'ceiling spikes': popPose(p, true); break;
    case 'pit': pitPose(p); break;
    case 'saw': slicedPose(p); break;
    case 'chomp': break; // drawn over the Big Chomp by drawGulp
    default: pancakePose(p);
  }
  p.g.restore();
}

// ---- the Big Press: a pancake ----------------------------------------------------------
function pancakePose({ g, T, cx, feetY: y, t, timeS }: PoseCtx): void {
  // impact frame is squashed past flat; then it wobbles back to a pancake
  const k = 1 + 0.22 * Math.exp(-t * 5) * Math.cos(t * 18);
  const halfW = T * (0.8 + 0.78 * k);
  const hgt = T * Math.max(0.3, 1.75 - 1.3 * k);
  const x0 = cx - halfW, x1 = cx + halfW;
  g.fillStyle = BLOB;
  g.strokeStyle = INK;
  g.lineWidth = T * 0.09;
  g.lineJoin = 'round';
  // squish lines either side on impact
  if (t < 0.5) {
    const a = 1 - t / 0.5;
    g.globalAlpha = a;
    g.lineCap = 'round';
    g.lineWidth = T * 0.07;
    g.beginPath();
    for (const d of [-1, 1]) {
      const bx = cx + d * (halfW + T * 0.3);
      for (const [dy, len] of [[-0.45, 0.5], [-0.15, 0.75], [0.12, 0.45]] as const) {
        g.moveTo(bx, y + dy * T);
        g.lineTo(bx + d * len * T, y + dy * T - T * 0.05);
      }
    }
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = T * 0.09;
  }
  g.beginPath();
  g.moveTo(x0, y);
  g.bezierCurveTo(x0 - T * 0.1, y - hgt * 1.1, x0 + halfW * 0.45, y - hgt, cx, y - hgt);
  g.bezierCurveTo(x1 - halfW * 0.45, y - hgt, x1 + T * 0.1, y - hgt * 1.1, x1, y);
  g.closePath();
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = BLOB_SHADE;
  g.fillRect(x0 - T, y - hgt * 0.38, halfW * 2 + 2 * T, hgt);
  g.restore();
  g.stroke();
  // splats fly out from under it
  const seeds = [0.12, 0.31, 0.47, 0.63, 0.8, 0.93];
  for (let i = 0; i < seeds.length; i++) {
    const a = Math.PI + seeds[i]! * Math.PI;
    const dist = T * (1.1 + ((i * 7) % 5) * 0.25) * Math.min(1, 0.75 + t * 2);
    g.beginPath();
    g.arc(cx + Math.cos(a) * dist * 1.4, y - T * 0.15 + Math.sin(a) * dist * 0.7, T * (0.06 + (i % 3) * 0.04), 0, TAU);
    g.lineWidth = T * 0.04;
    g.fill();
    g.stroke();
  }
  // X eyes and a little tongue, squeezed out to one side (the middle is usually under the press)
  const fx = cx + halfW - T * 0.62;
  const ey = y - Math.max(hgt * 0.5, T * 0.14);
  xEyes(g, T, fx, ey, T * 0.2, T * 0.085);
  g.fillStyle = HAZARD;
  g.beginPath();
  g.ellipse(fx + T * 0.08, y - T * 0.02, T * 0.08, T * 0.12, 0.3, 0, Math.PI);
  g.fill();
  g.lineWidth = T * 0.04;
  g.stroke();
  // dizzy stars
  if (t < 2) {
    g.globalAlpha = Math.min(1, (2 - t) * 2);
    for (let i = 0; i < 3; i++) {
      const a = timeS * 3 + (i * TAU) / 3;
      star(g, cx + Math.cos(a) * T * 1.1, y - T * 0.9 + Math.sin(a) * T * 0.3, (0.75 - i * 0.12) * T / 50, a);
    }
    g.globalAlpha = 1;
  }
}

// ---- spikes and ceiling spikes: pop, then deflate ------------------------------------
function popPose({ g, T, cx, feetY, t, timeS }: PoseCtx, ceiling: boolean): void {
  const r = T * 0.8;
  const d = easeOut(t / 0.75);
  // floor spikes: the skin settles onto the floor; ceiling spikes: it hangs from the point
  const s = ceiling ? 1 : -1;
  const anchorY = ceiling ? feetY - r * 2.1 : feetY;
  const bw = r * (0.95 + 0.32 * d);
  const bh = r * (1.1 - 0.68 * d);
  const jitter = t > 0 && t < 0.6 ? Math.sin(t * 70) * T * 0.06 * (1 - t / 0.6) : 0;
  const ox = cx + jitter, oy = anchorY + s * bh;
  // body: an ellipse that wrinkles as the air rushes out
  const wr = 0.07 * d;
  const body = new Path2D();
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const w = 1 + wr * Math.sin(a * 7 + 1.3) + wr * 0.6 * Math.sin(a * 11);
    let px = Math.cos(a) * bw * w, py = Math.sin(a) * bh * w;
    // flat where it rests (the floor, or the spike it hangs from)
    if (py * -s > bh * 0.82) py = -s * bh * 0.82;
    px *= 1 + 0.06 * Math.sin(a * 2);
    if (i === 0) body.moveTo(ox + px, oy + py); else body.lineTo(ox + px, oy + py);
  }
  body.closePath();
  g.fillStyle = BLOB;
  g.fill(body);
  g.save();
  g.clip(body);
  g.fillStyle = BLOB_SHADE;
  g.beginPath();
  g.ellipse(ox + bw * 0.35, oy + bh * 0.95, bw * 1.2, bh * 0.5, 0, 0, TAU);
  g.fill();
  // wrinkle creases
  if (d > 0.2) {
    g.strokeStyle = BLOB_SHADE;
    g.lineWidth = T * 0.05;
    g.lineCap = 'round';
    g.beginPath();
    for (const f of [-0.55, -0.15, 0.3, 0.62]) {
      g.moveTo(ox + f * bw, oy + bh * 0.15);
      g.quadraticCurveTo(ox + f * bw + bw * 0.08, oy + bh * 0.45, ox + f * bw - bw * 0.04, oy + bh * 0.7);
    }
    g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,.8)';
  g.beginPath();
  g.ellipse(ox - bw * 0.5, oy - bh * 0.55, bw * 0.17, Math.max(1, bh * 0.1), -0.6, 0, TAU);
  g.fill();
  g.lineWidth = T * 0.1;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke(body);

  // face: shocked on impact, X eyes once deflated
  const ey = oy - bh * 0.2;
  if (d < 0.35) {
    shockedEyes(g, T, ox, ey, bw * 0.36, bw * 0.3, Math.max(bh * 0.32, T * 0.1), 0, s);
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(ox, oy + bh * 0.42, bw * 0.12, Math.max(bh * 0.15, T * 0.06), 0, 0, TAU);
    g.fill();
  } else {
    xEyes(g, T, ox, ey, bw * 0.3, T * 0.1);
    // wobbly deflated mouth
    g.lineWidth = T * 0.06;
    g.lineCap = 'round';
    g.beginPath();
    const my = oy + bh * 0.35;
    g.moveTo(ox - bw * 0.22, my);
    for (let i = 1; i <= 6; i++) g.lineTo(ox - bw * 0.22 + (i / 6) * bw * 0.44, my + (i % 2 ? -1 : 1) * T * 0.035);
    g.stroke();
  }

  // the puncture: a POP! burst and air puffs escaping from the point
  const px = cx + T * 0.15, py = ceiling ? anchorY : feetY;
  for (let i = 0; i < 6; i++) {
    const age = t - i * 0.07;
    if (age <= 0 || age > 0.7) continue;
    const k = age / 0.7;
    const a = (ceiling ? -Math.PI / 2 : Math.PI / 2) + (i % 2 ? 1 : -1) * (0.5 + i * 0.25);
    const dist = T * (0.4 + k * 1.6);
    g.globalAlpha = 1 - k;
    g.fillStyle = CREAM_HI;
    g.strokeStyle = INK;
    g.lineWidth = T * 0.04;
    g.beginPath();
    g.arc(px + Math.cos(a) * dist * 1.3, py - s * T * 0.2 - Math.sin(a) * dist * s * 0.5, T * (0.1 + 0.12 * k), 0, TAU);
    g.fill();
    g.stroke();
  }
  g.globalAlpha = 1;
  // air rushing lines on impact
  if (t < 0.35) {
    g.strokeStyle = INK;
    g.lineWidth = T * 0.06;
    g.lineCap = 'round';
    g.beginPath();
    for (const a of [-0.9, -0.3, 0.3, 0.9]) {
      const dir = ceiling ? -Math.PI / 2 + a : Math.PI / 2 + a;
      g.moveTo(px + Math.cos(dir) * T * 0.35, py + Math.sin(dir) * T * 0.3);
      g.lineTo(px + Math.cos(dir) * T * 0.75, py + Math.sin(dir) * T * 0.6);
    }
    g.stroke();
  }
  const burstK = t < 0.01 ? 1 : 1 + t * 1.2;
  const burstA = t < 0.01 ? 1 : Math.max(0, 1 - t / 0.45);
  popBurst(g, T, cx + r * 1.25, (ceiling ? anchorY + T * 0.1 : feetY - r * 1.9), burstK * 0.9, burstA, -0.18 + Math.sin(timeS * 30) * 0.02 * burstA);
}

// ---- the Pit: a tiny wave, then falling away ------------------------------------------
function pitPose({ g, T, cx, feetY, t }: PoseCtx): void {
  const r = T * 0.8;
  const WAVE_S = 0.75;
  const fallT = Math.max(0, t - WAVE_S);
  const scale = 1 / (1 + fallT * 2.2);
  const dy = 0.5 * 34 * T * fallT * fallT;
  const alpha = Math.max(0, 1 - fallT / 0.8);
  if (alpha <= 0) return;
  const bw = r * 0.96, bh = r * 1.04;
  g.save();
  g.globalAlpha = alpha;
  g.translate(cx, feetY - bh * scale + dy);
  g.scale(scale, scale);
  g.rotate(fallT * 1.4);
  // falling lines above once it drops
  if (fallT > 0) {
    g.strokeStyle = INK;
    g.lineWidth = T * 0.06;
    g.lineCap = 'round';
    g.beginPath();
    for (const fx of [-0.5, 0, 0.5]) {
      g.moveTo(fx * bw, -bh * 1.35);
      g.lineTo(fx * bw, -bh * (1.35 + 0.5 + fallT));
    }
    g.stroke();
  }
  // waving arm (behind the body edge)
  const wave = t < WAVE_S ? Math.sin(t * 16) * 0.45 : 0.6;
  g.save();
  g.translate(bw * 0.8, -bh * 0.1);
  g.rotate(-1.15 + wave);
  g.beginPath();
  g.roundRect(-T * 0.12, -T * 0.72, T * 0.24, T * 0.78, T * 0.12);
  g.fillStyle = BLOB;
  g.fill();
  g.lineWidth = T * 0.08;
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
  paintBody(g, bodyPath(bw, bh), bw, bh, T);
  // resigned little face looking up at us
  const ey = -bh * 0.2;
  for (const d of [-1, 1]) {
    const ex = d * bw * 0.34;
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = INK;
    g.lineWidth = T * 0.06;
    g.beginPath();
    g.ellipse(ex, ey, bw * 0.27, bh * 0.28, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.beginPath();
    g.arc(ex, ey - bh * 0.1, bw * 0.13, 0, TAU);
    g.fill();
    // droopy lids
    g.fillStyle = BLOB_SHADE;
    g.beginPath();
    g.ellipse(ex, ey - bh * 0.06, bw * 0.29, bh * 0.3, 0, Math.PI * 1.08, Math.PI * 1.92);
    g.closePath();
    g.fill();
    g.lineWidth = T * 0.06;
    g.beginPath();
    g.moveTo(ex - bw * 0.27, ey - bh * 0.1);
    g.lineTo(ex + bw * 0.27, ey - bh * 0.1);
    g.stroke();
  }
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(0, bh * 0.4, bw * 0.08, bh * 0.08, 0, 0, TAU);
  g.fill();
  g.restore();
  // "bye!" bubble while it waves
  if (t < WAVE_S + 0.15) {
    const a = Math.min(1, (WAVE_S + 0.15 - t) / 0.15);
    const bx = cx + r * 1.7, by = feetY - bh * 2.2;
    g.globalAlpha = a;
    g.font = `800 ${(T * 0.42).toFixed(1)}px ${FONT_TEXT}`;
    const tw = g.measureText('bye!').width;
    g.beginPath();
    g.roundRect(bx - T * 0.2, by - T * 0.4, tw + T * 0.4, T * 0.62, T * 0.3);
    g.moveTo(bx + T * 0.02, by + T * 0.2);
    g.lineTo(bx - T * 0.32, by + T * 0.48);
    g.lineTo(bx + T * 0.28, by + T * 0.2);
    g.fillStyle = CREAM_HI;
    g.fill();
    g.lineWidth = T * 0.06;
    g.strokeStyle = INK;
    g.lineJoin = 'round';
    g.stroke();
    g.fillStyle = CREAM_HI;
    g.fillRect(bx - T * 0.05, by + T * 0.14, T * 0.3, T * 0.1);
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('bye!', bx, by - T * 0.09);
  }
}

// ---- a Saw: sliced in two, the halves wobbling apart ----------------------------------
function slicedPose({ g, T, cx, feetY, t }: PoseCtx): void {
  const r = T * 0.8;
  const bw = r, bh = r;
  const cy = feetY - bh;
  // cut line through the middle, tilted a little; n points to the right half
  const ux = 0.24, uy = 0.97;
  const nx = uy, ny = -ux;
  const sep = T * (0.05 + 0.2 * easeOut(t / 0.35));
  const lean = t <= 0 ? 0 : 0.28 * (1 - Math.exp(-t * 5)) + 0.12 * Math.exp(-t * 3) * Math.sin(t * 17);
  const body = bodyPath(bw, bh);
  for (const side of [-1, 1] as const) {
    g.save();
    // pivot on the bottom outer corner of the half so it tips outward
    const pivX = cx + side * bw * 0.5, pivY = feetY;
    g.translate(pivX, pivY);
    g.rotate(side * lean);
    g.translate(-pivX, -pivY);
    g.translate(side * nx * sep, side * ny * sep * 0.3);
    g.translate(cx, cy);
    // clip to this side of the cut
    const half = new Path2D();
    const L = r * 3;
    half.moveTo(-ux * L, -uy * L);
    half.lineTo(ux * L, uy * L);
    half.lineTo(ux * L + side * nx * L, uy * L + side * ny * L);
    half.lineTo(-ux * L + side * nx * L, -uy * L + side * ny * L);
    half.closePath();
    g.clip(half);
    paintBody(g, body, bw, bh, T);
    // the cut face
    g.save();
    g.clip(body);
    g.strokeStyle = BLOB_SHADE;
    g.lineWidth = T * 0.16;
    g.beginPath();
    g.moveTo(-ux * L, -uy * L);
    g.lineTo(ux * L, uy * L);
    g.stroke();
    g.restore();
    g.strokeStyle = INK;
    g.lineWidth = T * 0.1;
    g.beginPath();
    g.moveTo(-ux * bh * 1.05, -uy * bh * 1.05);
    g.lineTo(ux * bh * 1.02, uy * bh * 1.02);
    g.stroke();
    // X eyes (one lands on each half) and a split frown
    xEyes(g, T, 0, -bh * 0.18, bw * 0.4, T * 0.1);
    g.lineWidth = T * 0.06;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-bw * 0.22, bh * 0.44);
    g.quadraticCurveTo(0, bh * 0.28, bw * 0.22, bh * 0.44);
    g.stroke();
    g.restore();
  }
  // the slash streak, bright on the impact frame
  const a = t <= 0 ? 1 : Math.max(0, 1 - t / 0.3);
  if (a > 0) {
    g.globalAlpha = a;
    const len = r * 1.9 * (t <= 0 ? 1 : 1 + t * 2);
    g.beginPath();
    g.moveTo(cx - ux * len, cy - uy * len);
    g.quadraticCurveTo(cx + nx * T * 0.16, cy + ny * T * 0.16, cx + ux * len, cy + uy * len);
    g.quadraticCurveTo(cx - nx * T * 0.16, cy - ny * T * 0.16, cx - ux * len, cy - uy * len);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = T * 0.04;
    g.strokeStyle = INK;
    g.stroke();
    g.globalAlpha = 1;
  }
}

// ---- the Big Chomp: gulped, only the eyes and a tuft showing ---------------------------
/** Drawn after the Big Chomp so the eyes peek out of its closed mouth. */
export function drawGulp({ g, T, cx, feetY, t }: PoseCtx): void {
  const r = T * 0.8;
  const cy = feetY - r;
  // a gulp ripple once the freeze lets go
  const gulp = t > 0.15 && t < 0.75 ? Math.sin(((t - 0.15) / 0.6) * Math.PI) : 0;
  const w = r * 1.35 * (1 - 0.08 * gulp), h = r * 1.1 * (1 + 0.12 * gulp);
  g.save();
  g.translate(cx - T * 0.2, cy);
  // the tuft: the top of its head sticking out of the mouth like a little hat
  g.save();
  g.rotate(-0.12 + (t > 0 ? Math.sin(t * 9) * 0.08 * Math.exp(-t * 1.5) : 0));
  g.beginPath();
  g.moveTo(-r * 0.5, -h * 0.72);
  g.bezierCurveTo(-r * 0.5, -h * 1.45, r * 0.5, -h * 1.45, r * 0.5, -h * 0.72);
  g.closePath();
  g.fillStyle = BLOB;
  g.fill();
  g.lineWidth = T * 0.09;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.stroke();
  // curl of hair on top
  g.beginPath();
  g.moveTo(0, -h * 1.27);
  g.bezierCurveTo(-r * 0.05, -h * 1.7, r * 0.42, -h * 1.75, r * 0.3, -h * 1.48);
  g.bezierCurveTo(r * 0.22, -h * 1.33, r * 0.05, -h * 1.42, r * 0.12, -h * 1.52);
  g.lineWidth = T * 0.08;
  g.lineCap = 'round';
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.8)';
  g.beginPath();
  g.ellipse(-r * 0.22, -h * 1.12, r * 0.1, r * 0.06, -0.5, 0, TAU);
  g.fill();
  g.restore();
  // the dark inside of the mouth
  g.beginPath();
  g.ellipse(0, 0, w, h, 0, 0, TAU);
  g.fillStyle = MAW;
  g.fill();
  g.lineWidth = T * 0.1;
  g.strokeStyle = INK;
  g.stroke();
  // fangs closing over it, top and bottom
  g.save();
  g.beginPath();
  g.ellipse(0, 0, w, h, 0, 0, TAU);
  g.clip();
  g.fillStyle = HAZARD;
  g.strokeStyle = INK;
  g.lineWidth = T * 0.06;
  g.lineJoin = 'round';
  for (const s of [-1, 1]) {
    g.beginPath();
    const n = 4;
    for (let i = 0; i < n; i++) {
      const x0 = -w + (i / n) * 2 * w, x1 = -w + ((i + 1) / n) * 2 * w;
      const len = h * (0.42 + 0.1 * ((i + (s > 0 ? 1 : 0)) % 2));
      g.moveTo(x0, s * h * 1.05);
      g.quadraticCurveTo((x0 + x1) / 2 - s * T * 0.05, s * (h - len * 0.4), (x0 + x1) / 2 + T * 0.04, s * (h - len));
      g.quadraticCurveTo((x0 + x1) / 2 + T * 0.1, s * (h - len * 0.4), x1, s * h * 1.05);
      g.closePath();
    }
    g.fill();
    g.stroke();
  }
  g.restore();
  // eyes darting around in the dark
  const dart = t <= 0 ? 0 : Math.sign(Math.sin(t * 2.6)) * Math.min(1, Math.abs(Math.sin(t * 2.6)) * 4);
  const blinkPh = (t + 0.4) % 1.9;
  const blink = t > 0 && blinkPh < 0.12 ? Math.sin((blinkPh / 0.12) * Math.PI) : 0;
  for (const d of [-1, 1]) {
    const ex = d * r * 0.34, ey = -h * 0.05;
    const rx = r * 0.26, ry = r * 0.3 * (1 - 0.9 * blink);
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.ellipse(ex, ey, rx, Math.max(ry, 0.5), 0, 0, TAU);
    g.fill();
    g.lineWidth = T * 0.05;
    g.strokeStyle = INK;
    g.stroke();
    if (blink < 0.5) {
      g.fillStyle = INK;
      g.beginPath();
      g.arc(ex + dart * rx * 0.45, ey + (t <= 0 ? -ry * 0.1 : ry * 0.15), rx * (t <= 0 ? 0.3 : 0.45), 0, TAU);
      g.fill();
    }
  }
  g.restore();
  // a nervous sweat drop
  if (t > 0.5) {
    const ph = ((t - 0.5) * 0.9) % 1;
    g.save();
    g.globalAlpha = Math.min(1, (1 - ph) * 3);
    g.fillStyle = '#9FE4FF';
    g.strokeStyle = INK;
    g.lineWidth = T * 0.04;
    g.beginPath();
    const sx = cx + r * 0.9, sy = cy - h * 0.6 + ph * T * 0.6;
    g.moveTo(sx, sy - T * 0.16);
    g.quadraticCurveTo(sx + T * 0.12, sy, sx, sy + T * 0.08);
    g.quadraticCurveTo(sx - T * 0.12, sy, sx, sy - T * 0.16);
    g.fill();
    g.stroke();
    g.restore();
  }
}
