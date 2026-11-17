// Static level geometry, pre-rendered into offscreen canvas chunks 32 tiles wide.
// Contiguous solid tiles are traced into outline loops and drawn as merged shapes
// with rounded convex and concave corners, like the mockup's cream platforms.
import type { Layout } from '../layout.ts';
import { makeCanvas } from './background.ts';
import { CREAM, CREAM_BODY, CREAM_HI, CREAM_SHADE, HAZARD, INK } from './palette.ts';
import { TILE_CEIL_SPIKE, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE, type SceneLevel } from './scene.ts';

export const CHUNK_TILES = 32;
/** Overlap drawn on each side of a chunk so neighbours cover each other's cut edges. */
const PAD = 0.5;
/** Window margin around a chunk used for tracing, so artificial cut corners stay off-canvas. */
const MARGIN = 3;
/** Chunks are drawn down to this row; solid columns of the last level row extend below it. */
export const BOTTOM_ROW = 22;
const MAX_CHUNKS = 4;

const CORNER = 0.32;
const OUTLINE = 0.11;
const ONEWAY_THICK = 0.66;

interface Chunk { canvas: HTMLCanvasElement | OffscreenCanvas | null; left: number; top: number }

export type TileFn = (x: number, y: number) => number;

/** Tile lookup that extends the level sideways (edge columns repeat) and downward (solid bottoms continue). */
export function extendedTiles(level: SceneLevel): TileFn {
  const w = level.width, h = level.height;
  return (x, y) => {
    if (y < 0) return 0;
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    if (y >= h) return level.tileAt(cx, h - 1) === TILE_SOLID ? TILE_SOLID : 0;
    return level.tileAt(cx, y);
  };
}

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Trace the boundary of the solid cells in [x0,x1)×[y0,y1) into closed loops of grid
 * vertices (flat [x,y,x,y,...]). Loops run clockwise on screen with the solid on the
 * right; cells touching only at a corner stay separate shapes.
 */
export function traceLoops(solid: (x: number, y: number) => boolean, x0: number, y0: number, x1: number, y1: number): number[][] {
  const inside = (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1 && solid(x, y);
  const sx: number[] = [], sy: number[] = [], dx: number[] = [], dy: number[] = [];
  const W = x1 - x0 + 2;
  const key = (x: number, y: number) => (y - y0 + 1) * W + (x - x0 + 1);
  const out = new Map<number, number[]>();
  const add = (ax: number, ay: number, ddx: number, ddy: number) => {
    const i = sx.length;
    sx.push(ax); sy.push(ay); dx.push(ddx); dy.push(ddy);
    const k = key(ax, ay);
    const l = out.get(k);
    if (l) l.push(i); else out.set(k, [i]);
  };
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, 1, 0);
      if (!inside(x + 1, y)) add(x + 1, y, 0, 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, -1, 0);
      if (!inside(x - 1, y)) add(x, y + 1, 0, -1);
    }
  }
  const used = new Uint8Array(sx.length);
  const loops: number[][] = [];
  for (let e = 0; e < sx.length; e++) {
    if (used[e]) continue;
    const pts: number[] = [];
    let cur = e;
    for (;;) {
      used[cur] = 1;
      pts.push(sx[cur]!, sy[cur]!);
      const ex = sx[cur]! + dx[cur]!, ey = sy[cur]! + dy[cur]!;
      const outs = out.get(key(ex, ey)) ?? [];
      const rx = -dy[cur]!, ry = dx[cur]!; // right turn on screen (y down)
      let next = -1;
      for (const o of outs) {
        if (used[o] && o !== e) continue;
        if (next === -1 || (dx[o] === rx && dy[o] === ry)) next = o;
      }
      if (next === -1 || next === e) break;
      cur = next;
    }
    loops.push(simplify(pts));
  }
  return loops;
}

function simplify(pts: number[]): number[] {
  const n = pts.length / 2;
  const res: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const ax = pts[i * 2]! - pts[p * 2]!, ay = pts[i * 2 + 1]! - pts[p * 2 + 1]!;
    const bx = pts[q * 2]! - pts[i * 2]!, by = pts[q * 2 + 1]! - pts[i * 2 + 1]!;
    if (ax * by - ay * bx === 0) continue; // collinear
    res.push(pts[i * 2]!, pts[i * 2 + 1]!);
  }
  return res;
}

