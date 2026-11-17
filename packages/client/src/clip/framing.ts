// Clip framing: the camera layout for each clip shape. Vertical (9:16, for phones) sits the
// ground a little lower than the middle and keeps the blob nearer the center than the game
// does, so the crowd swarm and what's coming both fit; wide (16:9) is the desktop framing,
// a touch closer in.
import { computeLayout, type Layout } from '../layout.ts';

export type ClipAspect = 'vertical' | 'wide';

/** Video sizes (device pixels). */
export const EXPORT_SIZE: Readonly<Record<ClipAspect, { w: number; h: number }>> = {
  vertical: { w: 1080, h: 1920 },
  wide: { w: 1920, h: 1080 },
};

/** CSS-pixel size and pixel ratio the video is drawn at (so the HUD has its usual proportions). */
const EXPORT_CSS: Readonly<Record<ClipAspect, { w: number; h: number; dpr: number }>> = {
  vertical: { w: 432, h: 768, dpr: 2.5 },
  wide: { w: 1280, h: 720, dpr: 1.5 },
};

export const FPS = 30;

/** The layout for a clip drawn at `w`×`h` CSS pixels. */
export function clipLayout(w: number, h: number, dpr: number): Layout {
  const base = computeLayout(w, h, dpr);
  if (base.phone) {
    const tile = w / 8.6;
    const viewW = w / tile;
    return { ...base, tile, groundY: 0.62 * h, lookAhead: viewW * 0.4 };
  }
  const tile = h / 14.5;
  return { ...base, tile, groundY: 0.72 * h, lookAhead: (w / tile) * 0.36 };
}

export function exportLayout(aspect: ClipAspect): Layout {
  const c = EXPORT_CSS[aspect];
  return clipLayout(c.w, c.h, c.dpr);
}
