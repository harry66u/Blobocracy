// "Share the clip" on the death card (spec §12 death moment, §13). The sim announces a clip
// for a run ({ t: 'clip', id, kind, run }) at the death; while that run's card is up, a yellow
// pill link to /c/<id> sits in the slot the card makes for it, moving with the card.
import type { ServerEvent } from '@blobocracy/shared';
import { BLOB, INK } from './render/palette.ts';
import type { SceneDeathCard, ShareSlot } from './render/scene.ts';

type ClipEvent = Extract<ServerEvent, { t: 'clip' }>;

/** Remembers the newest clip per run (only the last few runs matter). */
export class ClipBook {
  private byRun = new Map<number, ClipEvent>();
  add(e: ClipEvent): void {
    this.byRun.set(e.run, e);
    if (this.byRun.size > 8) this.byRun.delete(this.byRun.keys().next().value!);
  }
  forRun(run: number): ClipEvent | null { return this.byRun.get(run) ?? null; }
}

/** The card with room for the button when its run has a clip. */
export function withClip(card: SceneDeathCard | null, book: ClipBook): SceneDeathCard | null {
  return card && book.forRun(card.run) ? { ...card, clip: true } : card;
}

export const clipHref = (id: string) => `/c/${encodeURIComponent(id)}`;

const STYLE = `
.bl-share{position:fixed;left:0;top:0;z-index:8;display:flex;align-items:center;justify-content:center;gap:.45em;box-sizing:border-box;
  border:3px solid ${INK};border-radius:999px;background:${BLOB};color:${INK};box-shadow:0 4px 0 ${INK};text-decoration:none;white-space:nowrap;
  font:400 17px/1 'Bagel Fat One','Atkinson Hyperlegible Next',system-ui,sans-serif;letter-spacing:.2px;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transform-origin:50% 50%}
.bl-share svg{width:1.1em;height:1.1em;flex:none}
.bl-share:hover{filter:brightness(1.04)}
.bl-share:active{box-shadow:0 1px 0 ${INK};margin-top:3px}
.bl-share:focus-visible{outline:3px solid ${INK};outline-offset:3px}
.bl-share[hidden]{display:none}
`;
const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>`;

/** The button; `place` each frame with the card's slot (null hides it). */
export function mountShareButton(root: HTMLElement) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const a = document.createElement('a');
  a.className = 'bl-share';
  a.target = '_blank';
  a.rel = 'noopener';
  a.hidden = true;
  a.innerHTML = `${ICON}<span>Share the clip</span>`;
  root.append(style, a);
  let shownId = '';
  return {
    el: a,
    place(slot: ShareSlot | null, clip: ClipEvent | null): void {
      if (!slot || !clip || slot.alpha <= 0.02) { if (!a.hidden) a.hidden = true; return; }
      if (shownId !== clip.id) {
        shownId = clip.id;
        a.href = clipHref(clip.id);
        a.setAttribute('aria-label', `Share the clip of run ${clip.run.toLocaleString('en-US')}`);
      }
      a.hidden = false;
      a.style.width = `${slot.w}px`;
      a.style.height = `${slot.h}px`;
      a.style.fontSize = `${(17 * slot.scale).toFixed(1)}px`;
      a.style.opacity = String(Math.min(1, slot.alpha));
      a.style.transform = `translate(${(slot.x - slot.w / 2).toFixed(1)}px, ${(slot.y - slot.h / 2).toFixed(1)}px) rotate(${slot.rotDeg.toFixed(2)}deg)`;
    },
  };
}
