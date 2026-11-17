// The share image (1080x1350) and the clip's end card (1080x1920): the actual moment of
// death drawn by the game's renderer, with a cream card on top in the HUD's visual language.
import { TICK_HZ, type Level, type StateFrame } from '@blobocracy/shared';
import { computeLayout, type Layout } from '../layout.ts';
import { BLOB, CREAM, FONT_DISPLAY, FONT_TEXT, HAZARD, INK, ONLINE } from '../render/palette.ts';
import { BOTTOM_ROW } from '../render/level.ts';
import { Renderer, type SceneLevel } from '../render/scene.ts';
import { frameAt, replayScene } from './replay.ts';
import { causeName, crowdPhrase, fmt, pct, statsLine, type DeathShare } from './words.ts';

export const IMAGE_W = 1080, IMAGE_H = 1350;
export const CLIP_W = 1080, CLIP_H = 1920;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const yieldToGame = () => new Promise<void>((r) => setTimeout(r, 0));

/** A camera that keeps the blob centered and `blobAt` (0..1) of the way down the frame. */
export function centeredCam(L: Layout, blob: { x: number; y: number }, blobAt: number): { x: number; y: number } {
  const rows = L.h / L.tile;
  const y = Math.min(blob.y - (L.h * blobAt) / L.tile, BOTTOM_ROW - rows);
  return { x: blob.x - (L.w / L.tile) / 2, y };
}

/**
 * Renders the death moment (no HUD) into a canvas of w x h device pixels. The renderer is
 * warmed up over the second before the death so the crowd and the blob's squash look exactly
 * as they did; work is split into small slices so the live game never hitches.
 */
export async function renderDeathMoment(
  level: Level, sceneLevel: SceneLevel, frames: readonly StateFrame[], deathTick: number,
  w: number, h: number, blobAt: number, afterDeathS = 0.45,
): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const tDeath = deathTick / TICK_HZ;
  const t0 = Math.max(frames[0]!.tick / TICK_HZ, tDeath - 1.2), t1 = tDeath + afterDeathS;
  // Zoom in just enough that the blob sits `blobAt` down the frame without the camera
  // looking below the level (pit deaths happen low down).
  const base = computeLayout(w / 2, h / 2, 2);
  const deadY = frameAt(frames, t1).y;
  const maxRows = Math.max(4, (BOTTOM_ROW - deadY) / (1 - blobAt));
  const L: Layout = { ...base, tile: Math.min(base.h / 6, Math.max(base.tile, base.h / maxRows)) };
  const r = new Renderer();
  for (let t = t0, i = 0; t <= t1 + 1e-6; t += 1 / 30, i++) {
    const s = frameAt(frames, t);
    r.render(ctx, L, centeredCam(L, s, blobAt), replayScene(level, sceneLevel, frames, t, null), t, { hud: false });
    if (i % 6 === 5) await yieldToGame();
  }
  return canvas;
}

// ---- drawing helpers ---------------------------------------------------------

function outlined(ctx: Ctx, text: string, x: number, y: number, font: string, fill: string, stroke: number): void {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function wrap(ctx: Ctx, font: string, text: string, maxW: number): string[] {
  ctx.font = font;
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Cream rounded rectangle with a plum outline and a hard drop shadow, like the death card. */
function card(ctx: Ctx, x: number, y: number, w: number, h: number, u: number, fill = CREAM): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(x, y + 6 * u, w, h, 22 * u);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 22 * u);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function pill(ctx: Ctx, cx: number, cy: number, text: string, font: string, u: number, dot: string | null): void {
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const dotW = dot ? 18 * u : 0;
  const w = tw + dotW + 28 * u, h = 34 * u;
  const x = cx - w / 2;
  ctx.beginPath();
  ctx.roundRect(x, cy - h / 2, w, h, h / 2);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (dot) {
    ctx.beginPath();
    ctx.arc(x + 14 * u + 5 * u, cy, 6 * u, 0, Math.PI * 2);
    ctx.fillStyle = dot;
    ctx.fill();
    ctx.lineWidth = 2 * u;
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 14 * u + dotW, cy + u);
}

/** Level progress bar with zone ticks, the run's reach and the blob marker. */
function progressBar(ctx: Ctx, x0: number, x1: number, y: number, progress: number, zones: number, u: number): void {
  const th = 12 * u, w = x1 - x0, p = Math.max(0, Math.min(1, progress));
  ctx.beginPath();
  ctx.roundRect(x0, y - th / 2, w, th, th / 2);
  ctx.fillStyle = '#FFFBF1';
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (p > 0) {
    ctx.beginPath();
    ctx.roundRect(x0 + 1.5 * u, y - th / 2 + 1.5 * u, Math.max(th - 3 * u, w * p - 3 * u), th - 3 * u, (th - 3 * u) / 2);
    ctx.fillStyle = BLOB;
    ctx.fill();
  }
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.8;
  for (let i = 1; i < zones; i++) ctx.fillRect(x0 + (w * i) / zones - u, y - th / 2 - 4 * u, 2 * u, th + 8 * u);
  ctx.globalAlpha = 1;
  const mx = x0 + w * p, mr = 10 * u;
  ctx.beginPath();
  ctx.arc(mx, y, mr, 0, Math.PI * 2);
  ctx.fillStyle = BLOB;
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // X eyes: this blob is dead
  ctx.lineWidth = 1.8 * u;
  ctx.lineCap = 'round';
  for (const ex of [-3.5, 3.5]) {
    const cx = mx + ex * u, cy = y - 1.5 * u, k = 2 * u;
    ctx.beginPath();
    ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
    ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k);
    ctx.stroke();
  }
}

