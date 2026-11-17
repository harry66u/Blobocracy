/**
 * Moving hazards and platforms. Each one's geometry is a pure function of the run's
 * clock (seconds the run has been running), so every run sees identical timings and
 * a crowd can learn them. Authored as a letter marker in a room plus a spec.
 */
import { LEVEL_HEIGHT } from './constants';

/** Authoring specs (positions come from the marker letter). Times are seconds. */
export type EntitySpec =
  /** A block (anchor = its top-left while raised) that slams down by `drop` tiles. */
  | { kind: 'crusher'; w: number; h?: number; drop: number; period: number; phase?: number; downS?: number; holdS?: number; upS?: number }
  /** A one-way platform (anchor = its top-left at rest) that eases back and forth by (dx, dy). */
  | { kind: 'mover'; w: number; dx: number; dy: number; period: number; phase?: number }
  /** A spinning blade (anchor = tile center) that eases back and forth by (dx, dy). */
  | { kind: 'saw'; r: number; dx?: number; dy?: number; period?: number; phase?: number }
  /** The Big Chomp: a full-height wall of teeth (anchor = its x) chasing right at `speed` once triggered. */
  | { kind: 'chomp'; speed: number }
  /**
   * Wind gusts: a region (anchor = its top-left; `h` defaults to the rest of the level below
   * it) that pushes the blob sideways at `push` tiles/s (positive = right). Each `period`
   * it gusts for `gustS` (default half the period), easing in and out over WIND_RAMP_S;
   * between gusts it blows at `base` (0..1, default 0) of its strength.
   */
  | { kind: 'wind'; w: number; h?: number; push: number; period: number; phase?: number; gustS?: number; base?: number };

export interface Crusher { kind: 'crusher'; id: number; x: number; y: number; w: number; h: number; drop: number; period: number; phase: number; downS: number; holdS: number; upS: number }
export interface Mover { kind: 'mover'; id: number; x: number; y: number; w: number; dx: number; dy: number; period: number; phase: number }
export interface Saw { kind: 'saw'; id: number; x: number; y: number; r: number; dx: number; dy: number; period: number; phase: number }
export interface Chomp { kind: 'chomp'; id: number; x: number; speed: number }
export interface Wind { kind: 'wind'; id: number; x: number; y: number; w: number; h: number; push: number; period: number; phase: number; gustS: number; base: number }
export type Entity = Crusher | Mover | Saw | Chomp | Wind;

/** Crusher teeth hang this far below the block. */
export const CRUSHER_TEETH = 0.42;
/** Mover platforms are this thick. */
export const MOVER_THICKNESS = 0.5;
/** A gust takes this long to rise to full strength, and as long to die down. */
export const WIND_RAMP_S = 0.3;

/** Fills defaults and places a spec at its marker (column `tx`, row `ty`). */
export function makeEntity(spec: EntitySpec, id: number, tx: number, ty: number): Entity {
  switch (spec.kind) {
    case 'crusher':
      return { kind: 'crusher', id, x: tx, y: ty, w: spec.w, h: spec.h ?? 2.3, drop: spec.drop, period: spec.period, phase: spec.phase ?? 0, downS: spec.downS ?? 0.25, holdS: spec.holdS ?? 0.6, upS: spec.upS ?? 1.0 };
    case 'mover':
      return { kind: 'mover', id, x: tx, y: ty, w: spec.w, dx: spec.dx, dy: spec.dy, period: spec.period, phase: spec.phase ?? 0 };
    case 'saw':
      return { kind: 'saw', id, x: tx + 0.5, y: ty + 0.5, r: spec.r, dx: spec.dx ?? 0, dy: spec.dy ?? 0, period: spec.period ?? 1, phase: spec.phase ?? 0 };
    case 'chomp':
      return { kind: 'chomp', id, x: tx, speed: spec.speed };
    case 'wind':
      return { kind: 'wind', id, x: tx, y: ty, w: spec.w, h: spec.h ?? LEVEL_HEIGHT - ty, push: spec.push, period: spec.period, phase: spec.phase ?? 0, gustS: spec.gustS ?? spec.period / 2, base: spec.base ?? 0 };
  }
}

export type CrusherMotion = 'wait' | 'down' | 'hold' | 'up';
export type EntityState =
  | { kind: 'crusher'; x: number; y: number; w: number; h: number; moving: CrusherMotion }
  | { kind: 'mover'; x: number; y: number; w: number }
  | { kind: 'saw'; x: number; y: number; r: number }
  | { kind: 'chomp'; x: number }
  | { kind: 'wind'; x: number; y: number; w: number; h: number; push: number };

/** 0 → 1 → 0 smoothly over one period. */
const pingPong = (t: number, period: number, phase: number) => (1 - Math.cos(2 * Math.PI * (t / period + phase))) / 2;
const cycleTime = (t: number, period: number, phase: number) => {
  const c = (t / period + phase) % 1;
  return (c < 0 ? c + 1 : c) * period;
};

const smooth = (k: number) => k * k * (3 - 2 * k);

/** How hard a wind region blows at run time `t` (tiles/s, signed like its `push`). */
export function windPush(e: Wind, t: number): number {
  const c = cycleTime(t, e.period, e.phase);
  const ramp = Math.min(WIND_RAMP_S, e.gustS / 2);
  let k = 0;
  if (c < ramp) k = smooth(c / ramp);
  else if (c < e.gustS - ramp) k = 1;
  else if (c < e.gustS) k = smooth((e.gustS - c) / ramp);
  return e.push * (e.base + (1 - e.base) * k);
}

/**
 * Where an entity is at run time `t` (seconds). For the chomp, `chompStart` is the run
 * time it was triggered, or null while it still waits.
 */
export function entityState(e: Entity, t: number, chompStart: number | null = null): EntityState {
  switch (e.kind) {
    case 'crusher': {
      const c = cycleTime(t, e.period, e.phase);
      const wait = e.period - e.downS - e.holdS - e.upS;
      let off = 0;
      let moving: CrusherMotion = 'wait';
      if (c < wait) { off = 0; moving = 'wait'; }
      else if (c < wait + e.downS) { const k = (c - wait) / e.downS; off = e.drop * k * k; moving = 'down'; }
      else if (c < wait + e.downS + e.holdS) { off = e.drop; moving = 'hold'; }
      else { const k = (c - wait - e.downS - e.holdS) / e.upS; off = e.drop * (1 - k * k * (3 - 2 * k)); moving = 'up'; }
      return { kind: 'crusher', x: e.x, y: e.y + off, w: e.w, h: e.h, moving };
    }
    case 'mover': {
      const k = pingPong(t, e.period, e.phase);
      return { kind: 'mover', x: e.x + e.dx * k, y: e.y + e.dy * k, w: e.w };
    }
    case 'saw': {
      const k = pingPong(t, e.period, e.phase);
      return { kind: 'saw', x: e.x + e.dx * k, y: e.y + e.dy * k, r: e.r };
    }
    case 'chomp':
      return { kind: 'chomp', x: chompStart === null ? e.x : e.x + e.speed * Math.max(0, t - chompStart) };
    case 'wind':
      return { kind: 'wind', x: e.x, y: e.y, w: e.w, h: e.h, push: windPush(e, t) };
  }
}
