// Turns server frames + Director/Camera output into the renderer's Scene. Shared by the
// live game (main.ts) and the clip player, so a clip looks exactly like the game did.
import { DOT_EMPTY, DOT_LEFT, DOT_RIGHT, PHYS, checkpointsOf, tileAt, zoneAt, type Body, type Level, type StateFrame } from '@blobocracy/shared';
import { AudioCues } from './audiocues.ts';
import type { DirectorFrame } from './director.ts';
import { winFx } from './moments.ts';
import type { Scene, SceneBlob, SceneCrumble, SceneDot, SceneLevel, SceneWin } from './render/scene.ts';

/** One SceneLevel per level: the renderer caches level chunks per object, so keep it. */
export function sceneLevelOf(level: Level): SceneLevel {
  return {
    width: level.width,
    height: level.height,
    tileAt: (tx, ty) => tileAt(level, tx, ty),
    zones: level.zones,
    entities: level.entities,
    goalX: level.goalX,
  };
}

/** World x of a progress fraction. */
export const progressX = (level: Level, p: number) => level.spawn.x + p * (level.goalX - level.spawn.x);

/** The frame's crowd sample as dots (empty slots skipped). Reuses `out`. */
export function sceneDots(d: Uint8Array, j: Uint8Array, out: SceneDot[] = [], names?: ReadonlyMap<number, string>): SceneDot[] {
  out.length = 0;
  for (let i = 0; i < d.length; i++) {
    const code = d[i]!;
    if (code === DOT_EMPTY) continue; // nobody in this slot
    const name = names?.get(i);
    out.push({ slot: i, dir: code === DOT_LEFT ? -1 : code === DOT_RIGHT ? 1 : 0, jump: j[i] === 1, ...(name ? { name } : {}) });
  }
  return out;
}

export function sceneCrumbles(f: StateFrame, level: Level): SceneCrumble[] {
  return f.crumbles.map((c) => ({ tx: c.tile % level.width, ty: Math.floor(c.tile / level.width), at: c.at }));
}

/** The blob as drawn: smoothed position, the frame's crowd pull and strain, and the death pose. */
export function sceneBlob(pos: { x: number; y: number }, body: Body, f: StateFrame, deathCause: string | null): SceneBlob {
  const dead = f.phase === 'dying';
  const joy = f.phase === 'celebrating';
  return {
    x: pos.x, y: pos.y, vx: body.vx, vy: body.vy, grounded: body.grounded, facing: body.facing, pull: f.pull, strain: f.strain, dead, deathCause: dead ? deathCause : null,
    ...(joy ? { joy, crown: 1 } : {}),
  };
}

export interface SceneParts {
  level: Level;
  sceneLevel: SceneLevel;
  frame: StateFrame | null;
  blob: SceneBlob;
  dots: SceneDot[];
  you: Scene['you'];
  online: number;
  muted: boolean;
  reduced: boolean;
  runTime: number;
  director: DirectorFrame;
  /** The death card is still this run's (keepDeathCard). */
  showCard: boolean;
  /** Camera swoop back to the start: 0..1, or null when not swooping. */
  swoopK: number | null;
  swoopFade: number;
  /** World x at the middle of the look-ahead (the sky follows it during the swoop). */
  viewCenterX: number;
  /** Progress the marker slides back from during the swoop. */
  swoopFromProgress: number;
  /** The blob's run progress. */
  progress: number;
  /** "Level 2" by the counter (null on level 1), and whether this is an encore. */
  levelLabel?: string | null;
  encore?: boolean;
  /** The level's name and the next level, for the win card. */
  levelName?: string;
  nextLevel?: { levelId: number; name: string } | null;
  /** The win clip exists (the card shows "Share the clip"). */
  winClip?: boolean;
  /** The last checkpoint reached (0 = none). */
  checkpoint?: number;
}

