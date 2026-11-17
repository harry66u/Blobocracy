// HUD exactly as the mockup: flip-card death counter, players online (top left),
// record (top right), progress bar with zone ticks, run marker, record flag, sound and
// settings buttons; plus the death card.
import type { Layout } from '../layout.ts';
import { BLOB, CREAM, FONT_DISPLAY, FONT_TEXT, HAZARD, INK, ONLINE, type SkyPalette } from './palette.ts';
import type { SceneDeathCard, SceneHud } from './scene.ts';

const FLIP_S = 0.42;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** UI scale relative to the mockup's 1600×900 desktop and 390×844 phone. */
export function uiScale(L: Layout): number {
  return L.phone ? Math.min(1.35, Math.max(0.82, L.w / 390)) : Math.min(1.35, Math.max(0.62, Math.min(L.h / 900, L.w / 1600 * 1.1)));
}

export class HudView {
  private shown = -1;
  private prevStr = '';
  private flipT0 = -10;
  private flipMask = 0;
  private ticked = false;
  private tickT0 = -10;
  private cardT0 = -10;
  private hadCard = false;
  private readonly widths = new Map<string, number>();
  /** CSS-px bottom edge (shadow included) of the last death card drawn, so DOM controls can sit under it. */
  cardBottom = 0;

  update(hud: SceneHud, card: SceneDeathCard | null, timeS: number): void {
    if (this.shown < 0) {
      this.shown = hud.deaths;
      this.prevStr = fmt(hud.deaths);
    }
    if (hud.deaths !== this.shown) {
      const a = fmt(this.shown), b = fmt(hud.deaths);
      this.flipMask = 0;
      for (let k = 0; k < b.length; k++) {
        if (a.length !== b.length || a[a.length - 1 - k] !== b[b.length - 1 - k]) this.flipMask |= 1 << k;
      }
      this.prevStr = a;
      this.shown = hud.deaths;
      this.flipT0 = timeS;
    }
    if (hud.deathsJustTicked && !this.ticked) this.tickT0 = timeS;
    this.ticked = hud.deathsJustTicked;
    if (card && !this.hadCard) this.cardT0 = timeS;
    this.hadCard = card !== null;
  }