/** Measures how tall the death card will be for a given width (CSS-ish units × u). */
function cardBody(ctx: Ctx, d: DeathShare, x: number, y: number, w: number, u: number, zones: number, draw: boolean): number {
  const mid = x + w / 2;
  const f17 = `700 ${17 * u}px ${FONT_TEXT}`;
  const tail = `of the way, then the ${causeName(d.cause)} got it.`;
  const lines = wrap(ctx, f17, tail, w - 56 * u);
  const me = statsLine(d.stats);
  let cy = y + 44 * u;
  if (draw) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f17;
    ctx.fillStyle = 'rgba(42,27,61,.72)';
    ctx.fillText(`Run ${fmt(d.run)} made it`, mid, cy);
    outlined(ctx, pct(d.progress), mid, cy + 86 * u, `${96 * u}px ${FONT_DISPLAY}`, BLOB, 10 * u);
  }
  cy += 86 * u + 36 * u;
  if (draw) {
    ctx.font = f17;
    ctx.fillStyle = INK;
    lines.forEach((ln, i) => ctx.fillText(ln, mid, cy + i * 24 * u));
  }
  cy += (lines.length - 1) * 24 * u + 38 * u;
  if (draw) progressBar(ctx, x + 30 * u, x + w - 30 * u, cy, d.progress, zones, u);
  cy += 34 * u;
  if (draw) {
    ctx.font = `600 ${14 * u}px ${FONT_TEXT}`;
    ctx.fillStyle = 'rgba(42,27,61,.72)';
    ctx.fillText(`Zone ${d.zoneIndex + 1} of ${zones}: ${d.zoneName}`, mid, cy);
  }
  if (me) {
    cy += 22 * u;
    if (draw) {
      ctx.strokeStyle = 'rgba(42,27,61,.18)';
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([6 * u, 6 * u]);
      ctx.beginPath();
      ctx.moveTo(x + 30 * u, cy);
      ctx.lineTo(x + w - 30 * u, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    cy += 34 * u;
    if (draw) {
      const label = 'Me ';
      ctx.font = `800 ${16 * u}px ${FONT_TEXT}`;
      const lw = ctx.measureText(label).width;
      ctx.font = `700 ${16 * u}px ${FONT_TEXT}`;
      const mw = ctx.measureText(me).width;
      const total = 22 * u + lw + mw;
      let lx = mid - total / 2;
      ctx.beginPath();
      ctx.arc(lx + 7 * u, cy - 5.5 * u, 7 * u, 0, Math.PI * 2);
      ctx.fillStyle = BLOB;
      ctx.fill();
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = INK;
      ctx.stroke();
      lx += 22 * u;
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
      ctx.font = `800 ${16 * u}px ${FONT_TEXT}`;
      ctx.fillText(label, lx, cy);
      ctx.font = `700 ${16 * u}px ${FONT_TEXT}`;
      ctx.fillText(me, lx + lw, cy);
      ctx.textAlign = 'center';
    }
  }
  return cy + 30 * u - y;
}

function soClose(ctx: Ctx, x: number, y: number, u: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((8 * Math.PI) / 180);
  ctx.font = `${22 * u}px ${FONT_DISPLAY}`;
  const w = ctx.measureText('So close!').width + 30 * u, h = 40 * u;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 12 * u);
  ctx.fillStyle = HAZARD;
  ctx.fill();
  ctx.lineWidth = 3 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = CREAM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('So close!', 0, 2 * u);
  ctx.restore();
}

