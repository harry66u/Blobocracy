// Timing and words for the game's big moments: the death beat (freeze, flash, counter
// flip, card), the split-flap digit flip, the new-zone banner and the swoop back to the
// start. Pure functions of elapsed time, so the renderer and the tests agree.

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

/** The banner `age` seconds after the zone was entered. */
export function bannerFrame(age: number, reduced: boolean): BannerFrame {
  if (age < 0 || age > BANNER_S) return { visible: false, y: 0, alpha: 0, rot: 0, scale: 1 };
  if (reduced) {
    const alpha = Math.min(1, age / 0.25, (BANNER_S - age) / 0.3);
    return { visible: true, y: 0, alpha, rot: 0, scale: 1 };
  }
  let y = 0, rot = 0, scale = 1;
  if (age < DROP_S) {
    y = -(1 - backOut(age / DROP_S, 2.4)) * 1.8;
    rot = -0.12 * (1 - age / DROP_S);
  } else if (age < BANNER_S - LEAVE_S) {
    const q = age - DROP_S;
    // landed: a little damped wobble and a squash
    rot = 0.07 * Math.exp(-q * 5) * Math.sin(q * 16);
    scale = 1 + 0.05 * Math.exp(-q * 7) * Math.sin(q * 20 + 1.2);
  } else {
    const p = (age - (BANNER_S - LEAVE_S)) / LEAVE_S;
    y = -p * p * p * 1.9 + 0.12 * Math.sin(p * Math.PI);
    rot = 0.08 * p;
  }
  const alpha = Math.min(1, age / 0.08, (BANNER_S - age) / 0.12);
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
