// Timing and words for the game's big moments: the death beat (freeze, flash, counter
// flip, card), the split-flap digit flip, the new-zone banner and the swoop back to the
// start, and the win (slow motion, the crown, fireworks, the card) and the level-up.
// Pure functions of elapsed time, so the renderer and the tests agree.
import { CELEBRATE_S } from '@blobocracy/shared';

// ---- death -------------------------------------------------------------------------

/** Hit-stop on the impact frame (matches the server's DEATH_FREEZE_S). */
export const DEATH_FREEZE_S = 0.5;
/** When the death counter's card flips, measured from the death. */
export const DEATH_COUNTER_AT = 0.28;
/** When the death card slides in. */
export const DEATH_CARD_AT = 0.5;
/** Freeze + hold on the server; the reset (and the swoop) follows. */
export const DEATH_TOTAL_S = 3.5;
/** Camera shake on death: amplitude (tiles) and duration (s). */
export const DEATH_SHAKE = { amp: 0.32, dur: 0.42 } as const;
/** Camera shake on a big landing. */
export const LAND_SHAKE = { amp: 0.09, dur: 0.22 } as const;

/** Decaying shake envelope: `amp` at t = 0, zero from `dur` on. */
export function shakeEnvelope(t: number, amp: number, dur: number): number {
  if (t < 0 || t >= dur) return 0;
  const k = 1 - t / dur;
  return amp * k * k;
}

export interface DeathFx {
  /** Hit-stop: the world's animation clock stands still. */
  freeze: boolean;
  /** White flash over the world, 0..1. */
  flash: number;
  /** Dark vignette around the edges, 0..1. */
  vignette: number;
  /** Camera shake amplitude in tiles. */
  shake: number;
}

/** The death beat `t` seconds after the impact. */
export function deathFx(t: number, reduced: boolean): DeathFx {
  const fl = t < 0 ? 0 : t < 0.28 ? Math.pow(1 - t / 0.28, 2) : 0;
  return {
    freeze: t >= 0 && t < DEATH_FREEZE_S,
    flash: fl * (reduced ? 0.22 : 0.7),
    vignette: t < 0 ? 0 : Math.min(1, 0.25 + t / 0.5) * 0.55,
    shake: reduced ? 0 : shakeEnvelope(t, DEATH_SHAKE.amp, DEATH_SHAKE.dur),
  };
}

export { CAUSE_LINES, causeName, deathLine, type CauseKey } from '@blobocracy/shared';

// ---- split-flap counter ------------------------------------------------------------

/** Fold time of one split-flap card: the top flap falls, then the bottom flap lands. */
export const FLIP_S = 0.46;
const SETTLE_S = 0.5;

export interface FlipFrame {
  /** Vertical scale of the falling top flap (old digit's top half), 1 → 0. */
  top: number;
  /** Vertical scale of the landing bottom flap (new digit's bottom half), 0 → 1. */
  bottom: number;
  /** Damped bounce after landing, as a fraction of the card height (0 when still). */
  bounce: number;
  /** Reduced motion: crossfade from the old digit to the new, 0 → 1. */
  fade: number;
  done: boolean;
}

/** The flip `t` seconds after it starts. */
export function flipFrame(t: number, reduced: boolean): FlipFrame {
  if (t <= 0) return { top: 1, bottom: 0, bounce: 0, fade: 0, done: false };
  if (reduced) {
    const fade = Math.min(1, t / FLIP_S);
    const done = t >= FLIP_S;
    return { top: done ? 0 : 1, bottom: done ? 1 : 0, bounce: 0, fade, done };
  }
  if (t < FLIP_S) {
    // one continuous fall through 180°, speeding up like a real flap under gravity
    const theta = Math.PI * Math.pow(t / FLIP_S, 1.5);
    return theta < Math.PI / 2
      ? { top: Math.cos(theta), bottom: 0, bounce: 0, fade: 0, done: false }
      : { top: 0, bottom: -Math.cos(theta), bounce: 0, fade: 0, done: false };
  }
  const q = t - FLIP_S;
  const bounce = q < SETTLE_S ? 0.14 * Math.exp(-q * 9) * Math.sin(q * 26) : 0;
  return { top: 0, bottom: 1, bounce, fade: 1, done: q >= SETTLE_S };
}

