// Client-side replay: every player already receives every state frame, so the last few
// seconds before a death can be re-rendered exactly, at any size, by the game's renderer.
import { DOT_EMPTY, DOT_LEFT, DOT_RIGHT, FRAME_EVERY, TICK_HZ, progressOf, zoneAt, type Level, type StateFrame } from '@blobocracy/shared';
import type { Scene, SceneBlob, SceneDot, SceneHud, SceneLevel } from '../render/scene.ts';

/** Ring buffer of recent state frames, oldest first. */
export class FrameRecorder {
  private buf: StateFrame[] = [];
  constructor(private readonly keepS = 10) {}

  push(f: StateFrame): void {
    const last = this.buf[this.buf.length - 1];
    if (last && f.tick <= last.tick) {
      if (f.tick < last.tick - TICK_HZ) this.buf = []; // server restarted: start over
      else return; // duplicate or out of order
    }
    this.buf.push(f);
    const minTick = f.tick - this.keepS * TICK_HZ;
    let drop = 0;
    while (drop < this.buf.length && this.buf[drop]!.tick < minTick) drop++;
    if (drop) this.buf.splice(0, drop);
  }

  /** Frames with tick in [from, to]. */
  slice(from: number, to: number): StateFrame[] {
    return this.buf.filter((f) => f.tick >= from && f.tick <= to);
  }

  get latest(): StateFrame | undefined { return this.buf[this.buf.length - 1]; }
}

/** Seconds on the replay timeline for a frame. */
export const frameTime = (f: StateFrame) => f.tick / TICK_HZ;

/**
 * Blob state at time t (seconds, on the tick timeline): positions are interpolated between
 * the two surrounding frames, everything discrete comes from the earlier one.
 */
export function frameAt(frames: readonly StateFrame[], t: number): { a: StateFrame; x: number; y: number; vx: number; vy: number } {
  if (frames.length === 0) throw new Error('no frames');
  let i = 0;
  while (i + 1 < frames.length && frameTime(frames[i + 1]!) <= t) i++;
  const a = frames[i]!, b = frames[i + 1];
  if (!b || a.phase !== 'running' || b.run !== a.run) return { a, x: a.x, y: a.y, vx: a.vx, vy: a.vy };
  const span = frameTime(b) - frameTime(a);
  const k = span > 0 ? Math.min(1, Math.max(0, (t - frameTime(a)) / span)) : 0;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return { a, x: lerp(a.x, b.x), y: lerp(a.y, b.y), vx: lerp(a.vx, b.vx), vy: lerp(a.vy, b.vy) };
}

const dotsOf = (f: StateFrame, out: SceneDot[]): SceneDot[] => {
  out.length = 0;
  for (let i = 0; i < f.dots.length; i++) {
    const code = f.dots[i]!;
    if (code === DOT_EMPTY) continue;
    out.push({ slot: i, dir: code === DOT_LEFT ? -1 : code === DOT_RIGHT ? 1 : 0, jump: f.dotJump[i] === 1 });
  }
  return out;
};

/** What the HUD showed around the death, for clips that include it. */
export interface ReplayHud {
  deathTick: number;
  deathsBefore: number;
  recordBefore: { progress: number; run: number } | null;
  recordAfter: { progress: number; run: number } | null;
  card: { run: number; progress: number; cause: string; nearRecord: boolean };
}

/** Builds the renderer's Scene for replay time t. */
export function replayScene(level: Level, sceneLevel: SceneLevel, frames: readonly StateFrame[], t: number, hud: ReplayHud | null, dots: SceneDot[] = []): Scene {
  const s = frameAt(frames, t);
  const f = s.a;
  const blob: SceneBlob = {
    x: s.x, y: s.y, vx: s.vx, vy: s.vy, grounded: f.grounded, facing: f.facing,
    pull: f.pull, strain: f.strain, dead: f.phase === 'dying',
  };
  const dead = hud !== null && f.tick >= hud.deathTick;
  const record = hud ? (dead ? hud.recordAfter : hud.recordBefore) : null;
  const sceneHud: SceneHud = {
    deaths: hud ? hud.deathsBefore + (dead ? 1 : 0) : 0,
    deathsJustTicked: dead && t - hud!.deathTick / TICK_HZ < 1.2,
    online: f.online,
    record,
    progress: progressOf(level, s.x),
    recordLabel: record ? `run ${record.run.toLocaleString('en-US')}` : '',
  };
  return {
    level: sceneLevel,
    blob,
    dots: dotsOf(f, dots),
    you: null,
    hud: sceneHud,
    deathCard: dead && hud ? hud.card : null,
    zoneSky: zoneAt(level, s.x).sky,
    paused: f.phase === 'paused',
  };
}

/** The clip covers this long before the death and after it. */
export const CLIP_BEFORE_S = 5;
export const CLIP_AFTER_S = 1.8;

/** Seconds between frames on the wire. */
export const FRAME_S = FRAME_EVERY / TICK_HZ;
