// Draws one clip frame: the game exactly as the renderer draws it (HUD without the sound and
// settings buttons), a small "blobocracy" wordmark + URL in the bottom-right corner so every
// clip carries the brand, and after the last frame a short end card ("Play at <host>").
import type { Layout } from '../layout.ts';
import { renderFrame } from '../render/frame.ts';
import { uiScale } from '../render/hud.ts';
import { BLOB, BLOB_SHADE, CREAM_HI, FONT_DISPLAY, FONT_TEXT, HAZARD, INK } from '../render/palette.ts';
import type { ClipAudioSink, ClipPlayback } from './playback.ts';

/** Seconds of end card after the clip's last frame. */
export const OUTRO_S = 2.4;

export interface ClipBrand {
  /** Shown under the wordmark and on the end card, e.g. "blobocracy.com". */
  host: string;
  /** Death count for the end card ("4,812 deaths so far"). */
  deaths: number;
}

type Ctx2D = CanvasRenderingContext2D;

/** Total length of a clip with its end card. */
export const clipLength = (pb: ClipPlayback) => pb.duration + OUTRO_S;

/**
 * Renders clip time `t` (0 … clipLength) into `ctx`, sized `L.w·dpr × L.h·dpr`.
 * Sounds for the clip's events go to `sink` (once, as time advances).
 */
export function drawClipFrame(ctx: Ctx2D, L: Layout, pb: ClipPlayback, t: number, brand: ClipBrand, sink?: ClipAudioSink): void {
  const end = pb.duration - 1e-4;
  const { scene, cam } = pb.frame(Math.min(t, end), L, sink);
  const m = brandMetrics(ctx, L, brand.host);
  scene.hud.buttons = false;
  scene.hud.barEnd = m.width + m.pad + m.gap;
  renderFrame(ctx, L, cam, scene, t);
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  if (L.phone) drawCaption(ctx, L, scene.hud.online, m);
  drawBrand(ctx, L, brand.host, m);
  if (t > end) drawOutro(ctx, L, t - end, brand);
}

interface BrandMetrics { s: number; fs: number; us: number; width: number; pad: number; gap: number; y: number }

function brandMetrics(ctx: Ctx2D, L: Layout, host: string): BrandMetrics {
  const s = uiScale(L);
  const fs = (L.phone ? 19 : 30) * s;
  const us = (L.phone ? 10.5 : 14.5) * s;
  ctx.font = `${fs.toFixed(1)}px ${FONT_DISPLAY}`;
  const ww = ctx.measureText('blobocracy').width;
  ctx.font = `800 ${us.toFixed(1)}px ${FONT_TEXT}`;
  const uw = ctx.measureText(host).width;
  const pad = (L.phone ? 16 : 28) * s;
  return { s, fs, us, width: Math.max(ww, uw), pad, gap: 16 * s, y: L.h - (L.phone ? 34 : 30) * s };
}

/**
 * Vertical clips have room under the ground line: say what the dots are, for everyone who
 * has never seen the game.
 */
function drawCaption(ctx: Ctx2D, L: Layout, online: number, m: BrandMetrics): void {
  const s = m.s;
  const cx = L.w / 2;
  const y = L.groundY + (m.y - 30 * s - L.groundY) * 0.5;
  const line1 = online === 1 ? '1 person, one blob' : `${fmt(online)} people, one blob`;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.translate(cx, y);
  ctx.rotate((-2.5 * Math.PI) / 180);
  const fs = 30 * s;
  ctx.font = `${fs.toFixed(1)}px ${FONT_DISPLAY}`;
  ctx.lineWidth = fs * 0.24;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.strokeText(line1, 0, fs * 0.08);
  ctx.fillText(line1, 0, fs * 0.08);
  ctx.strokeText(line1, 0, 0);
  ctx.fillStyle = BLOB;
  ctx.fillText(line1, 0, 0);
  const fs2 = 14.5 * s;
  ctx.font = `800 ${fs2.toFixed(1)}px ${FONT_TEXT}`;
  ctx.lineWidth = fs2 * 0.42;
  ctx.strokeText('Everyone online steers it together.', 0, fs * 0.95);
  ctx.fillStyle = CREAM_HI;
  ctx.fillText('Everyone online steers it together.', 0, fs * 0.95);
  ctx.restore();
}

