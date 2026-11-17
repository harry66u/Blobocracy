// Colors from the approved mockup (design/mockups/mockup.html, cartoon theme).
import type { Sky } from './scene.ts';

export const INK = '#2A1B3D';
export const CREAM = '#FFF1D6';
export const CREAM_SHADE = '#F2D8AE';
export const CREAM_HI = '#FFFBF1';
/** Cream with the shade laid over it at 55%, the body color of thick ground. */
export const CREAM_BODY = mixHex(CREAM, CREAM_SHADE, 0.55);
export const HAZARD = '#FF3B7A';
export const HAZARD_DARK = '#D61F5C';
export const BLOB = '#FFD21F';
export const BLOB_SHADE = '#F2B300';
export const DOT = '#FFFFFF';
export const ONLINE = '#3DDC84';
export const SWEAT = '#9FE4FF';
export const TOUCH_FILL = 'rgba(255,251,241,.94)';

export const FONT_DISPLAY = "'Bagel Fat One', 'Atkinson Hyperlegible Next', system-ui, sans-serif";
export const FONT_TEXT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";

export interface SkyPalette {
  top: string;
  bot: string;
  hillFar: string;
  hillNear: string;
  sun: string;
  cloud: string;
  hud: string;
  hudSoft: string;
  /** 0..1, only the purple sky has stars. */
  stars: number;
  cloudAlpha: number;
}

export const SKIES: Readonly<Record<Sky, SkyPalette>> = {
  blue: { top: '#5FBFFF', bot: '#CFEFFF', hillFar: '#A9DDF7', hillNear: '#86CBEF', sun: '#FFF6C9', cloud: '#FFFFFF', hud: '#2A1B3D', hudSoft: 'rgba(42,27,61,.72)', stars: 0, cloudAlpha: 0.85 },
  sunset: { top: '#FF7E5F', bot: '#FFD49A', hillFar: '#F8A877', hillNear: '#EC8662', sun: '#FFF0B8', cloud: '#FFE7CF', hud: '#2A1B3D', hudSoft: 'rgba(42,27,61,.72)', stars: 0, cloudAlpha: 0.85 },
  purple: { top: '#2B1655', bot: '#8A4DB3', hillFar: '#5E3592', hillNear: '#472476', sun: '#F4E9FF', cloud: '#B88DDA', hud: '#FFF3DC', hudSoft: 'rgba(255,243,220,.78)', stars: 1, cloudAlpha: 0.35 },
};

// ---- color math -------------------------------------------------------------

/** Parse '#RRGGBB' or 'rgba(r,g,b,a)' into [r, g, b, a] (a in 0..1). */
export function parseColor(c: string, out: number[] = [0, 0, 0, 1]): number[] {
  if (c[0] === '#') {
    const n = parseInt(c.slice(1), 16);
    out[0] = (n >> 16) & 255; out[1] = (n >> 8) & 255; out[2] = n & 255; out[3] = 1;
    return out;
  }
  const m = c.match(/[\d.]+/g) ?? [];
  out[0] = Number(m[0] ?? 0); out[1] = Number(m[1] ?? 0); out[2] = Number(m[2] ?? 0); out[3] = m[3] === undefined ? 1 : Number(m[3]);
  return out;
}

export function rgba(r: number, g: number, b: number, a: number): string {
  return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${Math.round(a * 1000) / 1000})`;
}

export function mixHex(a: string, b: string, t: number): string {
  const x = parseColor(a), y = parseColor(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + h(x[0]! + (y[0]! - x[0]!) * t) + h(x[1]! + (y[1]! - x[1]!) * t) + h(x[2]! + (y[2]! - x[2]!) * t);
}

export function withAlpha(c: string, a: number): string {
  const x = parseColor(c);
  return rgba(x[0]!, x[1]!, x[2]!, x[3]! * a);
}
