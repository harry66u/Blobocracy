// The renderer's view model. Everything the renderer draws comes from a Scene, so it
// stays independent of the network/physics types in @blobocracy/shared.
import type { Layout } from '../layout.ts';

export type Sky = 'blue' | 'sunset' | 'purple';

export { TILE_CEIL_SPIKE, TILE_EMPTY, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE } from './tiles.ts';

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
}

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
}

export interface SceneDeathCard { run: number; progress: number; cause: string; nearRecord: boolean }

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
}

export type { Layout };
export { Renderer, liveRenderer, renderFrame, resetRenderer, type RenderOptions } from './frame.ts';
