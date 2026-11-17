// Sky gradient, stars, sun/moon, parallax clouds and rounded hills, plus the dark
// gradient that makes pits read as deadly. Cross-fades between skies over ~2 s.
import type { Layout } from '../layout.ts';
import { GROUND_ROW } from '../layout.ts';
import { SKIES, parseColor, rgba, type SkyPalette } from './palette.ts';
import type { Sky } from './scene.ts';

const COLOR_FIELDS = ['top', 'bot', 'hillFar', 'hillNear', 'sun', 'cloud', 'hud', 'hudSoft'] as const;
type ColorField = (typeof COLOR_FIELDS)[number];
const NUM = COLOR_FIELDS.length * 4 + 2; // + stars + cloudAlpha
const TRANSITION_S = 2;

function encode(p: SkyPalette, out: Float64Array): Float64Array {
  const tmp = [0, 0, 0, 1];
  COLOR_FIELDS.forEach((f, i) => {
    parseColor(p[f], tmp);
    out[i * 4] = tmp[0]!; out[i * 4 + 1] = tmp[1]!; out[i * 4 + 2] = tmp[2]!; out[i * 4 + 3] = tmp[3]!;
  });
  out[NUM - 2] = p.stars;
  out[NUM - 1] = p.cloudAlpha;
  return out;
}