/** Append a loop to a path with every corner rounded (radius clamped to half of each side). */
export function roundedLoop(path: Path2D | CanvasRenderingContext2D, pts: number[], r: number): void {
  const n = pts.length / 2;
  if (n < 3) return;
  const X = (i: number) => pts[((i + n) % n) * 2]!;
  const Y = (i: number) => pts[((i + n) % n) * 2 + 1]!;
  path.moveTo((X(-1) + X(0)) / 2, (Y(-1) + Y(0)) / 2);
  for (let i = 0; i < n; i++) {
    const lp = Math.hypot(X(i) - X(i - 1), Y(i) - Y(i - 1));
    const ln = Math.hypot(X(i + 1) - X(i), Y(i + 1) - Y(i));
    path.arcTo(X(i), Y(i), X(i + 1), Y(i + 1), Math.min(r, lp / 2, ln / 2));
  }
  path.closePath();
}

export class LevelLayer {
  private level: SceneLevel | null = null;
  private tiles: TileFn = () => 0;
  private tilePx = 0;
  private readonly chunks = new Map<number, Chunk>();

  /** Drop cached chunks (e.g. when the level changes in place). */
  invalidate(): void {
    this.chunks.clear();
  }

  draw(ctx: CanvasRenderingContext2D, L: Layout, level: SceneLevel, camPxX: number, camPxY: number): void {
    const tilePx = L.tile * L.dpr;
    if (level !== this.level || tilePx !== this.tilePx) {
      this.level = level;
      this.tiles = extendedTiles(level);
      this.tilePx = tilePx;
      this.chunks.clear();
    }
    const viewW = L.w * L.dpr;
    const span = CHUNK_TILES * tilePx;
    const first = Math.floor(camPxX / span);
    const last = Math.floor((camPxX + viewW) / span);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let c = first; c <= last; c++) {
      const ch = this.get(c);
      if (ch.canvas) ctx.drawImage(ch.canvas as CanvasImageSource, ch.left - camPxX, ch.top - camPxY);
    }
    ctx.restore();
    // Build at most one upcoming chunk per frame before it scrolls into view.
    const ahead = 8 * tilePx;
    if ((last + 1) * span - (camPxX + viewW) < ahead && !this.chunks.has(last + 1)) this.get(last + 1);
    else if (camPxX - first * span < ahead && !this.chunks.has(first - 1)) this.get(first - 1);
  }

  private get(c: number): Chunk {
    const hit = this.chunks.get(c);
    if (hit) {
      this.chunks.delete(c);
      this.chunks.set(c, hit);
      return hit;
    }
    const ch = buildChunk(this.tiles, c, this.tilePx);
    this.chunks.set(c, ch);
    while (this.chunks.size > MAX_CHUNKS) {
      const oldest = this.chunks.keys().next().value as number;
      this.chunks.delete(oldest);
    }
    return ch;
  }
}

