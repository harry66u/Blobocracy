// Per-clip link-preview images (spec §12 "Link previews"), rendered on the sim when a clip is
// made and stored with it, so edges stay stateless and a shared link always has its picture.
//
// Why a composed card and not the clip's key frame: drawing the real game frame on the server
// would mean a headless browser (hundreds of MB, seconds per image) next to the 60 Hz sim. A
// 1200x630 card drawn with @napi-rs/canvas (Skia, prebuilt binaries, no system libraries) takes
// a few milliseconds plus an off-thread PNG encode, and carries what a preview needs: the death
// card's big percentage, the cause line, the blob, the sky of the zone it reached, and the brand.
// If the native module can't load, clips simply have no image and pages fall back to /og.png.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deathLine, type ReplayKind, type Sky } from '@blobocracy/shared';

export interface OgCard {
  run: number;
  progress: number;
  cause: string;
  kind: ReplayKind;
  deaths: number;
  sky: Sky;
  /** Zone boundaries in progress units (for the ticks on the bar). */
  zoneStarts: number[];
  /** Record the run is measured against (the old one for a new record). */
  record: number | null;
}

const INK = '#2A1B3D', CREAM = '#FFF1D6', CREAM_HI = '#FFFBF1', CREAM_SHADE = '#F2D8AE', BLOB = '#FFD21F', BLOB_SHADE = '#F2B300', PINK = '#FF3B7A';
const SKY: Record<Sky, { top: string; bot: string; far: string; near: string; sun: string; cloud: string }> = {
  blue: { top: '#5FBFFF', bot: '#CFEFFF', far: '#A9DDF7', near: '#86CBEF', sun: '#FFF6C9', cloud: '#FFFFFF' },
  sunset: { top: '#FF7E5F', bot: '#FFD49A', far: '#F8A877', near: '#EC8662', sun: '#FFF0B8', cloud: '#FFE7CF' },
  purple: { top: '#2B1655', bot: '#8A4DB3', far: '#5E3592', near: '#472476', sun: '#F4E9FF', cloud: '#B88DDA' },
};
const DISPLAY = 'Bagel Fat One', TEXT = 'Atkinson Hyperlegible Next';
export const OG_W = 1200, OG_H = 630;

type Canvas = typeof import('@napi-rs/canvas');
let lib: Promise<Canvas | null> | null = null;

function fontsDir(): string | null {
  const candidates = [
    process.env.FONTS_DIR,
    fileURLToPath(new URL('../../client/public/fonts/', import.meta.url)),
    fileURLToPath(new URL('../../client/dist/fonts/', import.meta.url)),
  ];
  return candidates.find((d): d is string => !!d && existsSync(`${d}/bagel-fat-one-latin.woff2`)) ?? null;
}

/** Loads the canvas module and the game's fonts once; null if unavailable (no images then). */
export function loadCanvas(): Promise<Canvas | null> {
  lib ??= import('@napi-rs/canvas').then((m) => {
    const dir = fontsDir();
    if (dir) {
      m.GlobalFonts.registerFromPath(`${dir}/bagel-fat-one-latin.woff2`, DISPLAY);
      m.GlobalFonts.registerFromPath(`${dir}/atkinson-hyperlegible-next-latin.woff2`, TEXT);
    } else console.warn('[og] game fonts not found: preview images use fallback fonts');
    return m;
  }).catch((e: unknown) => {
    console.warn(`[og] @napi-rs/canvas unavailable, clips get no preview image: ${String(e)}`);
    return null;
  });
  return lib;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
export const STICKER: Record<ReplayKind, string> = { record: 'New record!', near_miss: 'So close.', win: 'We did it!' };

/** The PNG for a clip; null when the canvas module is unavailable. */
export async function renderClipOg(c: OgCard): Promise<Uint8Array | null> {
  const m = await loadCanvas();
  if (!m) return null;
  const canvas = m.createCanvas(OG_W, OG_H);
  const g = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  drawCard(g, c);
  return new Uint8Array(await canvas.encode('png'));
}

/** Greedy wrap, then narrowed while it keeps the same number of lines (no lonely last word). */
function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  let best = wrapAt(g, text, max);
  for (let w = max - 10; w > max * 0.5; w -= 10) {
    const t = wrapAt(g, text, w);
    if (t.length !== best.length) break;
    best = t;
  }
  return best;
}

function wrapAt(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function hill(g: CanvasRenderingContext2D, y: number, amp: number, freq: number, phase: number, color: string) {
  g.beginPath();
  g.moveTo(0, OG_H);
  for (let x = 0; x <= OG_W; x += 20) g.lineTo(x, y + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.35);
  g.lineTo(OG_W, OG_H);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  for (const [dx, dy, r] of [[0, 0, 26], [30, -14, 32], [64, -2, 26], [34, 8, 26]] as const) { g.moveTo(x + (dx + r) * s, y + dy * s); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); }
  g.fill();
  g.restore();
}

