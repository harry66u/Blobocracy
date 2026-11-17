// Moving hazards and platforms: the Big Press (crusher), floating movers, saws on rails
// and the Big Chomp. Positions come from entityState (pure functions of the run clock),
// so the drawing is stateless too: the press's impact dust is a function of how long it
// has been down. All drawing is in tile units (the caller sets the transform).
import { CRUSHER_TEETH, entityState, MOVER_THICKNESS, type Chomp, type Crusher, type Entity, type Mover, type Saw } from '@blobocracy/shared';
import type { ViewRect } from './dyntiles.ts';
import { hash2 } from './level.ts';
import { CREAM, CREAM_HI, CREAM_SHADE, HAZARD, HAZARD_DARK, INK, mixHex, withAlpha } from './palette.ts';
import { TILE_SOLID } from './tiles.ts';

const TAU = Math.PI * 2;
const NIGHT_LINE = '#C9A6EA';
const GUM = '#B0124A';
const MAW = '#4A1238';

/** Where a crusher is in its cycle: seconds into the cycle and the length of its wait. */
export function crusherClock(e: Crusher, t: number): { c: number; wait: number } {
  let c = (t / e.period + e.phase) % 1;
  if (c < 0) c += 1;
  return { c: c * e.period, wait: e.period - e.downS - e.holdS - e.upS };
}

/** 0 (grumpy, waiting) .. 1 (furious, slamming), with a wind-up just before it drops. */
export function crusherAnger(e: Crusher, t: number): number {
  const { c, wait } = crusherClock(e, t);
  if (c < wait) return Math.max(0, 1 - (wait - c) / 0.45) * 0.75;
  if (c < wait + e.downS + e.holdS) return 1;
  return 0.6 * (1 - (c - wait - e.downS - e.holdS) / e.upS);
}

export interface EntityDrawCtx {
  view: ViewRect;
  runTime: number;
  chompStart: number | null;
  timeS: number;
  /** 0 day .. 1 night: lines that are ink by day turn lavender against the purple sky. */
  night: number;
  /** Where the blob is, for eyes that follow it. */
  focus: { x: number; y: number } | null;
}

const lineColor = (night: number, a: number) => withAlpha(night > 0.5 ? NIGHT_LINE : INK, a);

function visible(e: Entity, v: ViewRect): boolean {
  switch (e.kind) {
    case 'crusher': return e.x + e.w > v.x0 - 1 && e.x < v.x1 + 1;
    case 'mover': return Math.max(e.x, e.x + e.dx) - 1 < v.x1 && Math.min(e.x, e.x + e.dx) + e.w + 1 > v.x0;
    case 'saw': return Math.max(e.x, e.x + e.dx) - e.r - 1 < v.x1 && Math.min(e.x, e.x + e.dx) + e.r + 1 > v.x0;
    case 'chomp': return true;
  }
}

/** Rails, tracks and chains: everything that sits behind the dynamic tiles. */
export function drawEntitiesBack(g: CanvasRenderingContext2D, entities: readonly Entity[], d: EntityDrawCtx): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const e of entities) {
    if (!visible(e, d.view)) continue;
    if (e.kind === 'mover') {
      const cy = e.y + MOVER_THICKNESS / 2;
      dottedRail(g, e.x + e.w / 2, cy, e.x + e.dx + e.w / 2, cy + e.dy, lineColor(d.night, 0.32), 0.055, 0.34);
    } else if (e.kind === 'saw') {
      if (e.dx !== 0 || e.dy !== 0) sawRail(g, e, d.night);
    } else if (e.kind === 'crusher') {
      drawChain(g, e, d);
    }
  }
}

/** Movers, presses and saws. */
export function drawEntitiesFront(g: CanvasRenderingContext2D, entities: readonly Entity[], d: EntityDrawCtx): void {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const e of entities) {
    if (e.kind === 'mover' && visible(e, d.view)) drawMover(g, e, d);
  }
  for (const e of entities) {
    if (e.kind === 'crusher' && visible(e, d.view)) drawCrusher(g, e, d);
  }
  for (const e of entities) {
    if (e.kind === 'saw' && visible(e, d.view)) drawSaw(g, e, d);
  }
}

// ---- rails ----------------------------------------------------------------------

function dottedRail(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, r: number, gap: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.01) return;
  g.fillStyle = color;
  g.beginPath();
  const n = Math.max(1, Math.round(len / gap));
  for (let i = 0; i <= n; i++) {
    const px = x0 + ((x1 - x0) * i) / n, py = y0 + ((y1 - y0) * i) / n;
    g.moveTo(px + r, py);
    g.arc(px, py, r, 0, TAU);
  }
  g.fill();
  // end stops
  g.lineWidth = r * 0.9;
  g.strokeStyle = color;
  for (const [px, py] of [[x0, y0], [x1, y1]] as const) {
    g.beginPath();
    g.arc(px, py, r * 2.6, 0, TAU);
    g.stroke();
  }
}

