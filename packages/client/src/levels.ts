// Every built level, by id, as the client draws it: one SceneLevel per level for the whole
// session (the renderer caches pre-rendered chunks per SceneLevel object, so switching
// levels swaps objects instead of rebuilding), plus the level's audio cues.
import { LEVELS, levelTitle, type Level } from '@blobocracy/shared';
import type { SceneLevel } from './render/scene.ts';
import { sceneLevelOf, WorldSounds } from './scenemap.ts';

export interface LevelView {
  level: Level;
  sceneLevel: SceneLevel;
  /** Saws, presses and crumbles of this level. */
  sounds: WorldSounds;
  name: string;
  /** The level after it, or null for the last one (an encore follows). */
  next: { levelId: number; name: string } | null;
}

const views = new Map<number, LevelView>();

/** The level with this id, or null if this build doesn't have it. */
export function levelView(id: number): LevelView | null {
  let v = views.get(id);
  if (v) return v;
  const i = LEVELS.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const level = LEVELS[i]!;
  const next = LEVELS[i + 1] ?? null;
  v = { level, sceneLevel: sceneLevelOf(level), sounds: new WorldSounds(level), name: levelTitle(level), next: next ? { levelId: next.id, name: levelTitle(next) } : null };
  views.set(id, v);
  return v;
}

/** The small "Level 2" by the counter: shown from level 2 on, and in any encore. */
export function hudLevelLabel(levelId: number, encore: boolean): string | null {
  return levelId > 1 || encore ? `Level ${levelId}` : null;
}