/** The blob from the loading screen's SVG (viewBox -44 -84 88 88), feet at (x, y). */
function blob(g: CanvasRenderingContext2D, x: number, y: number, s: number, mood: 'happy' | 'worried') {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = 'rgba(42,27,61,.22)';
  g.beginPath(); g.ellipse(0, 2, 36, 7, 0, 0, Math.PI * 2); g.fill();
  const body = () => { g.beginPath(); g.moveTo(0, -78); g.bezierCurveTo(25, -78, 40, -58, 40, -34); g.bezierCurveTo(40, -10, 26, 0, 0, 0); g.bezierCurveTo(-26, 0, -40, -10, -40, -34); g.bezierCurveTo(-40, -58, -25, -78, 0, -78); g.closePath(); };
  body(); g.fillStyle = BLOB; g.fill();
  g.save(); body(); g.clip();
  g.beginPath(); g.moveTo(-38, -22); g.bezierCurveTo(-30, 2, 30, 2, 39, -22); g.bezierCurveTo(36, -4, 22, 0, 0, 0); g.bezierCurveTo(-22, 0, -36, -6, -38, -22); g.fillStyle = BLOB_SHADE; g.fill();
  g.restore();
  g.save(); g.translate(-20, -60); g.rotate(-35 * Math.PI / 180); g.globalAlpha = 0.85; g.fillStyle = '#fff'; g.beginPath(); g.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); g.fill(); g.restore();
  body(); g.lineWidth = 5; g.strokeStyle = INK; g.lineJoin = 'round'; g.stroke();
  const worried = mood === 'worried';
  for (const ex of [-13, 13]) {
    g.beginPath(); g.ellipse(ex, -44, 10, worried ? 13 : 12, 0, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3.5; g.stroke();
    g.beginPath(); g.arc(ex + (worried ? 0 : 3), worried ? -43 : -47, worried ? 3.2 : 5, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  }
  g.fillStyle = 'rgba(255,90,120,.3)';
  for (const cx of [-24, 24]) { g.beginPath(); g.ellipse(cx, -26, 5, 3, 0, 0, Math.PI * 2); g.fill(); }
  g.lineWidth = 3.5; g.lineCap = 'round'; g.strokeStyle = INK;
  if (worried) {
    // worried brows: inner ends raised
    g.beginPath(); g.moveTo(-23, -59); g.lineTo(-6, -65); g.stroke();
    g.beginPath(); g.moveTo(6, -65); g.lineTo(23, -59); g.stroke();
    g.beginPath(); g.ellipse(0, -22, 4.5, 6, 0, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
    g.fillStyle = '#9FE4FF'; g.beginPath(); g.moveTo(34, -66); g.quadraticCurveTo(41, -55, 34, -52); g.quadraticCurveTo(27, -55, 34, -66); g.fill(); g.lineWidth = 2.5; g.stroke();
  } else {
    g.beginPath(); g.moveTo(-9, -26); g.quadraticCurveTo(0, -15, 9, -26); g.stroke();
  }
  g.restore();
}

function outlined(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke: number) {
  g.lineJoin = 'round';
  g.lineWidth = stroke;
  g.strokeStyle = INK;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

function pill(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  g.fillStyle = INK; g.beginPath(); g.roundRect(x, y + 6, w, h, h / 2); g.fill();
  g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
  g.lineWidth = 4.5; g.strokeStyle = INK; g.stroke();
}

export function drawCard(g: CanvasRenderingContext2D, c: OgCard): void {
  const sky = SKY[c.sky];
  const grad = g.createLinearGradient(0, 0, 0, OG_H);
  grad.addColorStop(0, sky.top); grad.addColorStop(1, sky.bot);
  g.fillStyle = grad; g.fillRect(0, 0, OG_W, OG_H);
  // sun with halos, clouds, two hill layers
  g.fillStyle = sky.sun;
  for (const [r, a] of [[150, 0.18], [118, 0.35], [86, 1]] as const) { g.globalAlpha = a; g.beginPath(); g.arc(980, 210, r, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  if (c.sky === 'purple') {
    g.fillStyle = '#FFF3DC';
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 46; i++) { const sx = rnd() * OG_W, sy = rnd() * 340; g.globalAlpha = 0.3 + rnd() * 0.6; g.beginPath(); g.arc(sx, sy, 1.2 + rnd() * 2.2, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  cloud(g, 760, 100, 1.1, sky.cloud, c.sky === 'purple' ? 0.35 : 0.85);
  cloud(g, 1080, 380, 0.8, sky.cloud, c.sky === 'purple' ? 0.35 : 0.85);
  hill(g, 400, 34, 0.006, 0.5, sky.far);
  hill(g, 470, 26, 0.008, 2.1, sky.near);

  // the ground the blob stands on (a cream platform, as in the game)
  const gy = 500;
  g.fillStyle = INK; g.beginPath(); g.roundRect(770, gy + 7, 470, 200, 26); g.fill();
  const plat = g.createLinearGradient(0, gy, 0, OG_H);
  plat.addColorStop(0, CREAM_HI); plat.addColorStop(0.08, CREAM_HI); plat.addColorStop(0.09, CREAM); plat.addColorStop(1, CREAM_SHADE);
  g.fillStyle = plat; g.beginPath(); g.roundRect(770, gy, 470, 200, 26); g.fill(); g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
  blob(g, 960, gy, 2.9, c.kind === 'near_miss' ? 'worried' : 'happy');

  // the wordmark
  g.save();
  g.translate(1150, 92); g.rotate(-3 * Math.PI / 180);
  g.font = `64px "${DISPLAY}"`; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillStyle = INK; g.fillText('Blobocracy', 0, 7);
  outlined(g, 'Blobocracy', 0, 0, BLOB, 12);
  g.restore();

  // the death card
  const cx = 70, cy = 92, cw = 620;
  g.font = `700 32px "${TEXT}"`;
  const lines = wrap(g, c.kind === 'win' ? 'and beat the whole level!' : `of the way, ${deathLine(c.cause, c.run)}`.replace(/\b(Big|Ceiling) /g, '$1 '), cw - 90);
  const ch = 280 + lines.length * 42;
  g.save();
  g.translate(cx + cw / 2, cy + ch / 2); g.rotate(-2 * Math.PI / 180); g.translate(-(cx + cw / 2), -(cy + ch / 2));
  g.fillStyle = INK; g.beginPath(); g.roundRect(cx, cy + 11, cw, ch, 38); g.fill();
  g.fillStyle = CREAM; g.beginPath(); g.roundRect(cx, cy, cw, ch, 38); g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = `700 34px "${TEXT}"`; g.fillStyle = 'rgba(42,27,61,.72)';
  g.fillText(`Run ${fmt(c.run)} made it`, cx + cw / 2, cy + 72);
  g.font = `150px "${DISPLAY}"`;
  g.fillStyle = INK; g.fillText(`${Math.round(c.progress * 100)}%`, cx + cw / 2, cy + 226);
  outlined(g, `${Math.round(c.progress * 100)}%`, cx + cw / 2, cy + 218, BLOB, 16);
  g.font = `700 32px "${TEXT}"`; g.fillStyle = INK;
  lines.forEach((ln, i) => g.fillText(ln, cx + cw / 2, cy + 272 + i * 42));
  // sticker
  g.save();
  g.translate(cx + 34, cy - 6); g.rotate(-8 * Math.PI / 180);
  g.font = `36px "${DISPLAY}"`;
  const label = STICKER[c.kind];
  const sw = g.measureText(label).width + 48;
  pill(g, 0, -30, sw, 60, c.kind === 'near_miss' ? PINK : BLOB);
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = c.kind === 'near_miss' ? CREAM_HI : INK;
  g.fillText(label, 24, 2);
  g.restore();
  g.restore();

  // the level's progress bar along the bottom, zone ticks and the record flag
  const bx = 70, by = 580, bw = 660, bh = 22;
  g.fillStyle = INK; g.beginPath(); g.roundRect(bx, by + 5, bw, bh, bh / 2); g.fill();
  g.fillStyle = CREAM_HI; g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
  g.fillStyle = BLOB; g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * c.progress), bh, bh / 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = INK; g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.stroke();
  g.lineWidth = 3;
  for (const z of c.zoneStarts) { if (z <= 0 || z >= 1) continue; g.beginPath(); g.moveTo(bx + bw * z, by + 4); g.lineTo(bx + bw * z, by + bh - 4); g.stroke(); }
  if (c.record !== null && c.record > 0) {
    const fx = bx + bw * Math.min(1, c.record);
    g.beginPath(); g.moveTo(fx, by + bh / 2); g.lineTo(fx, by - 26); g.stroke();
    g.fillStyle = PINK; g.beginPath(); g.moveTo(fx, by - 26); g.lineTo(fx + 24, by - 19); g.lineTo(fx, by - 11); g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(bx + bw * c.progress, by + bh / 2, 13, 0, Math.PI * 2); g.fillStyle = BLOB; g.fill(); g.lineWidth = 4; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `34px "${DISPLAY}"`; g.fillStyle = INK;
  const dn = fmt(c.deaths);
  g.fillText(dn, 806, 600);
  const dw = g.measureText(dn).width;
  g.font = `700 24px "${TEXT}"`; g.fillStyle = 'rgba(42,27,61,.72)';
  g.fillText('deaths so far', 806 + dw + 10, 598);
}