/** The "blob death #1,234" sticker: its own card, so it reads over any scene. */
function deathHeader(ctx: Ctx, cx: number, cy: number, d: DeathShare, u: number): number {
  const num = `#${fmt(d.death)}`;
  const label = 'blob death';
  const fLabel = `800 ${18 * u}px ${FONT_TEXT}`, fNum = `${50 * u}px ${FONT_DISPLAY}`;
  ctx.font = fLabel;
  const lw = ctx.measureText(label).width;
  ctx.font = fNum;
  const nw = ctx.measureText(num).width;
  const gap = 14 * u, padX = 22 * u, h = 72 * u;
  const w = lw + gap + nw + padX * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((2 * Math.PI) / 180);
  card(ctx, -w / 2, -h / 2, w, h, u);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = fLabel;
  ctx.fillStyle = INK;
  ctx.fillText(label, -w / 2 + padX, 2 * u);
  outlined(ctx, num, -w / 2 + padX + lw + gap, 5 * u, fNum, BLOB, 8 * u);
  ctx.restore();
  return h;
}

function wordmark(ctx: Ctx, x: number, y: number, u: number, align: CanvasTextAlign = 'left'): void {
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  outlined(ctx, 'Blobocracy', x, y, `${28 * u}px ${FONT_DISPLAY}`, CREAM, 7 * u);
}

/**
 * Overlay for one death: wordmark, crowd size, death number, the card and the footer.
 * `layout` 'post' is the 4:5 share image; 'story' is the 9:16 clip end card.
 */
export function drawShareOverlay(ctx: Ctx, W: number, H: number, d: DeathShare, host: string, zones: number, layout: 'post' | 'story'): void {
  const u = W / 540;
  const steer = crowdPhrase(d);
  ctx.save();
  // soft scrims so text reads over any sky
  const top = ctx.createLinearGradient(0, 0, 0, 220 * u);
  top.addColorStop(0, 'rgba(255,251,241,.55)');
  top.addColorStop(1, 'rgba(255,251,241,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 220 * u);

  wordmark(ctx, 24 * u, 48 * u, u);
  ctx.font = `800 ${15 * u}px ${FONT_TEXT}`;
  const pw = ctx.measureText(steer).width + 46 * u;
  pill(ctx, W - 22 * u - pw / 2, 38 * u, steer, `800 ${15 * u}px ${FONT_TEXT}`, u, ONLINE);

  const cardW = W - 48 * u;
  const cardH = cardBody(ctx, d, 24 * u, 0, cardW, u, zones, false);
  const footerH = 70 * u;
  const cardY = layout === 'post' ? H - footerH - cardH - 8 * u : 330 * u;
  deathHeader(ctx, W / 2, layout === 'post' ? 118 * u : 240 * u, d, u);

  const cx = W / 2, cyMid = cardY + cardH / 2;
  ctx.save();
  ctx.translate(cx, cyMid);
  ctx.rotate((-1.5 * Math.PI) / 180);
  ctx.translate(-cx, -cyMid);
  card(ctx, 24 * u, cardY, cardW, cardH, u);
  cardBody(ctx, d, 24 * u, cardY, cardW, u, zones, true);
  if (d.nearRecord) soClose(ctx, W - 92 * u, cardY + 8 * u, u);
  ctx.restore();

  // footer: where to play
  const fy = layout === 'post' ? H - footerH / 2 + 2 * u : cardY + cardH + 120 * u;
  if (layout === 'story') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    outlined(ctx, 'Play with us', W / 2, fy - 20 * u, `${40 * u}px ${FONT_DISPLAY}`, CREAM, 8 * u);
  }
  const font = `800 ${(layout === 'post' ? 19 : 24) * u}px ${FONT_TEXT}`;
  const sub = layout === 'post' ? `${host}  ·  everyone steers the same blob` : host;
  pill(ctx, W / 2, layout === 'post' ? fy : fy + 34 * u, sub, font, u * (layout === 'post' ? 1.15 : 1.4), null);
  ctx.restore();
}

/** The complete 1080x1350 share image as a PNG blob. */
export async function renderShareImage(
  level: Level, sceneLevel: SceneLevel, frames: readonly StateFrame[], deathTick: number, d: DeathShare, host: string,
): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const canvas = await renderDeathMoment(level, sceneLevel, frames, deathTick, IMAGE_W, IMAGE_H, 0.27);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawShareOverlay(ctx, IMAGE_W, IMAGE_H, d, host, level.zones.length, 'post');
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  return { canvas, blob };
}