// ---- new zone banner ---------------------------------------------------------------

export const BANNER_S = 2.2;
const DROP_S = 0.5;
const LEAVE_S = 0.38;

export interface BannerFrame {
  visible: boolean;
  /** Vertical offset in banner heights: 0 at rest, negative above, positive overshoot. */
  y: number;
  alpha: number;
  /** Extra rotation (radians) on top of the banner's playful tilt. */
  rot: number;
  scale: number;
}

/** The banner `age` seconds after the zone was entered (`life`: how long it stays up). */
export function bannerFrame(age: number, reduced: boolean, life = BANNER_S): BannerFrame {
  if (age < 0 || age > life) return { visible: false, y: 0, alpha: 0, rot: 0, scale: 1 };
  if (reduced) {
    const alpha = Math.min(1, age / 0.25, (life - age) / 0.3);
    return { visible: true, y: 0, alpha, rot: 0, scale: 1 };
  }
  let y = 0, rot = 0, scale = 1;
  if (age < DROP_S) {
    y = -(1 - backOut(age / DROP_S, 2.4)) * 1.8;
    rot = -0.12 * (1 - age / DROP_S);
  } else if (age < life - LEAVE_S) {
    const q = age - DROP_S;
    // landed: a little damped wobble and a squash
    rot = 0.07 * Math.exp(-q * 5) * Math.sin(q * 16);
    scale = 1 + 0.05 * Math.exp(-q * 7) * Math.sin(q * 20 + 1.2);
  } else {
    const p = (age - (life - LEAVE_S)) / LEAVE_S;
    y = -p * p * p * 1.9 + 0.12 * Math.sin(p * Math.PI);
    rot = 0.08 * p;
  }
  const alpha = Math.min(1, age / 0.08, (life - age) / 0.12);
  return { visible: true, y, alpha, rot, scale };
}

function backOut(p: number, s: number): number {
  const q = p - 1;
  return 1 + (s + 1) * q * q * q + s * q * q;
}

// ---- swoop back to the start -------------------------------------------------------

/** How long the camera takes to fly back over `dist` tiles. */
export function swoopDuration(dist: number, reduced: boolean): number {
  if (reduced) return 1;
  return Math.min(1.8, Math.max(0.5, 0.7 + 0.8 * Math.min(1, Math.abs(dist) / 260)));
}

export interface SwoopFrame {
  /** Camera progress from where it was (0) to the start (1). */
  k: number;
  /** Reduced motion: cover the cut with a fade, 0..1. */
  fade: number;
  done: boolean;
}

export function swoopFrame(t: number, dur: number, reduced: boolean): SwoopFrame {
  const done = t >= dur;
  if (reduced) {
    const half = dur / 2;
    if (t >= dur) return { k: 1, fade: 0, done };
    return t < half ? { k: 0, fade: Math.max(0, t / half), done } : { k: 1, fade: Math.max(0, 1 - (t - half) / half), done };
  }
  const p = Math.min(1, Math.max(0, t / dur));
  // quick launch, long glide in: ease in-out on a time warp that front-loads the speed
  const w = 1 - Math.pow(1 - p, 1.4);
  const k = w < 0.5 ? 4 * w * w * w : 1 - Math.pow(-2 * w + 2, 3) / 2;
  return { k: p >= 1 ? 1 : p <= 0 ? 0 : k, fade: 0, done };
}

// ---- the win (spec §6.7) -----------------------------------------------------------