function sawRail(g: CanvasRenderingContext2D, e: Saw, night: number): void {
  const x0 = e.x, y0 = e.y, x1 = e.x + e.dx, y1 = e.y + e.dy;
  // a slotted track: a dark groove with dots along it and bolted ends
  g.strokeStyle = lineColor(night, 0.22);
  g.lineWidth = 0.34;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  dottedRail(g, x0, y0, x1, y1, lineColor(night, 0.7), 0.06, 0.3);
  for (const [px, py] of [[x0, y0], [x1, y1]] as const) {
    g.beginPath();
    g.arc(px, py, 0.15, 0, TAU);
    g.fillStyle = night > 0.5 ? NIGHT_LINE : CREAM_SHADE;
    g.fill();
    g.lineWidth = 0.06;
    g.strokeStyle = INK;
    g.stroke();
  }
}

// ---- mover ----------------------------------------------------------------------

function drawMover(g: CanvasRenderingContext2D, e: Mover, d: EntityDrawCtx): void {
  const s = entityState(e, d.runTime) as { x: number; y: number; w: number };
  const h = MOVER_THICKNESS + 0.12; // a touch chunkier than the collision box, below its surface
  const { x, y, w } = s;
  // soft drop shadow
  g.fillStyle = 'rgba(42,27,61,.16)';
  g.beginPath();
  g.roundRect(x + 0.08, y + 0.16, w, h, h / 2);
  g.fill();
  // little gear hub hanging under the middle, turning as it travels
  const travel = (s.x - e.x) + (s.y - e.y);
  const gx = x + w / 2, gy = y + h + 0.12;
  g.fillStyle = INK;
  g.fillRect(gx - 0.05, y + h - 0.1, 0.1, 0.22);
  g.save();
  g.translate(gx, gy);
  g.rotate(travel * 2.2);
  g.beginPath();
  const teeth = 7;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * TAU;
    const rr = i % 2 ? 0.22 : 0.3;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fillStyle = CREAM_SHADE;
  g.fill();
  g.lineWidth = 0.06;
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 0.08, 0, TAU);
  g.fillStyle = INK;
  g.fill();
  g.restore();
  // platform
  const body = () => { g.beginPath(); g.roundRect(x, y, w, h, h / 2); };
  body();
  g.fillStyle = CREAM;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = CREAM_SHADE;
  g.fillRect(x, y + h * 0.64, w, h);
  g.fillStyle = CREAM_HI;
  g.beginPath();
  g.roundRect(x + 0.28, y + 0.1, Math.max(0.05, w - 0.56), 0.09, 0.045);
  g.fill();
  g.restore();
  body();
  g.lineWidth = 0.1;
  g.strokeStyle = INK;
  g.stroke();
  // rivets
  g.fillStyle = INK;
  for (const rx of [x + 0.3, x + w - 0.3]) {
    g.beginPath();
    g.arc(rx, y + h * 0.58, 0.05, 0, TAU);
    g.fill();
  }
}

// ---- the Big Press -------------------------------------------------------------

function drawChain(g: CanvasRenderingContext2D, e: Crusher, d: EntityDrawCtx): void {
  const s = entityState(e, d.runTime);
  if (s.kind !== 'crusher') return;
  const midX = s.x + s.w / 2 + windUpShake(e, d.runTime);
  const top = s.y - windUpLift(e, d.runTime);
  const color = d.night > 0.5 ? NIGHT_LINE : INK;
  g.strokeStyle = color;
  let i = 0;
  for (let yy = top - 0.08; yy > d.view.y0 - 0.6; yy -= 0.36, i++) {
    if (i % 2 === 0) {
      g.lineWidth = 0.075;
      g.beginPath();
      g.roundRect(midX - 0.13, yy - 0.44, 0.26, 0.44, 0.12);
      g.stroke();
    } else {
      g.lineWidth = 0.1;
      g.beginPath();
      g.moveTo(midX, yy - 0.4);
      g.lineTo(midX, yy - 0.04);
      g.stroke();
    }
  }
}

function windUpLift(e: Crusher, t: number): number {
  const { c, wait } = crusherClock(e, t);
  if (c >= wait) return 0;
  const k = Math.max(0, 1 - (wait - c) / 0.4);
  return 0.14 * Math.sin(k * Math.PI * 0.5);
}

