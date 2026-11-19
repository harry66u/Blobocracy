// HUD exactly as the mockup: flip-card death counter, players online (top left),
// record (top right), progress bar with zone ticks, run marker, record flag, sound and
// settings buttons; plus the death card.
import type { Layout } from '../layout.ts';
import { flipFrame, FLIP_S } from '../moments.ts';
import { BLOB, CREAM, CREAM_HI, FONT_DISPLAY, FONT_TEXT, HAZARD, INK, ONLINE, type SkyPalette } from './palette.ts';
import type { SceneDeathCard, SceneHud, ShareSlot } from './scene.ts';

/** How long the death card takes to leave after the reset. */
const CARD_OUT_S = 0.35;
const RECORD_POP_S = 2.8;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** UI scale relative to the mockup's 1600×900 desktop and 390×844 phone. */
export function uiScale(L: Layout): number {
  return L.phone ? Math.min(1.35, Math.max(0.82, L.w / 390)) : Math.min(1.35, Math.max(0.62, Math.min(L.h / 900, L.w / 1600 * 1.1)));
}

export interface HudButton { kind: 'sound' | 'settings'; cx: number; cy: number; r: number }

/** The sound and settings buttons at the right end of the progress bar (CSS px). */
export function hudButtons(L: Layout): HudButton[] {
  const s = uiScale(L);
  const phone = L.phone;
  const y = L.h - (phone ? 34 : 30) * s;
  const r = (phone ? 15 : 18) * s;
  const bx = L.w - (phone ? 30 : 40) * s;
  return [
    { kind: 'sound', cx: bx - (phone ? 38 : 48) * s, cy: y, r },
    { kind: 'settings', cx: bx, cy: y, r },
  ];
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
  private lastCard: SceneDeathCard | null = null;
  /** The share button's place on the last drawn death card (null: no card, or no clip). */
  shareSlot: ShareSlot | null = null;
  private cardOutT0 = -10;
  private reduced = false;
  private readonly widths = new Map<string, number>();

  update(hud: SceneHud, card: SceneDeathCard | null, timeS: number, reduced = false): void {
    this.reduced = reduced;
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
    if (!card && this.hadCard) this.cardOutT0 = timeS;
    if (card) this.lastCard = card;
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
    // light text (night skies) gets a soft dark halo, so it still reads over cream ground and walls
    const light = pal.stars > 0.5;
    const fill = (text: string, x: number, y: number) => {
      if (light) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4 * s;
        ctx.strokeStyle = 'rgba(42,27,61,.55)';
        ctx.strokeText(text, x, y);
        ctx.restore();
      }
      ctx.fillText(text, x, y);
    };

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
    fill(online, pad + 16 * s, y1);
    ctx.font = fontSmall;
    ctx.fillStyle = pal.hudSoft;
    fill('playing now', pad, y2);
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
    fill(line1, rx, y1);
    ctx.font = fontSmall;
    ctx.fillStyle = pal.hudSoft;
    if (line2) fill(line2, rx, y2);
    const rightW = Math.max(this.measure(ctx, fontBig, line1), line2 ? this.measure(ctx, fontSmall, line2) : 0);
    const pop = hud.recordPop;
    if (pop !== null && pop !== undefined && pop >= 0 && pop < RECORD_POP_S) this.recordSticker(ctx, rx, phone ? 128 * s : y2 + 26 * s, s * (phone ? 0.9 : 1), pop);
    return pad + Math.max(leftW, rightW);
  }

  /** "New record!" sticker that pops under the record text when the run passes it. */
  private recordSticker(ctx: CanvasRenderingContext2D, right: number, y: number, s: number, t: number): void {
    const reduced = this.reduced;
    const grow = reduced ? 1 : t < 0.32 ? 1 + 2.6 * Math.pow(t / 0.32 - 1, 3) + 1.6 * Math.pow(t / 0.32 - 1, 2) : 1 + 0.04 * Math.sin((t - 0.32) * 5) * Math.exp(-(t - 0.32) * 2);
    const alpha = Math.min(1, reduced ? t / 0.25 : 1, (RECORD_POP_S - t) / 0.35);
    const font = `${(16 * s).toFixed(1)}px ${FONT_DISPLAY}`;
    const text = 'New record!';
    const tw = this.measure(ctx, font, text);
    const pw = tw + 22 * s, ph = 28 * s;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(right - pw / 2, y);
    ctx.rotate((-5 * Math.PI) / 180);
    ctx.scale(Math.max(0.01, grow), Math.max(0.01, grow));
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2 + 3 * s, pw, ph, ph / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    ctx.fillStyle = HAZARD;
    ctx.fill();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM_HI;
    ctx.fillText(text, 0, 1 * s);
    // sparkles
    if (!reduced && t < 1.4) {
      ctx.fillStyle = BLOB;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5 * s;
      for (const [dx, dy, k] of [[-0.55, -0.9, 1], [0.6, -0.8, 0.8], [0.52, 0.85, 0.7]] as const) {
        const a = Math.max(0, 1 - t / 1.4) * k;
        const sz = 6 * s * a;
        const sx = dx * pw, sy = dy * ph;
        ctx.beginPath();
        ctx.moveTo(sx, sy - sz); ctx.lineTo(sx + sz * 0.3, sy - sz * 0.3); ctx.lineTo(sx + sz, sy); ctx.lineTo(sx + sz * 0.3, sy + sz * 0.3);
        ctx.lineTo(sx, sy + sz); ctx.lineTo(sx - sz * 0.3, sy + sz * 0.3); ctx.lineTo(sx - sz, sy); ctx.lineTo(sx - sz * 0.3, sy - sz * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
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
    const cascade = hud.cascade ?? null;
    let digitIndex = 0;
    const x0Cards = x;
    const oldStr = this.prevStr;
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
      const f = (this.flipMask >> fromEnd) & 1 ? flipFrame(ft, this.reduced) : null;
      const flipping = f !== null && !f.done;
      const oldC = oldStr.length === str.length ? oldStr[i] ?? c : ' ';
      // the win: a wave of hops runs across the cards, each lighting up gold as it jumps
      const wave = cascade === null ? 0 : cascadeHop(cascade - digitIndex * 0.09);
      digitIndex++;
      const newFill = (isLast && lit) || wave > 0.05 ? BLOB : CREAM;
      // shadow stays put; the card bounces above it as the flap lands
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.roundRect(x, y + 5 * s, cw, ch, r);
      ctx.fill();
      const lift = (f ? -f.bounce * ch * 0.4 : 0) - (this.reduced ? 0 : wave * ch * 0.38);
      const card: FlapCard = { x, y: y + lift, cw, ch, r, s, font: fontDigit, fs };
      if (!flipping) {
        flapHalf(ctx, card, 'top', c, newFill, 1, 0);
        flapHalf(ctx, card, 'bottom', c, newFill, f ? 1 - Math.max(0, -f.bounce) * 0.6 : 1, 0);
      } else if (this.reduced) {
        flapHalf(ctx, card, 'top', oldC, CREAM, 1, 0);
        flapHalf(ctx, card, 'bottom', oldC, CREAM, 1, 0);
        ctx.globalAlpha = f.fade;
        flapHalf(ctx, card, 'top', c, newFill, 1, 0);
        flapHalf(ctx, card, 'bottom', c, newFill, 1, 0);
        ctx.globalAlpha = 1;
      } else {
        // behind the flaps: the new top half and the old bottom half
        flapHalf(ctx, card, 'top', c, newFill, 1, 0);
        flapHalf(ctx, card, 'bottom', oldC, CREAM, 1, f.bottom * 0.25);
        if (f.top > 0) flapHalf(ctx, card, 'top', oldC, CREAM, f.top, (1 - f.top) * 0.5);
        if (f.bottom > 0) flapHalf(ctx, card, 'bottom', c, newFill, f.bottom, (1 - f.bottom) * 0.45);
      }
      // the split line and its hinges
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(x, y + lift + ch / 2 - 1.5 * s, cw, 3 * s);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.roundRect(x - 1.5 * s, y + lift + ch / 2 - 5 * s, 4.5 * s, 10 * s, 2 * s);
      ctx.roundRect(x + cw - 3 * s, y + lift + ch / 2 - 5 * s, 4.5 * s, 10 * s, 2 * s);
      ctx.fill();
      if (isLast && lit) {
        // "+1" pops with a bounce once the top flap has gone over
        const pt = timeS - Math.max(this.tickT0, this.flipT0) - FLIP_S * 0.55;
        if (pt > 0) {
          const pop = this.reduced ? 1 : pt < 0.35 ? 1 + 0.35 * Math.sin((pt / 0.35) * Math.PI) * (1 - pt / 0.35) : 1;
          const grow = this.reduced ? 1 : Math.min(1, pt / 0.12);
          const px = x + cw * 0.5, py = y - (phone ? 6 : 10) * s - (this.reduced ? 0 : Math.min(1, pt * 3) * 3 * s);
          ctx.save();
          if (this.reduced) ctx.globalAlpha = Math.min(1, pt / 0.25);
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
    ctx.textAlign = 'center';
    const labelY = y + ch + (phone ? 24 : 32) * s0;
    const lfs = (phone ? 13 : 16) * s0;
    if (hud.levelLabel) {
      // from level 2 on: "Level 2 · deaths", the level part a touch bolder
      const a = `${hud.levelLabel}  ·  `, b = 'deaths';
      const fa = `800 ${lfs.toFixed(1)}px ${FONT_TEXT}`, fb = `700 ${lfs.toFixed(1)}px ${FONT_TEXT}`;
      const wa = this.measure(ctx, fa, a), wb = this.measure(ctx, fb, b);
      const lx = L.w / 2 - (wa + wb) / 2;
      ctx.textAlign = 'left';
      ctx.font = fa;
      ctx.fillStyle = pal.hud;
      ctx.globalAlpha = 0.8;
      ctx.fillText(a, lx, labelY);
      ctx.globalAlpha = 1;
      ctx.font = fb;
      ctx.fillStyle = pal.hudSoft;
      ctx.fillText(b, lx + wa, labelY);
      ctx.textAlign = 'center';
    } else {
      ctx.font = `700 ${lfs.toFixed(1)}px ${FONT_TEXT}`;
      ctx.fillStyle = pal.hudSoft;
      ctx.fillText('deaths', L.w / 2, labelY);
    }
    if (hud.encore) this.encoreBadge(ctx, x0Cards + total + 4 * s, y - 2 * s, s0 * (phone ? 0.82 : 1));
  }

  /** A little pink "Encore" sticker slapped on the counter's top-right corner. */
  private encoreBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
    const font = `${(14 * s).toFixed(1)}px ${FONT_DISPLAY}`;
    const tw = this.measure(ctx, font, 'Encore');
    const pw = tw + 18 * s, ph = 24 * s;
    ctx.save();
    ctx.translate(x - pw * 0.3, y);
    ctx.rotate((10 * Math.PI) / 180);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2 + 3 * s, pw, ph, ph / 2);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
    ctx.fillStyle = HAZARD;
    ctx.fill();
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM_HI;
    ctx.fillText('Encore', 0, 1 * s);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // ---- progress bar ---------------------------------------------------------
  private progress(ctx: CanvasRenderingContext2D, L: Layout, hud: SceneHud, pal: SkyPalette, s: number): void {
    const phone = L.phone;
    const y = L.h - (phone ? 34 : 30) * s;
    const buttons = hud.buttons !== false;
    const x0 = (phone ? 18 : 32) * s, x1 = L.w - (buttons ? (phone ? 82 : 110) * s : hud.barEnd ?? x0);
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
    if (buttons) for (const b of hudButtons(L)) icon(ctx, b.kind, b.cx, b.cy, b.r, b.kind === 'sound' && !!hud.muted);
  }

  // ---- death card -----------------------------------------------------------
  /** The death card: slides in when a card appears, slides out after the reset. */
  drawDeathCard(ctx: CanvasRenderingContext2D, L: Layout, timeS: number): void {
    const card = this.hadCard ? this.lastCard : timeS - this.cardOutT0 < CARD_OUT_S ? this.lastCard : null;
    this.shareSlot = null;
    if (!card) return;
    const s = uiScale(L) * (L.phone ? 1 : 1.12);
    const reduced = this.reduced;
    const t = timeS - this.cardT0;
    const out = this.hadCard ? 0 : Math.min(1, (timeS - this.cardOutT0) / CARD_OUT_S);
    const cw = Math.min(330 * s, L.w - 32);
    const mid = L.w / 2;
    const soft = 'rgba(42,27,61,.72)';
    const f15 = `700 ${(15 * s).toFixed(1)}px ${FONT_TEXT}`;
    const f13 = `600 ${(13 * s).toFixed(1)}px ${FONT_TEXT}`;
    const line1 = `Run ${fmt(card.run)} made it`;
    const big = `${Math.round(clamp01(card.progress) * 100)}%`;
    // keep hazard names together on one line ("Big Press", "Ceiling Spikes")
    const lines = wrap(ctx, f15, `of the way, ${card.line}`.replace(/\b(Big|Ceiling) /g, '$1\u00A0'), cw - 44 * s);
    const lh = 21 * s;
    const where = card.checkpoint ? `the ${Math.round(card.checkpoint * 100)}% checkpoint` : 'the start';
    const footer = card.countdown ? `Back to ${where} in ${card.countdown}` : '';
    const slotH = card.clip ? 60 * s : 0;
    const chh = 128 * s + lines.length * lh + slotH + (footer ? 30 * s : 4 * s);
    const cy0 = L.phone ? 160 * uiScale(L) : Math.max(170 * uiScale(L), L.h * 0.2);

    // in: drop from above the screen with a back-ease and a settling tilt; out: lift away
    const inK = reduced ? 1 : Math.min(1, t / 0.5);
    const back = (k: number) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
    const offY = reduced ? 0 : -(1 - back(inK)) * (cy0 + chh + 40) - out * out * (cy0 + chh + 40);
    const tiltDeg = reduced ? -2 : -2 - 7 * (1 - inK) * (1 - inK) + 2.5 * Math.exp(-Math.max(0, t - 0.4) * 5) * Math.sin(Math.max(0, t - 0.4) * 14) * (inK >= 1 ? 1 : 0) + out * 6;
    const alpha = reduced ? Math.min(1, t / 0.3) * (1 - out) : Math.min(1, t / 0.08);
    if (alpha <= 0) return;
    if (card.clip) {
      // the slot under the cause line, mapped through the card's tilt and drop
      const slotY = cy0 + 130 * s + (lines.length - 1) * lh + 14 * s + slotH / 2;
      const dy = slotY - (cy0 + chh / 2), th = (tiltDeg * Math.PI) / 180;
      this.shareSlot = {
        x: mid - dy * Math.sin(th), y: cy0 + chh / 2 + offY + dy * Math.cos(th),
        w: Math.min(206 * s, cw - 40 * s), h: 44 * s, rotDeg: tiltDeg, alpha, scale: s,
      };
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(mid, cy0 + chh / 2 + offY);
    ctx.rotate((tiltDeg * Math.PI) / 180);
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
    lines.forEach((ln, i) => ctx.fillText(ln, mid, cy0 + 130 * s + i * lh));
    if (footer) {
      const fy = cy0 + 130 * s + (lines.length - 1) * lh + 30 * s + slotH;
      ctx.strokeStyle = 'rgba(42,27,61,.18)';
      ctx.lineWidth = 2 * s;
      ctx.setLineDash([2 * s, 5 * s]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx0 + 26 * s, fy - 19 * s);
      ctx.lineTo(cx0 + cw - 26 * s, fy - 19 * s);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = f13;
      ctx.fillStyle = soft;
      ctx.fillText(footer, mid, fy);
    }
    if (card.nearRecord) {
      // a pink "So close." sticker slapped on the top-left corner
      const st = reduced ? 1 : Math.min(1, Math.max(0, (t - 0.35) / 0.25));
      if (st > 0) {
        const pop = reduced ? 1 : back(st);
        const font = `${(17 * s).toFixed(1)}px ${FONT_DISPLAY}`;
        const tw = this.measure(ctx, font, 'So close.');
        const pw = tw + 24 * s, ph = 32 * s;
        ctx.save();
        ctx.translate(cx0 + 18 * s + pw / 2, cy0 - 2 * s);
        ctx.rotate((-9 * Math.PI) / 180);
        ctx.scale(pop, pop);
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.roundRect(-pw / 2, -ph / 2 + 3.5 * s, pw, ph, ph / 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2);
        ctx.fillStyle = HAZARD;
        ctx.fill();
        ctx.lineWidth = 3 * s;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.font = font;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = CREAM_HI;
        ctx.fillText('So close.', 0, 1.5 * s);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

interface FlapCard { x: number; y: number; cw: number; ch: number; r: number; s: number; font: string; fs: number }

/**
 * One half of a split-flap card, folded about the hinge line: `scaleY` 1 is flat,
 * 0 edge-on. `shade` darkens it as it turns away from the light.
 */
function flapHalf(ctx: CanvasRenderingContext2D, c: FlapCard, half: 'top' | 'bottom', glyph: string, fill: string, scaleY: number, shade: number): void {
  const hinge = c.y + c.ch / 2;
  const pad = 4 * c.s;
  ctx.save();
  ctx.beginPath();
  if (half === 'top') ctx.rect(c.x - pad, c.y - pad - c.ch, c.cw + pad * 2, c.ch * 1.5 + pad);
  else ctx.rect(c.x - pad, hinge, c.cw + pad * 2, c.ch * 1.5 + pad);
  ctx.clip();
  // a hint of perspective: the flap grows a little wider as it swings toward us
  const widen = 1 + 0.1 * Math.sin(Math.acos(Math.min(1, Math.max(0, scaleY))));
  ctx.translate(c.x + c.cw / 2, hinge);
  ctx.scale(widen, Math.max(0.001, scaleY));
  ctx.translate(-(c.x + c.cw / 2), -hinge);
  ctx.beginPath();
  ctx.roundRect(c.x, c.y, c.cw, c.ch, c.r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (glyph.trim()) {
    ctx.font = c.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.fillText(glyph, c.x + c.cw / 2, c.y + c.ch / 2 + c.fs * 0.35);
  }
  if (shade > 0.005) {
    ctx.fillStyle = `rgba(42,27,61,${Math.min(0.8, shade).toFixed(3)})`;
    ctx.fill();
  }
  ctx.lineWidth = 3 * c.s;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, font: string, text: string, maxW: number): string[] {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return [text];
  // two lines: split where the longer line is shortest (no lonely last word)
  const words = text.split(' ');
  let best: string[] | null = null, bestW = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (w <= maxW && w < bestW) { best = [a, b]; bestW = w; }
  }
  if (best) return best;
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

/** One card's hop in the win wave, 0..1 (up and back down with a little bounce). */
function cascadeHop(t: number): number {
  if (t <= 0 || t >= 0.62) return 0;
  const k = t / 0.62;
  return Math.sin(k * Math.PI) * (1 - 0.25 * k) + (k > 0.7 ? 0.1 * Math.sin((k - 0.7) * 20) * (1 - k) : 0);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function icon(ctx: CanvasRenderingContext2D, kind: 'sound' | 'settings', cx: number, cy: number, r: number, muted = false): void {
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
    if (muted) {
      ctx.moveTo(6, -4.5); ctx.lineTo(12, 4.5);
      ctx.moveTo(12, -4.5); ctx.lineTo(6, 4.5);
    } else {
      ctx.moveTo(5.5, -5); ctx.quadraticCurveTo(9, 0, 5.5, 5);
      ctx.moveTo(8.5, -8); ctx.quadraticCurveTo(14, 0, 8.5, 8);
    }
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