/** Slow motion at the touch, easing back to full speed over this long. */
export const WIN_SLOW_S = 1.5;
/** The crown lifts off its pedestal and arcs onto the blob's head between these ages. */
export const CROWN_FLY_FROM = 0.22, CROWN_FLY_TO = 0.95;
/** The big banner card drops in and lifts away (both well inside the server's CELEBRATE_S). */
export const WIN_BANNER_IN = 2.1;
export const WIN_BANNER_OUT = CELEBRATE_S - 1.6;
const WIN_BANNER_LEAVE = 0.5;
/** Fireworks fill the sky from the crown pop until shortly before the level-up. */
export const FIREWORKS_FROM = 0.75, FIREWORKS_TO = CELEBRATE_S - 2.5;
/** The counter cards hop in a wave this often (each wave lasts CASCADE_S). */
export const CASCADE_FROM = 1.0, CASCADE_EVERY = 4.5, CASCADE_S = 1.8;

export interface WinFx {
  /** World animation speed (slow motion at the touch). */
  timeScale: number;
  /** Golden flash over the world, 0..1. */
  flash: number;
  /** The crown's glow and light rays, 0..1. */
  glow: number;
  /** 0 on its pedestal, (0,1) flying to the head, 1 worn. */
  crown: number;
  fireworks: boolean;
  /** Seconds into the current counter-card wave, or null between waves. */
  cascade: number | null;
  /** Seconds the banner card has been up, or null when it is not. */
  banner: number | null;
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The celebration `t` seconds after the win. */
export function winFx(t: number, reduced: boolean): WinFx {
  if (t < 0) return { timeScale: 1, flash: 0, glow: 0, crown: 0, fireworks: false, cascade: null, banner: null };
  const timeScale = reduced ? 1 : 0.2 + 0.8 * smooth(clamp01(t / WIN_SLOW_S));
  const flash = (reduced ? 0.25 : 0.55) * Math.pow(clamp01(1 - t / 0.6), 2);
  const glow = t < 0.15 ? t / 0.15 : t < 1.6 ? 1 : Math.max(0, 1 - (t - 1.6) / 1.2);
  const crown = reduced ? (t < 0.5 ? 0 : 1) : clamp01((t - CROWN_FLY_FROM) / (CROWN_FLY_TO - CROWN_FLY_FROM));
  const fireworks = !reduced && t >= FIREWORKS_FROM && t < FIREWORKS_TO;
  let cascade: number | null = null;
  if (t >= CASCADE_FROM && t < CELEBRATE_S - 2) {
    const c = (t - CASCADE_FROM) % CASCADE_EVERY;
    if (c < CASCADE_S) cascade = c;
  }
  const banner = t >= WIN_BANNER_IN && t < WIN_BANNER_OUT ? t - WIN_BANNER_IN : null;
  return { timeScale, flash, glow, crown, fireworks, cascade, banner };
}

export interface WinBannerFrame { y: number; alpha: number; rot: number; scale: number }

/** The win card `age` seconds after it starts dropping in. */
export function winBannerFrame(age: number, reduced: boolean): WinBannerFrame {
  const life = WIN_BANNER_OUT - WIN_BANNER_IN;
  const out = clamp01((age - (life - WIN_BANNER_LEAVE)) / WIN_BANNER_LEAVE);
  if (reduced) return { y: 0, alpha: Math.min(clamp01(age / 0.35), 1 - out), rot: 0, scale: 1 };
  const k = clamp01(age / 0.6);
  const y = -(1 - backOut(k, 2.2)) * 1.25 - out * out * 1.4;
  const settle = Math.max(0, age - 0.55);
  const rot = -0.1 * (1 - k) * (1 - k) + 0.05 * Math.exp(-settle * 4) * Math.sin(settle * 13) + out * 0.08;
  const scale = 1 + 0.04 * Math.exp(-settle * 5) * Math.sin(settle * 18 + 1);
  return { y, alpha: Math.min(1, age / 0.06) * (1 - out * out), rot, scale };
}

export interface WinWords {
  title: string;
  line: string;
  stats: { big: string; small: string }[];
  /** The footer `secondsLeft` before the next level. */
  next: (secondsLeft: number) => string;
}

/** "8:14", "1:02:09". */
export function clockTime(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const fmtN = (n: number) => Math.round(n).toLocaleString('en-US');

/** The words on the win card. */
export function winLines(
  w: { levelId: number; run: number; deaths: number; durationS: number; peakPlayers: number },
  ctx: { name: string; next: { levelId: number; name: string } | null; encore: boolean },
): WinWords {
  const what = ctx.encore ? 'Encore' : `Level ${w.levelId}`;
  return {
    title: 'The internet did it!',
    line: `${what} beaten after ${fmtN(w.deaths)} ${w.deaths === 1 ? 'death' : 'deaths'}`,
    stats: [
      { big: `Run ${fmtN(w.run)}`, small: 'made it' },
      { big: clockTime(w.durationS), small: 'run time' },
      { big: fmtN(w.peakPlayers), small: w.peakPlayers === 1 ? 'peak player' : 'peak players' },
    ],
    next: (left) => {
      const n = Math.max(1, Math.ceil(left));
      return ctx.next ? `Level ${ctx.next.levelId} unlocks in ${n}` : `A new level is coming. Encore in ${n}`;
    },
  };
}

// ---- level-up transition -----------------------------------------------------------

/** The old level shrinks into a card and flies off, the new one slides in and fills the screen. */
export const LEVELUP_S = 5.4;
const LU_SHRINK = 0.9, LU_SWAP0 = 0.85, LU_SWAP1 = 1.75, LU_GROW0 = 2.15, LU_GROW1 = 3.0;
const LU_BANNER_AT = 1.5;

export interface LevelUpFrame {
  /** Old level card (a snapshot of the last frame): scale, x offset (fraction of the view width), tilt (radians), alpha. */
  oldScale: number; oldX: number; oldRot: number; oldAlpha: number;
  /** New level card (live). */
  newScale: number; newX: number; newRot: number; newAlpha: number;
  /** Seconds the "Level 2 unlocked" banner has been up, or null. */
  banner: number | null;
  /** The card frames (white border) fade out as the new level fills the screen, 0..1. */
  frame: number;
  done: boolean;
}

export function levelUpFrame(t: number, reduced: boolean): LevelUpFrame {
  const done = t >= LEVELUP_S;
  const banner = t >= LU_BANNER_AT && t < LEVELUP_S ? t - LU_BANNER_AT : null;
  if (reduced) {
    const k = clamp01(t / 0.9);
    return { oldScale: 1, oldX: 0, oldRot: 0, oldAlpha: 1 - k, newScale: 1, newX: 0, newRot: 0, newAlpha: k, banner, frame: 0, done };
  }
  const SMALL = 0.56;
  const shrink = smooth(clamp01(t / LU_SHRINK));
  const swap = clamp01((t - LU_SWAP0) / (LU_SWAP1 - LU_SWAP0));
  const swapIn = clamp01((t - LU_SWAP0 - 0.25) / (LU_SWAP1 - LU_SWAP0));
  const grow = clamp01((t - LU_GROW0) / (LU_GROW1 - LU_GROW0));
  const oldScale = 1 - (1 - SMALL) * shrink;
  const oldX = -1.25 * swap * swap;
  const oldRot = -0.07 * shrink - 0.35 * swap * swap;
  const inK = backOut(swapIn, 1.4);
  const g = backOut(grow, 1.1);
  const newScale = SMALL + (1 - SMALL) * g;
  const newX = (1 - inK) * 1.25;
  const newRot = (0.06 * (1 - inK) + 0.05) * (1 - g);
  const frame = done ? 0 : t < LU_GROW0 ? Math.min(1, t / 0.4) : 1 - grow;
  return {
    oldScale, oldX, oldRot, oldAlpha: swap >= 1 ? 0 : 1,
    newScale: done ? 1 : newScale, newX: done ? 0 : newX, newRot: done ? 0 : newRot, newAlpha: swapIn > 0 ? 1 : 0,
    banner, frame, done,
  };
}