const ENCODED: Record<Sky, Float64Array> = {
  blue: encode(SKIES.blue, new Float64Array(NUM)),
  sunset: encode(SKIES.sunset, new Float64Array(NUM)),
  purple: encode(SKIES.purple, new Float64Array(NUM)),
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Tiny deterministic PRNG so star fields and clouds are stable between frames. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLOUD_PARTS: readonly (readonly [number, number, number])[] = [[0, 0, 1], [-0.9, 0.25, 0.7], [0.95, 0.2, 0.75], [0.35, -0.35, 0.8], [-0.4, -0.25, 0.65]];

export class Background {
  /** Current blended palette, readable by the HUD (hud / hudSoft colors). */
  readonly pal: SkyPalette = { ...SKIES.blue };
  private readonly from = new Float64Array(NUM);
  private readonly to = new Float64Array(NUM);
  private readonly cur = new Float64Array(NUM);
  private target: Sky | null = null;
  private t0 = 0;
  private settled = false;

  private skyGrad: CanvasGradient | null = null;
  private skyGradKey = '';
  private glowGrad: CanvasGradient | null = null;
  private glowKey = '';
  private stars: HTMLCanvasElement | OffscreenCanvas | null = null;
  private starsKey = '';

  update(sky: Sky, timeS: number): void {
    if (this.target === null) {
      this.target = sky;
      this.cur.set(ENCODED[sky]);
      this.settled = false;
      this.writePalette();
      this.settled = true;
      return;
    }
    if (sky !== this.target) {
      this.from.set(this.cur);
      this.to.set(ENCODED[sky]);
      this.target = sky;
      this.t0 = timeS;
      this.settled = false;
    }
    if (this.settled) return;
    const t = Math.min(1, Math.max(0, (timeS - this.t0) / TRANSITION_S));
    const k = smooth(t);
    for (let i = 0; i < NUM; i++) this.cur[i] = this.from[i]! + (this.to[i]! - this.from[i]!) * k;
    this.writePalette();
    if (t >= 1) this.settled = true;
  }

  private writePalette(): void {
    const c = this.cur;
    COLOR_FIELDS.forEach((f: ColorField, i) => {
      this.pal[f] = rgba(c[i * 4]!, c[i * 4 + 1]!, c[i * 4 + 2]!, c[i * 4 + 3]!);
    });
    this.pal.stars = c[NUM - 2]!;
    this.pal.cloudAlpha = c[NUM - 1]!;
  }

  draw(ctx: CanvasRenderingContext2D, L: Layout, camX: number, camY: number, timeS: number): void {
    const { w, h, tile: T } = L;
    const p = this.pal;

    // sky
    const gk = `${h}|${p.top}|${p.bot}`;
    if (gk !== this.skyGradKey || !this.skyGrad) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, p.top);
      g.addColorStop(1, p.bot);
      this.skyGrad = g;
      this.skyGradKey = gk;
    }
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, w, h);

    // stars
    if (p.stars > 0.01) this.drawStars(ctx, L, timeS);

    // sun / moon
    const sunX = L.phone ? w * 0.74 : w * 0.7;
    const sunY = L.phone ? L.groundY * 0.652 : L.groundY * 0.606;
    const sunR = L.phone ? w * 0.118 : h * 0.102;
    const glk = `${sunX}|${sunY}|${sunR}|${p.sun}`;
    if (glk !== this.glowKey || !this.glowGrad) {
      const g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.4);
      const s = parseColor(p.sun);
      g.addColorStop(0, rgba(s[0]!, s[1]!, s[2]!, 0.9));
      g.addColorStop(1, rgba(s[0]!, s[1]!, s[2]!, 0));
      this.glowGrad = g;
      this.glowKey = glk;
    }
    ctx.fillStyle = this.glowGrad;
    ctx.fillRect(sunX - sunR * 2.4, sunY - sunR * 2.4, sunR * 4.8, sunR * 4.8);
    ctx.fillStyle = p.sun;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    if (p.stars > 0.01) {
      // moon craters, fading in with the purple sky
      ctx.globalAlpha = p.stars * 0.16;
      ctx.fillStyle = '#8A4DB3';
      ctx.beginPath();
      ctx.arc(sunX - sunR * 0.32, sunY - sunR * 0.18, sunR * 0.2, 0, Math.PI * 2);
      ctx.moveTo(sunX + sunR * 0.4, sunY + sunR * 0.28);
      ctx.arc(sunX + sunR * 0.28, sunY + sunR * 0.28, sunR * 0.12, 0, Math.PI * 2);
      ctx.moveTo(sunX + sunR * 0.18, sunY - sunR * 0.45);
      ctx.arc(sunX + sunR * 0.1, sunY - sunR * 0.45, sunR * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // clouds (parallax 0.2, slow drift)
    this.drawClouds(ctx, L, camX, timeS);

    // hills: two rounded layers
    const groundScreen = (GROUND_ROW - camY) * T;
    const vshift = groundScreen - L.groundY;
    this.hills(ctx, L, p.hillFar, L.groundY - T * 1.2 + vshift * 0.15, T * 3.2, 2.6, 1.3, 0.15, camX);
    this.hills(ctx, L, p.hillNear, L.groundY - T * 0.2 + vshift * 0.3, T * 2.0, 1.7, 4.1, 0.3, camX);

    // pits darken toward the bottom (platforms are drawn over this)
    const pitTop = (GROUND_ROW + 1.5 - camY) * T;
    if (pitTop < h) {
      const g = ctx.createLinearGradient(0, pitTop, 0, Math.max(pitTop + T * 3, h));
      g.addColorStop(0, 'rgba(42,27,61,0)');
      g.addColorStop(1, 'rgba(42,27,61,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, pitTop, w, h - pitTop);
    }
  }

  private hills(ctx: CanvasRenderingContext2D, L: Layout, color: string, baseY: number, amp: number, period: number, phase: number, par: number, camX: number): void {
    const { w, h, tile: T } = L;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-10, h);
    for (let x = -10; x <= w + 10; x += 6) {
      const wx = x / T + camX * par;
      const y = baseY - amp * (0.55 + 0.45 * Math.sin(wx / period + phase)) - amp * 0.25 * Math.sin(wx / (period * 0.37) + phase * 2);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w + 10, h);
    ctx.closePath();
    ctx.fill();
  }

  private drawClouds(ctx: CanvasRenderingContext2D, L: Layout, camX: number, timeS: number): void {
    const { w, h, tile: T } = L;
    const p = this.pal;
    // [x fraction, y fraction, size] from the mockup's placements
    const defs = L.phone
      ? [[70 / 390, 250 / 844, 26 / 390], [300 / 390, 330 / 844, 20.8 / 390], [560 / 390, 190 / 844, 22 / 390]]
      : [[230 / 1600, 230 / 900, 46 / 900], [980 / 1600, 170 / 900, 36.8 / 900], [1420 / 1600, 330 / 900, 32.2 / 900], [1900 / 1600, 260 / 900, 40 / 900]];
    const span = L.phone ? w * 2.1 : w * 1.45;
    ctx.globalAlpha = p.cloudAlpha;
    ctx.fillStyle = p.cloud;
    ctx.beginPath();
    for (const d of defs) {
      const k = d[2]! * (L.phone ? w : h);
      const base = d[0]! * w - camX * T * 0.2 - timeS * T * 0.08;
      const cx = ((base % span) + span) % span - k * 2;
      const cy = d[1]! * h;
      for (const [dx, dy, r] of CLOUD_PARTS) {
        const x = cx + dx * k, y = cy + dy * k, rr = r * k * 0.75;
        ctx.moveTo(x + rr, y);
        ctx.arc(x, y, rr, 0, Math.PI * 2);
      }
      ctx.roundRect(cx - 1.5 * k, cy + 0.05 * k, 3 * k, 0.55 * k, 0.27 * k);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawStars(ctx: CanvasRenderingContext2D, L: Layout, timeS: number): void {
    const key = `${L.w}|${L.h}|${L.dpr}`;
    if (key !== this.starsKey || !this.stars) {
      this.stars = renderStars(L);
      this.starsKey = key;
    }
    ctx.globalAlpha = this.pal.stars;
    ctx.drawImage(this.stars as CanvasImageSource, 0, 0, L.w, L.h);
    // a few twinkling bright ones
    const rnd = mulberry(4242);
    ctx.fillStyle = '#FFF3DC';
    const n = L.phone ? 6 : 12;
    for (let i = 0; i < n; i++) {
      const x = rnd() * L.w, y = rnd() * L.groundY * 0.7, ph = rnd() * 6.28, sp = 1 + rnd() * 2;
      const a = 0.5 + 0.5 * Math.sin(timeS * sp + ph);
      ctx.globalAlpha = this.pal.stars * a;
      const s = 2.2 + a * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s * 0.4, y - s * 0.4); ctx.lineTo(x + s * 1.6, y);
      ctx.lineTo(x + s * 0.4, y + s * 0.4); ctx.lineTo(x, y + s * 1.6); ctx.lineTo(x - s * 0.4, y + s * 0.4);
      ctx.lineTo(x - s * 1.6, y); ctx.lineTo(x - s * 0.4, y - s * 0.4); ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function renderStars(L: Layout): HTMLCanvasElement | OffscreenCanvas {
  const cw = Math.max(1, Math.round(L.w * L.dpr)), ch = Math.max(1, Math.round(L.h * L.dpr));
  const c = makeCanvas(cw, ch);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(L.dpr, L.dpr);
  const rnd = mulberry(7);
  const n = L.phone ? 40 : 110;
  g.fillStyle = '#FFF3DC';
  for (let i = 0; i < n; i++) {
    const r = rnd() < 0.15 ? 1.8 : 1;
    const x = rnd() * L.w, y = rnd() * L.groundY * 0.75;
    g.globalAlpha = 0.35 + rnd() * 0.6;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