function windUpShake(e: Crusher, t: number): number {
  const { c, wait } = crusherClock(e, t);
  if (c >= wait) return 0;
  const k = Math.max(0, 1 - (wait - c) / 0.4);
  return Math.sin(t * 90) * 0.035 * k;
}

function drawCrusher(g: CanvasRenderingContext2D, e: Crusher, d: EntityDrawCtx): void {
  const s = entityState(e, d.runTime);
  if (s.kind !== 'crusher') return;
  const t = d.runTime;
  const { c, wait } = crusherClock(e, t);
  const holdT = c - wait - e.downS;
  const anger = crusherAnger(e, t);
  const x0 = s.x + windUpShake(e, t), w = s.w, x1 = x0 + w, midX = x0 + w / 2;
  const teethH = CRUSHER_TEETH;
  const bottom = s.y + s.h + teethH; // teeth tips
  // a short squash on impact (anchored at the teeth)
  const squash = holdT >= 0 && holdT < e.holdS ? 0.07 * Math.exp(-holdT * 22) : 0;
  const blockH = s.h * (1 - squash);
  const by = bottom - teethH; // block bottom
  const ty = by - blockH - windUpLift(e, t);

  // speed lines while slamming
  if (s.moving === 'down') {
    g.strokeStyle = lineColor(d.night, 0.5);
    g.lineWidth = 0.07;
    g.beginPath();
    for (const [lx, len] of [[x0 - 0.18, 1.3], [x1 + 0.18, 1.1], [x0 - 0.42, 0.7], [x1 + 0.42, 0.8]] as const) {
      g.moveTo(lx, ty + 0.3);
      g.lineTo(lx, ty + 0.3 - len);
    }
    g.stroke();
  }

  // teeth
  const n = Math.max(2, Math.round(w / 0.6));
  g.beginPath();
  g.moveTo(x0 + 0.04, by - 0.1);
  for (let i = 0; i < n; i++) {
    g.lineTo(x0 + (w * (i + 0.5)) / n, by + teethH);
    g.lineTo(x0 + (w * (i + 1)) / n - (i === n - 1 ? 0.04 : 0), by - (i === n - 1 ? 0.1 : 0));
  }
  g.closePath();
  g.fillStyle = HAZARD;
  g.fill();
  g.lineWidth = 0.1;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,.7)';
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const mx = x0 + (w * (i + 0.5)) / n;
    g.moveTo(mx - 0.1, by + 0.05);
    g.lineTo(mx - 0.03, by + teethH - 0.13);
    g.lineTo(mx - 0.02, by + 0.06);
  }
  g.fill();

  // block
  const body = () => { g.beginPath(); g.roundRect(x0, ty, w, blockH, 0.3); };
  body();
  g.fillStyle = HAZARD;
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = withAlpha(HAZARD_DARK, 0.35);
  g.beginPath();
  for (let i = -4; i < w / 0.6 + 2; i++) {
    const sx = x0 + i * 0.6;
    g.moveTo(sx, ty + blockH);
    g.lineTo(sx + 0.3, ty + blockH);
    g.lineTo(sx + 0.3 + blockH * 0.6, ty);
    g.lineTo(sx + blockH * 0.6, ty);
    g.closePath();
  }
  g.fill();
  g.fillStyle = withAlpha(HAZARD_DARK, 0.55);
  g.fillRect(x0, ty + blockH * 0.8, w, blockH);
  g.fillStyle = 'rgba(255,255,255,.28)';
  g.beginPath();
  g.roundRect(x0 + 0.3, ty + 0.14, w - 0.6, 0.1, 0.05);
  g.fill();
  g.restore();
  body();
  g.lineWidth = 0.11;
  g.strokeStyle = INK;
  g.stroke();
  // mount plate where the chain meets the block
  g.fillStyle = INK;
  g.beginPath();
  g.roundRect(midX - 0.24, ty - 0.1, 0.48, 0.16, 0.06);
  g.fill();

  drawPressFace(g, x0, w, ty, blockH, anger, d, t);

  // impact: dust rolling out both ways and short burst lines (no screen shake, no flash)
  if (holdT >= 0 && holdT < 0.55) {
    const k = holdT / 0.55;
    g.lineWidth = 0.045;
    g.strokeStyle = INK;
    g.fillStyle = CREAM_HI;
    g.globalAlpha = Math.min(1, (1 - k) * 2);
    for (const side of [-1, 1]) {
      const ex = side < 0 ? x0 : x1;
      for (let j = 0; j < 5; j++) {
        const sp = 1.4 + j * 0.8 + hash2(e.id, j, side + 3) * 0.6;
        const px = ex + side * (0.05 + (1 - Math.exp(-holdT * 7)) * sp * 0.7);
        const py = bottom - 0.16 - (j % 2) * 0.12 - k * 0.4 * (j % 2 + 0.5);
        const r = (0.15 + 0.06 * (3 - j)) * (1 - k * 0.4);
        g.beginPath();
        g.arc(px, py, r, 0, TAU);
        g.fill();
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    if (holdT < 0.26) {
      const kk = holdT / 0.26;
      g.strokeStyle = lineColor(d.night, 1 - kk);
      g.lineWidth = 0.08;
      g.beginPath();
      for (const side of [-1, 1]) {
        const ex = side < 0 ? x0 - 0.05 : x1 + 0.05;
        for (const deg of [12, 38, 64]) {
          const a = (deg * Math.PI) / 180;
          const r0 = 0.45 + kk * 0.6, r1 = r0 + 0.6 - kk * 0.3;
          g.moveTo(ex + side * Math.cos(a) * r0, bottom - 0.15 - Math.sin(a) * r0);
          g.lineTo(ex + side * Math.cos(a) * r1, bottom - 0.15 - Math.sin(a) * r1);
        }
      }
      g.stroke();
    }
  }
}

function drawPressFace(g: CanvasRenderingContext2D, x0: number, w: number, ty: number, blockH: number, anger: number, d: EntityDrawCtx, t: number): void {
  const midX = x0 + w / 2;
  const ey = ty + blockH * 0.46, ex = Math.min(0.5, w * 0.22);
  const ery = 0.18 * (1 - 0.38 * anger), erx = 0.21;
  // pupils look at the blob (down when it's underneath)
  let lx = 0, ly = 0.04;
  if (d.focus) {
    const dx = d.focus.x - midX, dy = d.focus.y - ey;
    const l = Math.hypot(dx, dy) || 1;
    lx = (dx / l) * 0.08;
    ly = (dy / l) * 0.06;
  }
  g.lineCap = 'round';
  for (const s of [-1, 1]) {
    const cx = midX + s * ex;
    g.beginPath();
    g.ellipse(cx, ey, erx, ery, 0, 0, TAU);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = 0.07;
    g.strokeStyle = INK;
    g.stroke();
    g.save();
    g.clip();
    g.beginPath();
    g.arc(cx + lx, ey + ly, 0.085, 0, TAU);
    g.fillStyle = INK;
    g.fill();
    g.restore();
    // brows: low in the middle, steeper and thicker when angry
    g.lineWidth = 0.1 + 0.04 * anger;
    g.beginPath();
    g.moveTo(cx - s * (0.27 - 0.03 * anger), ey - 0.13 + 0.05 * anger);
    g.lineTo(cx + s * 0.21, ey - 0.33 - 0.07 * anger);
    g.stroke();
  }
  const my = ey + 0.42;
  if (anger < 0.5) {
    // grumpy frown
    g.lineWidth = 0.08;
    g.beginPath();
    g.moveTo(midX - 0.22, my + 0.04);
    g.quadraticCurveTo(midX, my - 0.06, midX + 0.22, my + 0.04);
    g.stroke();
  } else {
    // gritted teeth
    const mw = 0.56 + 0.1 * anger, mh = 0.2 + 0.04 * anger;
    g.beginPath();
    g.roundRect(midX - mw / 2, my - mh / 2, mw, mh, 0.07);
    g.fillStyle = '#FFFFFF';
    g.fill();
    g.lineWidth = 0.065;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 0.04;
    g.beginPath();
    g.moveTo(midX - mw / 2 + 0.04, my);
    g.lineTo(midX + mw / 2 - 0.04, my);
    for (const f of [-0.25, 0, 0.25]) { g.moveTo(midX + f * mw, my - mh / 2 + 0.02); g.lineTo(midX + f * mw, my + mh / 2 - 0.02); }
    g.stroke();
  }
  // anger vein popping on the forehead corner
  if (anger > 0.7) {
    const vx = x0 + w - 0.42, vy = ty + 0.48;
    const pop = 1 + 0.15 * Math.sin(t * 30);
    g.strokeStyle = INK;
    g.lineWidth = 0.06;
    g.beginPath();
    for (let q = 0; q < 4; q++) {
      const a = q * (Math.PI / 2) + Math.PI / 4;
      const cx = vx + Math.cos(a) * 0.13 * pop, cy = vy + Math.sin(a) * 0.13 * pop;
      g.moveTo(cx + Math.cos(a + 2.2) * 0.08, cy + Math.sin(a + 2.2) * 0.08);
      g.quadraticCurveTo(vx + Math.cos(a) * 0.05, vy + Math.sin(a) * 0.05, cx + Math.cos(a - 2.2) * 0.08, cy + Math.sin(a - 2.2) * 0.08);
    }
    g.stroke();
  }
}

// ---- saw -----------------------------------------------------------------------

function drawSaw(g: CanvasRenderingContext2D, e: Saw, d: EntityDrawCtx): void {
  const s = entityState(e, d.runTime) as { x: number; y: number; r: number };
  const s2 = entityState(e, d.runTime + 1 / 30) as { x: number; y: number };
  const vx = (s2.x - s.x) * 30, vy = (s2.y - s.y) * 30;
  const speed = Math.hypot(vx, vy);
  const { x, y, r } = s;
  const spin = d.timeS * 11;
  // whoosh lines trailing behind the motion
  if (speed > 0.6) {
    const ux = vx / speed, uy = vy / speed;
    const a = Math.min(1, speed / 5) * 0.55;
    g.strokeStyle = lineColor(d.night, a);
    g.lineWidth = 0.08;
    g.beginPath();
    for (const off of [-0.55, 0, 0.55]) {
      const px = x - ux * (r + 0.2) - uy * off * r, py = y - uy * (r + 0.2) + ux * off * r;
      const len = (off === 0 ? 0.9 : 0.55) * Math.min(1.4, 0.4 + speed / 6);
      g.moveTo(px, py);
      g.lineTo(px - ux * len, py - uy * len);
    }
    g.stroke();
  }
  // spin arcs just outside the teeth
  g.strokeStyle = lineColor(d.night, 0.35);
  g.lineWidth = 0.07;
  for (let i = 0; i < 2; i++) {
    const a0 = -spin * 0.35 + i * Math.PI;
    g.beginPath();
    g.arc(x, y, r + 0.17, a0, a0 + 0.9);
    g.stroke();
  }
  g.save();
  g.translate(x, y);
  g.rotate(spin);
  // blade with hooked teeth
  const nT = Math.max(8, Math.round((TAU * r) / 0.34));
  const rIn = r - Math.min(0.24, r * 0.26);
  g.beginPath();
  for (let i = 0; i < nT; i++) {
    const a0 = (i / nT) * TAU, a1 = ((i + 0.72) / nT) * TAU, a2 = ((i + 1) / nT) * TAU;
    g.lineTo(Math.cos(a0) * rIn, Math.sin(a0) * rIn);
    g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    g.lineTo(Math.cos(a2) * (rIn + 0.03), Math.sin(a2) * (rIn + 0.03));
  }
  g.closePath();
  g.fillStyle = HAZARD;
  g.fill();
  g.lineWidth = 0.09;
  g.strokeStyle = INK;
  g.stroke();
  // motion stripes on the disc
  g.save();
  g.beginPath();
  g.arc(0, 0, rIn - 0.02, 0, TAU);
  g.clip();
  g.fillStyle = withAlpha(HAZARD_DARK, 0.42);
  g.beginPath();
  for (let i = -4; i <= 4; i++) {
    const o = i * 0.42;
    g.moveTo(o - r * 2, -r * 2);
    g.lineTo(o + 0.2 - r * 2, -r * 2);
    g.lineTo(o + 0.2 + r * 2, r * 2);
    g.lineTo(o + r * 2, r * 2);
    g.closePath();
  }
  g.fill();
  g.restore();
  g.beginPath();
  g.arc(0, 0, rIn - 0.02, 0, TAU);
  g.lineWidth = 0.05;
  g.strokeStyle = withAlpha(INK, 0.55);
  g.stroke();
  g.restore();
  // hub and a fixed glint
  g.beginPath();
  g.arc(x, y, Math.max(0.12, r * 0.22), 0, TAU);
  g.fillStyle = INK;
  g.fill();
  g.beginPath();
  g.arc(x, y, Math.max(0.05, r * 0.08), 0, TAU);
  g.fillStyle = HAZARD;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 0.08;
  g.beginPath();
  g.arc(x, y, rIn * 0.7, Math.PI * 1.08, Math.PI * 1.42);
  g.stroke();
}

// ---- the Big Chomp -------------------------------------------------------------

export interface ChompOpts {
  /** How far the body reaches back from the teeth (tiles); Infinity fills to the view's left edge. */
  depth: number;
  /** Solid-tile lookup, to throw crumbs where it eats the ground. */
  solid?: (tx: number, ty: number) => boolean;
  /** Draw it even while it waits ahead of the blob (the level overview). */
  always?: boolean;
}

const TOOTH = 1.3; // tooth length (tiles)
const TOOTH_STEP = 1.08;

/**
 * How far (tiles) to slide the view left so a Big Chomp `dist` tiles behind the blob is
 * framed with its eyes in view, without pushing the blob past 60% of the view width.
 * `blobFromLeft` is where the blob sits in the unshifted view. Continuous in `dist`.
 */
export function chompCameraShift(viewW: number, blobFromLeft: number, dist: number): number {
  if (dist > 9) return 0;
  dist = Math.max(0, dist);
  const needed = Math.max(0, dist + 3.8 - blobFromLeft);
  const room = Math.max(0, 0.6 * viewW - blobFromLeft);
  const k = Math.min(1, Math.max(0, (9 - dist) / 3));
  return Math.min(needed, room) * k * k * (3 - 2 * k);
}

/** A wall of teeth with angry eyes filling everything left of the chomp's front. */
export function drawChomp(g: CanvasRenderingContext2D, e: Chomp, d: EntityDrawCtx, opts: ChompOpts): void {
  const { view, timeS } = d;
  const front = entityState(e, d.runTime, d.chompStart).x;
  const chasing = d.chompStart !== null;
  // before it wakes it only exists once the blob has walked past its lair
  if (!chasing && !opts.always && (!d.focus || d.focus.x < front)) return;
  if (front < view.x0 - 0.2) {
    // off-screen but close: a pink warning glow at the left edge
    const near = chasing ? 1 - (view.x0 - front) / 7 : 0;
    if (near > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(timeS * 7);
      const gr = g.createLinearGradient(view.x0, 0, view.x0 + 2.2, 0);
      gr.addColorStop(0, withAlpha(HAZARD, 0.55 * near * pulse));
      gr.addColorStop(1, withAlpha(HAZARD, 0));
      g.fillStyle = gr;
      g.fillRect(view.x0, view.y0, 2.2, view.y1 - view.y0);
    }
    return;
  }
  if (front - TOOTH - opts.depth > view.x1 + 1) return;
  const base = front - TOOTH; // where the teeth grow out of the gums
  const left = Math.max(view.x0 - 1, base - opts.depth);
  const y0 = view.y0 - 1, y1 = view.y1 + 1;
  const wob = (yy: number) => 0.12 * Math.sin(yy * 1.25 + timeS * 3.2) + 0.06 * Math.sin(yy * 3.1 - timeS * 5);
  const edge = (yy: number) => base + 0.18 + wob(yy);

  // body
  const body = new Path2D();
  body.moveTo(left, y0);
  for (let yy = y0; yy <= y1 + 0.001; yy += 0.25) body.lineTo(edge(yy), yy);
  body.lineTo(left, y1);
  body.closePath();
  const gr = g.createLinearGradient(base - 7, 0, base, 0);
  gr.addColorStop(0, mixHex(HAZARD_DARK, INK, 0.35));
  gr.addColorStop(0.55, HAZARD_DARK);
  gr.addColorStop(1, HAZARD);
  g.fillStyle = gr;
  g.fill(body);
  g.save();
  g.clip(body);
  // diagonal stripes sliding with the chase
  g.fillStyle = withAlpha(HAZARD_DARK, 0.4);
  g.beginPath();
  const scroll = (timeS * 0.9) % 1.5;
  for (let sx = Math.floor((left - (y1 - y0)) / 1.5) * 1.5; sx < base + 1; sx += 1.5) {
    const ax = sx + scroll;
    g.moveTo(ax, y1);
    g.lineTo(ax + 0.6, y1);
    g.lineTo(ax + 0.6 + (y1 - y0) * 0.6, y0);
    g.lineTo(ax + (y1 - y0) * 0.6, y0);
    g.closePath();
  }
  g.fill();
  // gums
  g.lineWidth = 0.75;
  g.strokeStyle = GUM;
  g.beginPath();
  for (let yy = y0; yy <= y1 + 0.001; yy += 0.25) g.lineTo(edge(yy) + 0.02, yy);
  g.stroke();
  g.restore();

  // dark maw behind the fangs, so they read as teeth rather than spikes
  const maw = new Path2D();
  maw.moveTo(edge(y0) - 0.3, y0);
  for (let yy = y0; yy <= y1 + 0.001; yy += 0.25) maw.lineTo(front - 0.55 + 0.1 * Math.sin(yy * 2.1 - timeS * 4), yy);
  for (let yy = y1; yy >= y0 - 0.001; yy -= 0.25) maw.lineTo(edge(yy) - 0.3, yy);
  maw.closePath();
  g.fillStyle = MAW;
  g.fill(maw);
  g.lineWidth = 0.1;
  g.strokeStyle = INK;
  g.stroke(maw);
  // teeth: big fangs pointing right, grinding up and down in alternating rows
  const grind = 0.13 * Math.sin(timeS * 11);
  const i0 = Math.floor(y0 / TOOTH_STEP) - 1, i1 = Math.ceil(y1 / TOOTH_STEP) + 1;
  const teeth = new Path2D(), glints = new Path2D();
  for (let i = i0; i <= i1; i++) {
    const odd = (i & 1) === 1;
    const cy = i * TOOTH_STEP + (odd ? grind : -grind);
    const half = TOOTH_STEP * (odd ? 0.4 : 0.5);
    const bx = edge(cy) - 0.12;
    const tip = front - (odd ? 0.28 : 0) - 0.04 * Math.abs(Math.sin(timeS * 11));
    const curl = odd ? 0.1 : -0.1;
    teeth.moveTo(bx, cy - half);
    teeth.quadraticCurveTo(bx + (tip - bx) * 0.55, cy - half * 0.75 + curl, tip, cy + curl);
    teeth.quadraticCurveTo(bx + (tip - bx) * 0.5, cy + half * 0.55 + curl, bx, cy + half);
    teeth.closePath();
    glints.moveTo(bx + 0.18, cy - half * 0.52);
    glints.quadraticCurveTo(bx + (tip - bx) * 0.55, cy - half * 0.45 + curl, tip - 0.2, cy + curl - 0.03);
    glints.quadraticCurveTo(bx + (tip - bx) * 0.5, cy - half * 0.32 + curl, bx + 0.18, cy - half * 0.25);
    glints.closePath();
  }
  g.fillStyle = HAZARD;
  g.fill(teeth);
  g.lineWidth = 0.1;
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.stroke(teeth);
  g.fillStyle = 'rgba(255,255,255,.78)';
  g.fill(glints);
  // outline of the body edge (drawn after the teeth' roots so the gums read as one lip)
  g.lineWidth = 0.12;
  g.beginPath();
  for (let yy = y0; yy <= y1 + 0.001; yy += 0.25) g.lineTo(edge(yy) - 0.2, yy);
  g.strokeStyle = withAlpha(INK, 0.35);
  g.stroke();

  // eyes: a big furious pair around the blob's height, peeking right at it
  const focusY = d.focus ? d.focus.y : (view.y0 + view.y1) / 2;
  const eyeY = Math.max(view.y0 + 1.6, Math.min(view.y1 - 3, focusY - 3.4));
  // the main pair scowls at the blob; smaller pairs up and down the wall blink out of step
  const eyes: { x: number; y: number; r: number; inner: 1 | -1; blinks: boolean }[] = [
    { x: base - 1.2, y: eyeY, r: 0.95, inner: -1, blinks: false },
    { x: base - 3.35, y: eyeY - 0.2, r: 0.85, inner: 1, blinks: false },
    { x: base - 1.3, y: eyeY - 5.2, r: 0.5, inner: -1, blinks: true },
    { x: base - 2.55, y: eyeY - 5.3, r: 0.45, inner: 1, blinks: true },
    { x: base - 1.4, y: eyeY + 6.4, r: 0.55, inner: -1, blinks: true },
    { x: base - 2.75, y: eyeY + 6.3, r: 0.5, inner: 1, blinks: true },
  ];
  for (const [k, eye] of eyes.entries()) {
    if (eye.x + eye.r < left || eye.y + eye.r < view.y0 - 1 || eye.y - eye.r > view.y1 + 1) continue;
    const pair = k >> 1;
    const ph = (timeS * 0.31 + pair * 0.37) % 1;
    const blink = eye.blinks && ph < 0.07 ? Math.sin((ph / 0.07) * Math.PI) : 0;
    angryEye(g, eye.x, eye.y, eye.r, eye.inner, d.focus, blink, timeS + k);
  }
  // drool dripping off the fangs
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.strokeStyle = INK;
  g.lineWidth = 0.04;
  for (let j = 0; j < 3; j++) {
    const ph = (timeS * 0.55 + j * 0.37) % 1;
    const yy = eyeY + 1.6 + j * 2.7 + ph * ph * 2.2;
    const xx = front - 0.5 - j * 0.12;
    const s = 0.11 * (1 - ph * 0.4);
    g.globalAlpha = Math.min(1, (1 - ph) * 3);
    g.beginPath();
    g.moveTo(xx, yy - s * 2.2);
    g.quadraticCurveTo(xx + s * 1.2, yy, xx, yy + s);
    g.quadraticCurveTo(xx - s * 1.2, yy, xx, yy - s * 2.2);
    g.fill();
    g.stroke();
  }
  g.globalAlpha = 1;
  // crumbs flying off the ground it is chewing through
  if (opts.solid && chasing) {
    const col = Math.floor(front - 0.3);
    let gy = -1;
    for (let yy = Math.max(0, Math.floor(view.y0)); yy < Math.ceil(view.y1); yy++) if (opts.solid(col, yy)) { gy = yy; break; }
    if (gy >= 0) {
      g.lineWidth = 0.04;
      g.strokeStyle = INK;
      for (let j = 0; j < 6; j++) {
        const ph = (timeS * 1.7 + j / 6) % 1;
        const hj = hash2(j, Math.floor(timeS * 1.7 + j / 6), 7);
        const px = front - 0.2 + ph * (0.8 + hj * 1.4);
        const py = gy - ph * (1.2 + hj) + ph * ph * 2.2;
        const sz = 0.07 + 0.06 * hj;
        g.save();
        g.translate(px, py);
        g.rotate(ph * 6 * (hj - 0.5));
        g.fillStyle = j % 2 ? CREAM : CREAM_SHADE;
        g.globalAlpha = 1 - ph * ph;
        g.beginPath();
        g.rect(-sz, -sz, sz * 2, sz * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
    }
  }
}

/**
 * One furious eye. `inner` is the side (+1 right, -1 left) facing the other eye of its
 * pair: the lid and brow slope down toward it, so a pair makes a scowling V.
 */
function angryEye(g: CanvasRenderingContext2D, x: number, y: number, r: number, inner: 1 | -1, focus: { x: number; y: number } | null, blink: number, t: number): void {
  const ry = r * 0.9;
  const lidIn = y - ry * 0.05 + blink * ry * 1.1, lidOut = y - ry * 0.78 + blink * ry * 1.9;
  const lx0 = inner < 0 ? lidIn : lidOut, lx1 = inner < 0 ? lidOut : lidIn; // lid height at the left / right edge
  g.beginPath();
  g.ellipse(x, y, r, ry, 0, 0, TAU);
  g.fillStyle = '#FFFFFF';
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = 'rgba(255,59,122,.2)';
  g.beginPath();
  g.ellipse(x, y + ry * 0.95, r * 1.1, ry * 0.55, 0, 0, TAU);
  g.fill();
  let px = r * 0.4, py = 0;
  if (focus) {
    const dx = focus.x - x, dy = focus.y - y;
    const l = Math.hypot(dx, dy) || 1;
    px = (dx / l) * r * 0.4;
    py = (dy / l) * ry * 0.38;
  }
  const pr = r * 0.4 * (1 + 0.05 * Math.sin(t * 13));
  g.fillStyle = INK;
  g.beginPath();
  g.arc(x + px, y + py + ry * 0.12, pr, 0, TAU);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.arc(x + px - pr * 0.35, y + py + ry * 0.12 - pr * 0.4, pr * 0.3, 0, TAU);
  g.fill();
  // lid
  g.fillStyle = HAZARD_DARK;
  g.beginPath();
  g.moveTo(x - r * 1.2, y - ry * 1.2);
  g.lineTo(x + r * 1.2, y - ry * 1.2);
  g.lineTo(x + r * 1.2, lx1 + (lx1 - lx0) * 0.1);
  g.lineTo(x - r * 1.2, lx0 - (lx1 - lx0) * 0.1);
  g.closePath();
  g.fill();
  g.restore();
  g.lineWidth = Math.max(0.08, r * 0.13);
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  g.beginPath();
  g.ellipse(x, y, r, ry, 0, 0, TAU);
  g.stroke();
  // lid edge and a heavy brow above it, sloping the same way
  const slope = (lx1 - lx0) / (2 * r);
  const ly = (xx: number) => lx0 + (xx - (x - r)) * slope;
  g.lineWidth = Math.max(0.07, r * 0.11);
  g.beginPath();
  g.moveTo(x - r * 0.97, ly(x - r * 0.97));
  g.lineTo(x + r * 0.97, ly(x + r * 0.97));
  g.stroke();
  g.lineWidth = r * 0.32;
  g.lineCap = 'round';
  const bx0 = x - r * 1.05, bx1 = x + r * 1.05, lift = r * 0.42;
  g.beginPath();
  g.moveTo(bx0, ly(bx0) - lift - (inner < 0 ? r * 0.12 : 0));
  g.lineTo(bx1, ly(bx1) - lift - (inner > 0 ? r * 0.12 : 0));
  g.stroke();
}

/** Is the tile solid ground (for the chomp's crumbs)? */
export const solidOf = (tileAt: (x: number, y: number) => number) => (x: number, y: number) => tileAt(x, y) === TILE_SOLID;