export function buildChunk(code: TileFn, c: number, tilePx: number): Chunk {
  const x0 = c * CHUNK_TILES, x1 = x0 + CHUNK_TILES;
  const wx0 = x0 - MARGIN, wx1 = x1 + MARGIN;
  const wy0 = -2, wy1 = BOTTOM_ROW + MARGIN;
  let minRow = Infinity;
  for (let y = 0; y < wy1 && minRow === Infinity; y++) {
    for (let x = wx0; x < wx1; x++) if (code(x, y) !== 0) { minRow = y; break; }
  }
  const left = Math.floor((x0 - PAD) * tilePx);
  if (minRow === Infinity) return { canvas: null, left, top: 0 };
  const rTop = Math.max(-1, minRow - 1);
  const right = Math.ceil((x1 + PAD) * tilePx);
  const top = Math.floor(rTop * tilePx);
  const bottom = Math.ceil(BOTTOM_ROW * tilePx);
  const canvas = makeCanvas(right - left, bottom - top);
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(tilePx, 0, 0, tilePx, -left, -top);

  const solid = (x: number, y: number) => code(x, y) === TILE_SOLID;

  // ---- solid ground: merged rounded shapes ----
  const shape = new Path2D();
  for (const loop of traceLoops(solid, wx0, wy0, wx1, wy1)) roundedLoop(shape, loop, CORNER);

  const band = new Path2D(), under = new Path2D(), speck = new Path2D(), lip = new Path2D();
  for (let y = Math.max(0, rTop); y < wy1; y++) {
    let runStart = -1;
    for (let x = wx0; x <= wx1; x++) {
      const isTop = x < wx1 && solid(x, y) && !solid(x, y - 1);
      if (isTop) {
        band.rect(x, y, 1, 0.55);
        if (runStart < 0) runStart = x;
      } else if (runStart >= 0) {
        const w = x - runStart - 0.56;
        if (w > 0.05) lip.roundRect(runStart + 0.28, y + 0.13, w, 0.1, 0.05);
        runStart = -1;
      }
      if (x >= wx1 || !solid(x, y)) continue;
      if (y < 17 && !solid(x, y + 1)) under.rect(x, y + 0.72, 1, 0.28);
      if (solid(x, y - 1) && y < BOTTOM_ROW + 1) {
        const n = hash2(x, y, 1);
        const count = n < 0.22 ? 0 : n < 0.82 ? 1 : 2;
        for (let i = 0; i < count; i++) {
          const px = x + hash2(x, y, 2 + i);
          const py = y - 0.1 + hash2(x, y, 5 + i);
          const rx = 0.08 + hash2(x, y, 9 + i) * 0.1;
          speck.moveTo(px + rx, py);
          speck.ellipse(px, py, rx, 0.06, 0, 0, Math.PI * 2);
        }
      }
    }
  }
  g.save();
  g.clip(shape);
  g.fillStyle = CREAM_BODY;
  g.fillRect(wx0, rTop - 1, wx1 - wx0, wy1 - rTop + 1);
  g.fillStyle = CREAM;
  g.fill(band);
  g.fillStyle = CREAM_SHADE;
  g.fill(under);
  g.fill(speck);
  g.fillStyle = CREAM_HI;
  g.fill(lip);
  g.restore();
  g.lineJoin = 'round';
  g.lineWidth = OUTLINE;
  g.strokeStyle = INK;
  g.stroke(shape);

  // ---- one-way platforms: floating cream pills ----
  const pills = new Path2D(), pillLips = new Path2D();
  for (let y = Math.max(0, rTop); y < 18; y++) {
    let runStart = -1;
    for (let x = wx0; x <= wx1; x++) {
      const on = x < wx1 && code(x, y) === TILE_ONEWAY;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        const w = x - runStart;
        pills.roundRect(runStart + 0.02, y, w - 0.04, ONEWAY_THICK, 0.3);
        if (w - 0.56 > 0.05) pillLips.roundRect(runStart + 0.28, y + 0.13, w - 0.56, 0.1, 0.05);
        runStart = -1;
      }
    }
  }
  g.save();
  g.clip(pills);
  g.fillStyle = CREAM;
  g.fillRect(wx0, rTop - 1, wx1 - wx0, wy1 - rTop + 1);
  g.fillStyle = CREAM_SHADE;
  for (let y = Math.max(0, rTop); y < 18; y++) g.fillRect(wx0, y + ONEWAY_THICK * 0.62, wx1 - wx0, 0.5);
  g.fillStyle = CREAM_HI;
  g.fill(pillLips);
  g.restore();
  g.lineWidth = OUTLINE;
  g.stroke(pills);

  // ---- spikes (floor points up, ceiling points down) ----
  const spikes = new Path2D(), glints = new Path2D();
  const inset = 0.06, tall = 0.92;
  for (let y = Math.max(0, rTop); y < 18; y++) {
    for (let x = wx0; x < wx1; x++) {
      const t = code(x, y);
      if (t !== TILE_SPIKE && t !== TILE_CEIL_SPIKE) continue;
      const mx = x + 0.5;
      if (t === TILE_SPIKE) {
        const by = y + 1, ty = by - tall;
        spikes.moveTo(x + inset, by); spikes.lineTo(mx, ty); spikes.lineTo(x + 1 - inset, by); spikes.closePath();
        glints.moveTo(mx - 0.06, ty + 0.32); glints.lineTo(mx, ty + 0.14); glints.lineTo(mx + 0.03, ty + 0.36); glints.closePath();
      } else {
        const by = y, ty = by + tall;
        spikes.moveTo(x + inset, by); spikes.lineTo(mx, ty); spikes.lineTo(x + 1 - inset, by); spikes.closePath();
        glints.moveTo(mx - 0.06, ty - 0.32); glints.lineTo(mx, ty - 0.14); glints.lineTo(mx + 0.03, ty - 0.36); glints.closePath();
      }
    }
  }
  g.fillStyle = HAZARD;
  g.fill(spikes);
  g.lineWidth = 0.09;
  g.lineJoin = 'round';
  g.stroke(spikes);
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.fill(glints);

  return { canvas, left, top };
}
