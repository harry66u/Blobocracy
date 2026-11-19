// The renderer's view model. Everything the renderer draws comes from a Scene, so it
// stays independent of the network/physics types in @blobocracy/shared.
import type { Entity } from '@blobocracy/shared';
import type { Layout } from '../layout.ts';

export type Sky = 'blue' | 'sunset' | 'purple';

export { TILE_CEIL_SPIKE, TILE_CONVEYOR_L, TILE_CONVEYOR_R, TILE_CRUMBLE, TILE_EMPTY, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE, TILE_SPRING } from './tiles.ts';

export interface SceneZone { index: number; name: string; sky: Sky; startX: number; endX: number }

/**
 * Keep the same SceneLevel object for the lifetime of a level: the renderer caches
 * pre-rendered chunks per object identity and rebuilds them when it changes.
 */
export interface SceneLevel {
  width: number;
  height: number;
  tileAt(tx: number, ty: number): number;
  zones: SceneZone[];
  /** Moving hazards and platforms (the level's own list; positions come from entityState). */
  entities: Entity[];
  /** World x of the goal, where the golden crown floats (absent: no crown drawn). */
  goalX?: number;
}

/** A crumble tile stood on this run, and the run time (s) it was first touched. */
export interface SceneCrumble { tx: number; ty: number; at: number }

export interface SceneDot { slot: number; dir: -1 | 0 | 1; jump: boolean }

export interface SceneBlob {
  /** Center of the hitbox in tiles, y grows down. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  facing: 1 | -1;
  /** Crowd pull, -1 (all left) to 1 (all right). */
  pull: number;
  /** Tug-of-war strain, 0 to 1. */
  strain: number;
  dead: boolean;
  /** What killed it ('press', 'spikes', 'ceiling spikes', 'pit', 'saw', 'chomp'); picks the death pose. */
  deathCause?: string | null;
  /** The golden crown on its head: 0 none, (0,1) popping on, 1 worn. */
  crown?: number;
  /** Celebrating: happy closed eyes and a big open smile. */
  joy?: boolean;
}

export interface SceneHud {
  deaths: number;
  deathsJustTicked: boolean;
  online: number;
  record: { progress: number; run: number } | null;
  /** 0..1 progress of the current run. */
  progress: number;
  /** Second line under "Record 83%", e.g. "run 3,940, nine days ago". Cut at the first comma when space is tight. */
  recordLabel: string;
  /** Seconds since this run passed the record ("New record!" pops), or null. */
  recordPop?: number | null;
  /** Sound is off (the sound button shows it). */
  muted?: boolean;
  /** false: no sound/settings buttons, and the progress bar ends `barEnd` CSS px from the right (clips). */
  buttons?: boolean;
  barEnd?: number;
  /** "Level 2" under the counter from level 2 on (null on level 1). */
  levelLabel?: string | null;
  /** An encore: a little "Encore" badge on the counter. */
  encore?: boolean;
  /** Seconds into a celebratory hop wave across the counter cards (the win), or null. */
  cascade?: number | null;
}

/** The win being celebrated (spec §6.7), with the words the card needs. */
export interface SceneWin {
  /** Seconds since the blob touched the goal. */
  age: number;
  levelId: number;
  run: number;
  deaths: number;
  durationS: number;
  peakPlayers: number;
  /** The level's name and what comes next (null: the last level, an encore follows). */
  name: string;
  next: { levelId: number; name: string } | null;
  encore: boolean;
  /** The win clip exists: the card makes room for "Share the clip". */
  clip?: boolean;
}

export interface SceneDeathCard {
  run: number;
  progress: number;
  /** Second half of the sentence, e.g. "then the Big Press flattened it." */
  line: string;
  nearRecord: boolean;
  /** Progress (0..1) of the checkpoint everyone goes back to; absent means the start. */
  checkpoint?: number;
  /** Seconds until everyone goes back to the start or the checkpoint (shown as "Back to the start in 3"). */
  countdown?: number;
  /** A clip of this run exists: the card makes room for a "Share the clip" button (an HTML link placed by main.ts). */
  clip?: boolean;
}

/** Where the death card's "Share the clip" button goes, in CSS px, following the card's motion. */
export interface ShareSlot { x: number; y: number; w: number; h: number; rotDeg: number; alpha: number; scale: number }

export interface SceneBanner {
  /** Changes for every new banner (starts the confetti). */
  id: number;
  /** Zone index, 0-based ("Zone 3" is index 2). */
  index: number;
  name: string;
  /** Seconds since the zone was entered. */
  age: number;
  /** The sticker's words instead of "Zone 3" (e.g. "Level 2 unlocked!"). */
  label?: string;
  /** How long it stays up (default BANNER_S), and a bigger size for the level-up. */
  life?: number;
  big?: boolean;
}

/** Screen-wide effects for the big moments. All optional; absent means calm. */
export interface SceneFx {
  /** Reduced motion: no shakes or bounces, fades instead. */
  reduced: boolean;
  /** Hit-stop: the world's animation clock stands still (the HUD keeps moving). */
  freeze: boolean;
  /** White flash over the world, 0..1. */
  flash: number;
  /** Dark vignette, 0..1. */
  vignette: number;
  /** Cover fade (reduced-motion swoop), 0..1. */
  fade: number;
  banner: SceneBanner | null;
  /** The in-world record flag: world x and the text on it (e.g. "83%"), or null. */
  recordFlag: { x: number; label: string } | null;
  /** Sky cross-fade speed multiplier (fast during the swoop, slow under reduced motion). */
  skyRate: number;
  /** World animation speed: slow motion as the blob touches the goal (default 1). */
  timeScale?: number;
}

export interface Scene {
  level: SceneLevel;
  blob: SceneBlob;
  /** Sampled real players. */
  dots: SceneDot[];
  /** The local player's own dot, drawn highlighted. */
  you: { dir: -1 | 0 | 1; jump: boolean } | null;
  hud: SceneHud;
  deathCard: SceneDeathCard | null;
  /** Current sky; the renderer cross-fades between skies over about 2 s. */
  zoneSky: Sky;
  paused: boolean;
  /** Seconds into the current run; entity positions are entityState(e, runTime, chompStart). */
  runTime: number;
  /** Run time the Big Chomp was triggered, or null while it still waits. */
  chompStart: number | null;
  /** Crumble tiles touched this run: they shake for 0.5 s, then break apart and are gone. */
  crumbles: SceneCrumble[];
  fx?: SceneFx;
  /** The level's checkpoints standing in the world: world x, the floor row, whether the blob has reached it, and its label ("40%"). */
  checkpoints?: { x: number; row: number; reached: boolean; label: string }[];
  /** The win celebration, or null/absent. */
  win?: SceneWin | null;
}

export type { Layout };
export { deathCardShareSlot, renderFrame, resetRenderer } from './frame.ts';