  private measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
    const k = font + '|' + text;
    let w = this.widths.get(k);
    if (w === undefined) {
      ctx.font = font;
      w = ctx.measureText(text).width;
      if (this.widths.size > 200) this.widths.clear();
      this.widths.set(k, w);
    }
    return w;
  }

  draw(ctx: CanvasRenderingContext2D, L: Layout, hud: SceneHud, pal: SkyPalette, timeS: number): void {
    const s = uiScale(L);
    const cornerW = this.corners(ctx, L, hud, pal, s);
    this.counter(ctx, L, hud, pal, s, cornerW, timeS);
    this.progress(ctx, L, hud, pal, s);
  }

  // ---- corners --------------------------------------------------------------
  private corners(ctx: CanvasRenderingContext2D, L: Layout, hud: SceneHud, pal: SkyPalette, s: number): number {
    const phone = L.phone;
    const fs = (phone ? 12 : 16) * s, fsBig = (phone ? 14 : 19) * s;
    const pad = (phone ? 16 : 32) * s, top = (phone ? 64 : 42) * s;
    const fontBig = `800 ${fsBig.toFixed(1)}px ${FONT_TEXT}`;
    const fontSmall = `600 ${fs.toFixed(1)}px ${FONT_TEXT}`;
    const y1 = top + fsBig * 0.36, y2 = y1 + fs * 1.45;
    ctx.textBaseline = 'alphabetic';

    // players online
    const online = fmt(hud.online);
    ctx.beginPath();
    ctx.arc(pad + 5 * s, top - fsBig * 0.02 + 5 * s - fsBig * 0.3, 5 * s, 0, Math.PI * 2);
    ctx.fillStyle = ONLINE;
    ctx.fill();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = fontBig;
    ctx.fillStyle = pal.hud;
    ctx.fillText(online, pad + 16 * s, y1);
    ctx.font = fontSmall;
    ctx.fillStyle = pal.hudSoft;
    ctx.fillText('playing now', pad, y2);
    const leftW = Math.max(16 * s + this.measure(ctx, fontBig, online), this.measure(ctx, fontSmall, 'playing now'));

    // record
    const rx = L.w - pad;
    const line1 = hud.record ? `Record ${Math.round(hud.record.progress * 100)}%` : 'No record yet';
    let line2 = hud.recordLabel || (hud.record ? `run ${fmt(hud.record.run)}` : '');
    const room = L.w / 2 - (phone ? 88 : 180) * s - pad;
    if (line2.includes(',') && this.measure(ctx, fontSmall, line2) > room) {
      // drop trailing clauses ("run 3,940, nine days ago" -> "run 3,940") while keeping digit groups
      const m = line2.match(/^(.*?\d)(, [^\d].*)$/);
      if (m) line2 = m[1]!;
    }
    ctx.textAlign = 'right';
    ctx.font = fontBig;
    ctx.fillStyle = pal.hud;
    ctx.fillText(line1, rx, y1);
    ctx.font = fontSmall;
    ctx.fillStyle = pal.hudSoft;
    if (line2) ctx.fillText(line2, rx, y2);
    const rightW = Math.max(this.measure(ctx, fontBig, line1), line2 ? this.measure(ctx, fontSmall, line2) : 0);
    return pad + Math.max(leftW, rightW);
  }

  // ---- flip counter ---------------------------------------------------------
  private counter(ctx: CanvasRenderingContext2D, L: Layout, hud: SceneHud, pal: SkyPalette, s0: number, cornerW: number, timeS: number): void {
    const phone = L.phone;
    const str = fmt(hud.deaths);
    let s = s0;
    const natural = (sc: number) => {
      let t = 0;
      for (const c of str) t += c === ',' ? (phone ? 10 : 16) * sc : ((phone ? 36 : 58) + (phone ? 5 : 7)) * sc;
      return t - (phone ? 5 : 7) * sc;
    };
    const avail = L.w - 2 * (cornerW + 10 * s0);
    if (natural(s) > avail) s = Math.max(0.5, s * (avail / natural(s)));
    const cw = (phone ? 36 : 58) * s, ch = (phone ? 52 : 80) * s, gap = (phone ? 5 : 7) * s, fs = (phone ? 36 : 58) * s;
    const comma = (phone ? 10 : 16) * s;
    const total = natural(s);
    let x = L.w / 2 - total / 2;
    const y = (phone ? 58 : 34) * s0;
    const r = 12 * s;
    const fontDigit = `${fs.toFixed(1)}px ${FONT_DISPLAY}`;
    const ft = timeS - this.flipT0;
    const lit = hud.deathsJustTicked;
    const chars = str;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!;
      if (c === ',') {
        ctx.font = `${(fs * 0.7).toFixed(1)}px ${FONT_DISPLAY}`;
        ctx.fillStyle = pal.hud;
        ctx.fillText(',', x + comma / 2, y + ch - (phone ? 4 : 6) * s);
        x += comma;
        continue;
      }
      const fromEnd = chars.length - 1 - i;
      const isLast = fromEnd === 0;
      const flipping = (this.flipMask >> fromEnd) & 1 && ft < FLIP_S + 0.35;
      let scaleY = 1, showOld = false;
      if (flipping) {
        if (ft < FLIP_S) {
          const p = ft / FLIP_S;
          scaleY = Math.abs(Math.cos(p * Math.PI));
          showOld = p < 0.5;
        } else {
          const q = ft - FLIP_S;
          scaleY = 1 + 0.12 * Math.exp(-q * 12) * Math.sin(q * 30);
        }
      }
      const oldStr = this.prevStr;
      const oldC = oldStr.length === str.length ? oldStr[i] ?? c : c;
      const glyph = showOld ? oldC : c;
      const cardLit = isLast && lit && !showOld;
      // shadow stays put; the card itself flips around its hinge line
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.roundRect(x, y + 5 * s, cw, ch, r);
      ctx.fill();
      ctx.save();
      ctx.translate(0, y + ch / 2);
      ctx.scale(1, Math.max(0.02, scaleY));
      ctx.translate(0, -(y + ch / 2));
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, r);
      ctx.fillStyle = cardLit ? BLOB : CREAM;
      ctx.fill();
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.font = fontDigit;
      ctx.fillStyle = INK;
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + fs * 0.35);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y + ch / 2 - 1.5 * s, cw, 3 * s);
      ctx.globalAlpha = 1;
      ctx.restore();
      // hinges
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.roundRect(x - 1.5 * s, y + ch / 2 - 5 * s, 4.5 * s, 10 * s, 2 * s);
      ctx.roundRect(x + cw - 3 * s, y + ch / 2 - 5 * s, 4.5 * s, 10 * s, 2 * s);
      ctx.fill();
      if (isLast && lit) {
        // "+1" pops with a bounce once the card has flipped
        const pt = timeS - Math.max(this.tickT0, this.flipT0) - FLIP_S * 0.5;
        if (pt > 0) {
          const pop = pt < 0.35 ? 1 + 0.35 * Math.sin((pt / 0.35) * Math.PI) * (1 - pt / 0.35) : 1;
          const grow = Math.min(1, pt / 0.12);
          const px = x + cw * 0.5, py = y - (phone ? 6 : 10) * s - Math.min(1, pt * 3) * 3 * s;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate((12 * Math.PI) / 180);
          ctx.scale(grow * pop, grow * pop);
          ctx.font = `${((phone ? 17 : 24) * s).toFixed(1)}px ${FONT_DISPLAY}`;
          ctx.lineJoin = 'round';
          ctx.lineWidth = 4 * s;
          ctx.strokeStyle = INK;
          ctx.strokeText('+1', 0, 0);
          ctx.fillStyle = BLOB;
          ctx.fillText('+1', 0, 0);
          ctx.restore();
        }
      }
      x += cw + gap;
    }
    ctx.font = `700 ${((phone ? 13 : 16) * s0).toFixed(1)}px ${FONT_TEXT}`;
    ctx.fillStyle = pal.hudSoft;
    ctx.fillText('deaths', L.w / 2, y + ch + (phone ? 24 : 32) * s0);
  }

  // ---- progress bar ---------------------------------------------------------
  private progress(ctx: CanvasRenderingContext2D, L: Layout, hud: SceneHud, pal: SkyPalette, s: number): void {
    const phone = L.phone;
    const y = L.h - (phone ? 34 : 30) * s;
    const x0 = (phone ? 18 : 32) * s, x1 = L.w - (phone ? 82 : 110) * s;
    const w = x1 - x0;
    const th = 8 * s;
    const run = clamp01(hud.progress);
    ctx.beginPath();
    ctx.roundRect(x0, y - th / 2, w, th, th / 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (run > 0) {
      ctx.beginPath();
      ctx.roundRect(x0 + s, y - th / 2 + s, Math.max(th - 2 * s, w * run), th - 2 * s, (th - 2 * s) / 2);
      ctx.fillStyle = BLOB;
      ctx.fill();
    }
    // zone ticks
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.8;
    for (let i = 1; i < 6; i++) ctx.fillRect(x0 + (w * i) / 6 - s, y - th / 2 - 3 * s, 2 * s, th + 6 * s);
    ctx.globalAlpha = 1;
    // record flag
    if (hud.record) {
      const fx = x0 + w * clamp01(hud.record.progress);
      const fh = (phone ? 16 : 20) * s;
      ctx.beginPath();
      ctx.moveTo(fx, y + th / 2);
      ctx.lineTo(fx, y - fh);
      ctx.lineWidth = 2.2 * s;
      ctx.lineCap = 'round';
      ctx.strokeStyle = pal.hud;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx, y - fh);
      ctx.lineTo(fx + fh * 0.75, y - fh + fh * 0.28);
      ctx.lineTo(fx, y - fh + fh * 0.56);
      ctx.closePath();
      ctx.fillStyle = HAZARD;
      ctx.fill();
      ctx.lineWidth = 2 * s;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    // run marker: a tiny blob
    const mx = x0 + w * run, mr = (phone ? 6 : 7.5) * s;
    ctx.beginPath();
    ctx.arc(mx, y, mr, 0, Math.PI * 2);
    ctx.fillStyle = BLOB;
    ctx.fill();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx + mr * 0.25, y - mr * 0.15, mr * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    // sound + settings
    const bx = L.w - (phone ? 30 : 40) * s;
    icon(ctx, 'settings', bx, y, (phone ? 15 : 18) * s);
    icon(ctx, 'sound', bx - (phone ? 38 : 48) * s, y, (phone ? 15 : 18) * s);
  }

  // ---- death card -----------------------------------------------------------
  drawDeathCard(ctx: CanvasRenderingContext2D, L: Layout, card: SceneDeathCard, timeS: number): void {
    const s = uiScale(L) * (L.phone ? 1 : 1.12);
    const t = timeS - this.cardT0;
    const inK = Math.min(1, t / 0.4);
    const back = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    const drop = (1 - back(inK)) * 60 * s;
    const cw = Math.min(318 * s, L.w - 32);
    const mid = L.w / 2;
    const soft = 'rgba(42,27,61,.7)';
    const f15 = `700 ${(15 * s).toFixed(1)}px ${FONT_TEXT}`;
    const line1 = `${card.nearRecord ? 'So close. ' : ''}Run ${fmt(card.run)} made it`;
    const big = `${Math.floor(clamp01(card.progress) * 100)}%`; // floor: 99.6% never reads as 100%
    const tail = `of the way, then the ${card.cause} got it.`;
    const lines = wrap(ctx, f15, tail, cw - 40 * s);
    const lh = 21 * s;
    const chh = 132 * s + lines.length * lh;
    const cy0 = L.phone ? 160 * uiScale(L) : Math.max(170 * uiScale(L), L.h * 0.2);
    ctx.save();
    ctx.globalAlpha = Math.min(1, t / 0.15);
    ctx.translate(mid, cy0 + chh / 2 + drop);
    ctx.rotate((-2 * Math.PI) / 180 * (0.5 + 0.5 * inK));
    ctx.translate(-mid, -(cy0 + chh / 2));
    const cx0 = mid - cw / 2;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(cx0, cy0 + 6 * s, cw, chh, 22 * s);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx0, cy0, cw, chh, 22 * s);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.lineWidth = 3.5 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f15;
    ctx.fillStyle = soft;
    ctx.fillText(line1, mid, cy0 + 38 * s);
    ctx.font = `${(62 * s).toFixed(1)}px ${FONT_DISPLAY}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7 * s;
    ctx.strokeStyle = INK;
    ctx.strokeText(big, mid, cy0 + 100 * s);
    ctx.fillStyle = BLOB;
    ctx.fillText(big, mid, cy0 + 100 * s);
    ctx.font = f15;
    ctx.fillStyle = INK;
    lines.forEach((ln, i) => ctx.fillText(ln, mid, cy0 + 132 * s + i * lh));
    ctx.restore();
    this.cardBottom = cy0 + chh + 6 * s;
  }
}

function wrap(ctx: CanvasRenderingContext2D, font: string, text: string, maxW: number): string[] {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function icon(ctx: CanvasRenderingContext2D, kind: 'sound' | 'settings', cx: number, cy: number, r: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = CREAM;
  ctx.fill();
  ctx.lineWidth = 2.5 * (r / 18);
  ctx.strokeStyle = INK;
  ctx.stroke();
  const k = r / 18;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  if (kind === 'sound') {
    ctx.beginPath();
    ctx.moveTo(-8, -4); ctx.lineTo(-4, -4); ctx.lineTo(2, -9); ctx.lineTo(2, 9); ctx.lineTo(-4, 4); ctx.lineTo(-8, 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(5.5, -5); ctx.quadraticCurveTo(9, 0, 5.5, 5);
    ctx.moveTo(8.5, -8); ctx.quadraticCurveTo(14, 0, 8.5, 8);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-8, -4.5); ctx.lineTo(8, -4.5);
    ctx.moveTo(-8, 4.5); ctx.lineTo(8, 4.5);
    ctx.stroke();
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(-3, -4.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.5, 4.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