/** The corner wordmark: "blobocracy" in the logo style, the site under it. */
function drawBrand(ctx: Ctx2D, L: Layout, host: string, m: BrandMetrics): void {
  const x = L.w - m.pad;
  const y = m.y + m.fs * 0.12;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.translate(x, y);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.font = `${m.fs.toFixed(1)}px ${FONT_DISPLAY}`;
  ctx.fillStyle = INK;
  ctx.lineWidth = m.fs * 0.26;
  ctx.strokeStyle = INK;
  ctx.strokeText('blobocracy', 0, m.fs * 0.1);
  ctx.fillText('blobocracy', 0, m.fs * 0.1);
  ctx.strokeText('blobocracy', 0, 0);
  ctx.fillStyle = BLOB;
  ctx.fillText('blobocracy', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.font = `800 ${m.us.toFixed(1)}px ${FONT_TEXT}`;
  ctx.lineWidth = m.us * 0.36;
  ctx.strokeStyle = INK;
  const uy = y + m.us * 1.55;
  ctx.strokeText(host, x - m.fs * 0.1, uy);
  ctx.fillStyle = CREAM_HI;
  ctx.fillText(host, x - m.fs * 0.1, uy);
  ctx.restore();
}

const back = (k: number, s = 2.2) => { const q = k - 1; return 1 + (s + 1) * q * q * q + s * q * q; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** The end card, `age` seconds after the last frame. */
function drawOutro(ctx: Ctx2D, L: Layout, age: number, brand: ClipBrand): void {
  const W = L.w, H = L.h;
  const u = Math.min(W, H * (L.phone ? 0.62 : 1.1)) / 400; // layout unit
  ctx.save();
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.86 * clamp01(age / 0.35);
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  const cx = W / 2;
  const cy = H * (L.phone ? 0.42 : 0.4);
  // the blob drops in and squashes
  const kb = clamp01((age - 0.1) / 0.45);
  if (kb > 0) {
    const r = 46 * u;
    const by = cy - 70 * u - (1 - back(kb)) * 120 * u;
    const squash = kb >= 1 ? 1 + 0.08 * Math.exp(-(age - 0.55) * 7) * Math.sin((age - 0.55) * 22) : 1;
    drawBlobFace(ctx, cx, by, r, squash, age);
  }
  // wordmark
  const kw = clamp01((age - 0.2) / 0.4);
  if (kw > 0) {
    const fs = 64 * u;
    ctx.save();
    ctx.translate(cx, cy + 30 * u);
    ctx.rotate((-3 * Math.PI) / 180);
    const sc = back(kw, 2.6);
    ctx.scale(sc, sc);
    ctx.font = `${fs.toFixed(1)}px ${FONT_DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.2;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.strokeText('Blobocracy', 0, fs * 0.09);
    ctx.fillText('Blobocracy', 0, fs * 0.09);
    ctx.strokeText('Blobocracy', 0, 0);
    ctx.fillStyle = BLOB;
    ctx.fillText('Blobocracy', 0, 0);
    ctx.restore();
  }
  // tagline + death count
  const kt = clamp01((age - 0.45) / 0.3);
  if (kt > 0) {
    ctx.globalAlpha = kt;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = CREAM_HI;
    ctx.font = `800 ${(17 * u).toFixed(1)}px ${FONT_TEXT}`;
    ctx.fillText('Everyone online steers one blob.', cx, cy + 74 * u + (1 - kt) * 8 * u);
    ctx.fillStyle = 'rgba(255,241,214,.78)';
    ctx.font = `600 ${(14 * u).toFixed(1)}px ${FONT_TEXT}`;
    ctx.fillText(`${fmt(brand.deaths)} deaths so far. Help it get further.`, cx, cy + 98 * u + (1 - kt) * 8 * u);
    ctx.globalAlpha = 1;
  }
  // the call to action
  const kc = clamp01((age - 0.7) / 0.35);
  if (kc > 0) {
    const text = `Play at ${brand.host}`;
    const font = `${(19 * u).toFixed(1)}px ${FONT_DISPLAY}`;
    ctx.font = font;
    const pw = ctx.measureText(text).width + 40 * u, ph = 46 * u;
    const py = cy + 140 * u;
    const sc = back(kc, 2.4);
    ctx.save();
    ctx.translate(cx, py);
    ctx.rotate((-2 * Math.PI) / 180);
    ctx.scale(sc, sc);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2 + 5 * u, pw, ph, ph / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    ctx.fillStyle = HAZARD;
    ctx.fill();
    ctx.lineWidth = 3.5 * u;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM_HI;
    ctx.fillText(text, 0, 1.5 * u);
    ctx.restore();
  }
  ctx.restore();
}

/** The blob's face, as on the loading screen and the favicon. */
function drawBlobFace(ctx: Ctx2D, x: number, y: number, r: number, squash: number, age: number): void {
  ctx.save();
  ctx.translate(x, y + r);
  ctx.scale(1 / squash, squash);
  ctx.translate(0, -r);
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.62, -r, r, -r * 0.5, r, r * 0.12);
    ctx.bezierCurveTo(r, r * 0.72, r * 0.62, r, 0, r);
    ctx.bezierCurveTo(-r * 0.62, r, -r, r * 0.72, -r, r * 0.12);
    ctx.bezierCurveTo(-r, -r * 0.5, -r * 0.62, -r, 0, -r);
    ctx.closePath();
  };
  ctx.fillStyle = INK;
  ctx.save();
  ctx.translate(0, r * 0.1);
  body();
  ctx.fill();
  ctx.restore();
  body();
  ctx.fillStyle = BLOB;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = BLOB_SHADE;
  ctx.beginPath();
  ctx.ellipse(0, r * 1.05, r * 1.1, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.45, -r * 0.55, r * 0.22, r * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  body();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // eyes (a blink near the end), cheeks, smile
  const blink = Math.abs(age - 1.3) < 0.07 ? 0.15 : 1;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.33, -r * 0.08, r * 0.24, r * 0.29 * blink, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = r * 0.085;
    ctx.stroke();
    if (blink > 0.5) {
      ctx.beginPath();
      ctx.arc(s * r * 0.33 + r * 0.07, -r * 0.12, r * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(s * r * 0.62, r * 0.36, r * 0.13, r * 0.075, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,90,120,.35)';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, r * 0.38);
  ctx.quadraticCurveTo(0, r * 0.62, r * 0.2, r * 0.38);
  ctx.lineWidth = r * 0.09;
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}
