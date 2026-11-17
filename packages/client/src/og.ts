// Link preview image and icons, drawn by the game's own renderer on the real level 1.
// Dev-only page (og.html); tools/og-image.ts screenshots it into public/.
//   og.html            1200x630 Open Graph / Twitter card image
//   og.html?icon=512   square app icon (the blob's face) at that size
import './fonts.css';
import { LEVEL1, T_EMPTY, tileAt } from '@blobocracy/shared';
import type { Layout } from './layout.ts';
import { BLOB, CREAM, FONT_DISPLAY, FONT_TEXT, INK } from './render/palette.ts';
import { Renderer, type Scene, type SceneDot, type SceneLevel } from './render/scene.ts';
import { loadFonts } from './view.ts';

const level = LEVEL1;
const sceneLevel: SceneLevel = { width: level.width, height: level.height, tileAt: (x, y) => tileAt(level, x, y), zones: level.zones };
const P = new URLSearchParams(location.search);

/** First gap in the floor after the spawn: the blob leaps over it in the picture. */
function firstGap(): number {
  for (let x = Math.ceil(level.spawn.x) + 4; x < level.width; x++) {
    if (tileAt(level, x, 13) === T_EMPTY && tileAt(level, x, 14) === T_EMPTY) return x;
  }
  return level.spawn.x + 10;
}

function ogScene(blob: { x: number; y: number }, t: number, dots: SceneDot[]): Scene {
  return {
    level: sceneLevel,
    blob: { x: blob.x, y: blob.y, vx: 6.5, vy: -4, grounded: false, facing: 1, pull: 0.7, strain: 0.15, dead: false },
    dots,
    you: null,
    hud: { deaths: 0, deathsJustTicked: false, online: 0, record: null, progress: 0, recordLabel: '' },
    deathCard: null,
    zoneSky: 'blue',
    paused: false,
  };
}

function crowd(n: number, seed: number): SceneDot[] {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: SceneDot[] = [];
  for (let i = 0; i < n; i++) {
    const r = rnd();
    out.push({ slot: i, dir: r < 0.66 ? 1 : r < 0.84 ? -1 : 0, jump: rnd() < 0.55 });
  }
  return out;
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fill: string, stroke: number): void {
  ctx.font = font;
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawOg(canvas: HTMLCanvasElement): void {
  const W = 1200, H = 630, dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const tile = 52;
  const L: Layout = { w: W, h: H, dpr, tile, groundY: H * 0.8, lookAhead: 0, phone: false };
  const gap = firstGap();
  const blob = { x: gap + 1.2, y: 8.6 };
  const cam = { x: blob.x - (W * 0.7) / tile, y: 13 - (H * 0.84) / tile };
  const r = new Renderer();
  const dots = crowd(110, 7);
  for (let i = 0; i <= 90; i++) r.render(ctx, L, cam, ogScene(blob, i / 60, dots), 2 + i / 60, { hud: false });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // left scrim for legibility
  const g = ctx.createLinearGradient(0, 0, W * 0.62, 0);
  g.addColorStop(0, 'rgba(255,251,241,.78)');
  g.addColorStop(0.65, 'rgba(255,251,241,.45)');
  g.addColorStop(1, 'rgba(255,251,241,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  outlined(ctx, 'Blobocracy', 56, 182, `118px ${FONT_DISPLAY}`, BLOB, 16);
  ctx.fillStyle = INK;
  ctx.font = `800 40px ${FONT_TEXT}`;
  ctx.fillText('The whole internet', 60, 262);
  ctx.fillText('controls one blob.', 60, 312);
  ctx.font = `700 26px ${FONT_TEXT}`;
  ctx.fillStyle = 'rgba(42,27,61,.82)';
  ctx.fillText('One shared life. Every death resets everyone.', 60, 368);

  // pill: how to play
  const text = 'Free · no login · plays on your phone';
  ctx.font = `800 24px ${FONT_TEXT}`;
  const pw = ctx.measureText(text).width + 44, ph = 54, px = 56, py = 410;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(px, py + 5, pw, ph, ph / 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, ph / 2);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + 22, py + ph / 2 + 1);
}

/** The blob's face on a sky tile: readable at 32 px, crisp at 512. */
function drawIcon(canvas: HTMLCanvasElement, size: number): void {
  canvas.width = canvas.height = size;
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  const u = size / 100;
  const sky = ctx.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#5FBFFF');
  sky.addColorStop(1, '#CFEFFF');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, size, size);
  // ground
  ctx.fillStyle = '#FFF1D6';
  ctx.fillRect(0, 80 * u, size, 20 * u);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 78 * u, size, 4 * u);
  // body
  ctx.beginPath();
  ctx.ellipse(50 * u, 54 * u, 36 * u, 30 * u, 0, Math.PI, 0);
  ctx.lineTo(86 * u, 74 * u);
  ctx.quadraticCurveTo(86 * u, 81 * u, 79 * u, 81 * u);
  ctx.lineTo(21 * u, 81 * u);
  ctx.quadraticCurveTo(14 * u, 81 * u, 14 * u, 74 * u);
  ctx.closePath();
  ctx.fillStyle = BLOB;
  ctx.fill();
  ctx.lineWidth = 5.5 * u;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  // eyes
  for (const ex of [38, 62]) {
    ctx.beginPath();
    ctx.ellipse(ex * u, 52 * u, 8.5 * u, 10.5 * u, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 3.2 * u;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc((ex + 2.5) * u, 54 * u, 4.6 * u, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  // smile
  ctx.beginPath();
  ctx.arc(50 * u, 64 * u, 6 * u, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.lineWidth = 3.2 * u;
  ctx.lineCap = 'round';
  ctx.stroke();
}

void loadFonts().then(() => {
  const canvas = document.getElementById('og') as HTMLCanvasElement;
  const icon = Number(P.get('icon') ?? 0);
  if (icon > 0) drawIcon(canvas, icon); else drawOg(canvas);
  document.body.dataset.ready = '1';
});

