// "Level 2 unlocked": the moment after the celebration. The last frame of the beaten level
// shrinks into a polaroid and flies off while a burst of light shifts the sky; the new
// level slides in as a second polaroid, then grows to fill the screen, under a big banner
// with its name. Reduced motion: a crossfade and the banner, no zoom or slide.
import type { Layout } from '../layout.ts';
import { LEVELUP_S, type LevelUpFrame } from '../moments.ts';
import { Confetti, drawBanner } from './fx.ts';
import { uiScale } from './hud.ts';
import { CREAM_HI, FONT_DISPLAY, HAZARD, INK, SKIES } from './palette.ts';
import type { Sky } from './scene.ts';
import { drawRays } from './win.ts';

export interface LevelUpInfo { levelId: number; name: string; encore: boolean; age: number }

type AnyCanvas = HTMLCanvasElement;

function canvasLike(w: number, h: number): AnyCanvas {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class LevelUpView {
  private snap: AnyCanvas | null = null;
  private off: AnyCanvas | null = null;
  private oldCaption = '';
  private confetti = new Confetti(260);
  private bannerPopped = false;
  private lastAge = -1;

  /** Freeze the frame on `src` (the beaten level as it is now) for the card that flies away. */
  capture(src: HTMLCanvasElement, caption: string): void {
    if (!src.width || !src.height) return;
    this.snap = canvasLike(src.width, src.height);
    this.snap.getContext('2d')!.drawImage(src, 0, 0);
    this.oldCaption = caption;
    this.bannerPopped = false;
    this.lastAge = -1;
    this.confetti.clear();
  }

  get ready(): boolean { return this.snap !== null; }

  /** Forget the snapshot (the transition is over). */
  end(): void {
    this.snap = null;
    this.off = null;
  }

  /**
   * One frame of the transition on `g` (the visible canvas): the background burst, both
   * cards and the banner. `renderNew` draws the new level's live frame into the context it is given.
   */
  draw(g: CanvasRenderingContext2D, L: Layout, f: LevelUpFrame, info: LevelUpInfo, newSky: Sky, reduced: boolean, timeS: number, renderNew: (ctx: CanvasRenderingContext2D) => void): void {
    const pw = Math.round(L.w * L.dpr), ph = Math.round(L.h * L.dpr);
    if (!this.off || this.off.width !== pw || this.off.height !== ph) this.off = canvasLike(pw, ph);
    const offCtx = this.off.getContext('2d')!;
    renderNew(offCtx);
    const s = uiScale(L);
    const dt = this.lastAge < 0 ? 0 : Math.max(0, Math.min(0.1, info.age - this.lastAge));
    this.lastAge = info.age;

    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.globalAlpha = 1;
    if (reduced) {
      // a crossfade, then the banner
      if (this.snap && f.oldAlpha > 0) g.drawImage(this.snap, 0, 0, L.w, L.h);
      g.globalAlpha = f.newAlpha;
      g.drawImage(this.off, 0, 0, L.w, L.h);
      g.globalAlpha = 1;
    } else {
      // the sky shifts behind the cards: a burst of light from the old world's colors to the new one's
      const sky = SKIES[newSky];
      const shift = Math.min(1, info.age / 1.6);
      const bgGrad = g.createRadialGradient(L.w / 2, L.h * 0.45, 0, L.w / 2, L.h * 0.45, Math.hypot(L.w, L.h) * 0.6);
      bgGrad.addColorStop(0, '#FFF3C4');
      bgGrad.addColorStop(0.35, shift < 0.5 ? '#FFD86B' : sky.bot);
      bgGrad.addColorStop(1, shift < 0.5 ? SKIES.purple.bot : sky.top);
      g.fillStyle = bgGrad;
      g.fillRect(0, 0, L.w, L.h);
      drawRays(g, L.w / 2, L.h * 0.45, Math.hypot(L.w, L.h) * 0.75, timeS * 0.6, 0.5, 18);
      if (this.snap && f.oldAlpha > 0) this.card(g, L, this.snap, f.oldScale, f.oldX, f.oldRot, f.frame, this.oldCaption, true, s);
      if (f.newAlpha > 0) this.card(g, L, this.off, f.newScale, f.newX, f.newRot, f.frame, info.encore ? `Encore: ${info.name}` : `Level ${info.levelId}: ${info.name}`, false, s);
    }

    if (f.banner !== null) {
      if (!this.bannerPopped) {
        this.bannerPopped = true;
        this.confetti.burstTop(L, reduced, info.levelId * 31 + 7, 1.4);
      }
      drawBanner(g, L, {
        id: 9000 + info.levelId, index: 0, name: info.name, age: f.banner, life: LEVELUP_S - 1.5 - 0.1, big: true,
        label: info.encore ? 'Encore!' : `Level ${info.levelId} unlocked!`,
      }, reduced, Infinity);
    }
    this.confetti.update(dt, L.h);
    this.confetti.draw(g, s);
  }

  /** A polaroid of a whole view: the picture, a cream frame with a caption strip, a shadow. */
  private card(g: CanvasRenderingContext2D, L: Layout, img: AnyCanvas, scale: number, xFrac: number, rot: number, frameK: number, caption: string, beaten: boolean, s: number): void {
    g.save();
    g.translate(L.w / 2 + xFrac * L.w, L.h / 2);
    g.rotate(rot);
    g.scale(scale, scale);
    const b = (16 * s) / scale * frameK;
    const cap = (L.phone ? 46 : 54) * s / scale * frameK;
    const x0 = -L.w / 2, y0 = -L.h / 2;
    if (frameK > 0.01) {
      g.fillStyle = 'rgba(42,27,61,.35)';
      g.beginPath();
      g.roundRect(x0 - b + 10 * s / scale, y0 - b + 14 * s / scale, L.w + 2 * b, L.h + b + cap, 10 * s / scale);
      g.fill();
      g.fillStyle = CREAM_HI;
      g.beginPath();
      g.roundRect(x0 - b, y0 - b, L.w + 2 * b, L.h + b + cap, 10 * s / scale);
      g.fill();
      g.lineWidth = 4 * s / scale;
      g.strokeStyle = INK;
      g.stroke();
    }
    g.drawImage(img, x0, y0, L.w, L.h);
    if (frameK > 0.01) {
      g.lineWidth = 3 * s / scale;
      g.strokeStyle = INK;
      g.strokeRect(x0, y0, L.w, L.h);
      // the caption, hand-written on the strip
      g.globalAlpha = Math.min(1, frameK * 1.5);
      const fs = (L.phone ? 22 : 26) * s / scale;
      g.font = `${fs.toFixed(1)}px ${FONT_DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = INK;
      g.fillText(caption, 0, y0 + L.h + cap / 2, L.w * 0.86);
      if (beaten) {
        // a pink "Beaten!" stamp across the corner
        const k = Math.min(1, (L.w * 0.3) / (150 * s));
        const sw = 150 * s * k / scale, sh = 46 * s * k / scale;
        g.save();
        g.translate(x0 + L.w - sw * 0.55, y0 + sh * 0.9);
        g.rotate(-0.22);
        g.fillStyle = INK;
        g.beginPath();
        g.roundRect(-sw / 2, -sh / 2 + 4 * s / scale, sw, sh, sh / 2);
        g.fill();
        g.fillStyle = HAZARD;
        g.beginPath();
        g.roundRect(-sw / 2, -sh / 2, sw, sh, sh / 2);
        g.fill();
        g.lineWidth = 3 * s / scale;
        g.stroke();
        g.fillStyle = CREAM_HI;
        g.font = `${(24 * s * k / scale).toFixed(1)}px ${FONT_DISPLAY}`;
        g.fillText('Beaten!', 0, 2 * s / scale);
        g.restore();
      }
    }
    g.restore();
  }
}