/** Assembles the Scene the renderer draws. */
export function composeScene(p: SceneParts): Scene {
  const { level, frame: f, director: d, swoopK, reduced } = p;
  // during the swoop the progress marker slides back and the sky rewinds with the camera
  const shownProgress = swoopK === null ? p.progress : p.swoopFromProgress + (p.progress - p.swoopFromProgress) * swoopK;
  const skyX = swoopK === null ? p.blob.x : p.viewCenterX;
  let blob = p.blob;
  let win: SceneWin | null = null;
  if (d.win) {
    const wf = winFx(d.win.age, reduced);
    blob = { ...blob, joy: true, crown: wf.crown };
    win = {
      age: d.win.age, levelId: d.win.levelId, run: d.win.run, deaths: d.win.deaths, durationS: d.win.durationS, peakPlayers: d.win.peakPlayers,
      name: p.levelName ?? `Level ${d.win.levelId}`, next: p.nextLevel ?? null, encore: p.encore ?? false, clip: p.winClip ?? false,
    };
  }
  return {
    level: p.sceneLevel,
    blob,
    win,
    dots: p.dots,
    you: p.you,
    hud: {
      deaths: d.deaths,
      deathsJustTicked: d.deathsJustTicked,
      online: p.online,
      record: d.record,
      progress: shownProgress,
      recordLabel: d.recordLabel,
      recordPop: d.recordPop,
      muted: p.muted,
      levelLabel: p.levelLabel ?? null,
      encore: p.encore ?? false,
      cascade: d.cascade,
    },
    deathCard: p.showCard ? d.card : null,
    checkpoints: checkpointsOf(level).map((c) => ({ x: c.x, row: Math.round(c.y + PHYS.halfH), reached: c.index <= (p.checkpoint ?? 0), label: `${Math.round(c.progress * 100)}%` })),
    zoneSky: zoneAt(level, skyX).sky,
    paused: f?.phase === 'paused',
    runTime: p.runTime,
    chompStart: f?.chompStart ?? null,
    crumbles: f ? sceneCrumbles(f, level) : [],
    fx: {
      reduced,
      freeze: d.freeze,
      flash: d.flash,
      vignette: d.vignette,
      fade: p.swoopFade,
      banner: d.banner,
      recordFlag: d.flagProgress === null ? null : { x: progressX(level, d.flagProgress), label: `${Math.round(d.flagProgress * 100)}%` },
      skyRate: swoopK !== null ? (reduced ? 50 : 3.5) : reduced ? 0.6 : 1,
      timeScale: d.timeScale,
    },
  };
}

/** The world sounds a frame implies (a subset of GameAudio). */
export interface WorldSoundSink {
  sawNear(proximity: number): void;
  pressSlam(distanceTiles: number): void;
  crumble(): void;
  setCrowd(online: number, strain: number): void;
  land(impact: number): void;
  jump(strength: number): void;
  spring(): void;
}

/**
 * Per-frame world sounds: saws buzz when close, presses slam, crumbles crack, the crowd
 * hums, and the blob's own jumps, springs and landings.
 */
export class WorldSounds {
  private readonly cues: AudioCues;
  private prevGrounded = true;
  private prevVy = 0;

  constructor(level: Level) {
    this.cues = new AudioCues(level);
  }

  /** Hazard and crowd sounds; call before the blob's own (`body`). */
  world(f: StateFrame, pos: { x: number; y: number }, runTime: number, sink: WorldSoundSink): void {
    if (f.phase === 'running') {
      sink.sawNear(this.cues.sawProximity(runTime, pos.x, pos.y));
      for (const d of this.cues.slams(runTime, pos.x)) sink.pressSlam(d);
      if (this.cues.newCrumbles(f.crumbles) > 0) sink.crumble();
    }
    sink.setCrowd(f.online, f.strain);
  }

  /** Jumps, springs and landings, from the change in the body since the last call. */
  body(f: StateFrame, body: Body, sink: WorldSoundSink): void {
    if (f.phase !== 'dying') {
      if (!this.prevGrounded && body.grounded && this.prevVy > 6) {
        sink.land(Math.min(1, this.prevVy / 22));
      }
      if (this.prevGrounded && !body.grounded && body.vy < -2) {
        if (AudioCues.isSpring(body.vy)) sink.spring();
        else sink.jump(Math.min(1, -body.vy / 18));
      }
    }
    this.prevGrounded = body.grounded;
    this.prevVy = body.vy;
  }
}
