/**
 * Long-term storage (spec §9): runs, clips, the hall of fame, levels and their versions, and
 * one `world` row per level (death count and record). Two implementations: Postgres
 * (postgres.ts, `DATABASE_URL`) and in-memory (memory.ts, dev/tests/no database). The sim
 * wraps either in a ResilientStore (resilient.ts) so a database outage never stops the game.
 */
import type { ReplayKind } from '@blobocracy/shared';

export interface RecordMark { progress: number; run: number; /** Level version it was set on. */ version: number }

export interface WorldRow {
  levelId: number;
  deaths: number;
  record: RecordMark | null;
  /** Most players online at once, ever (for the hall of fame). */
  peakPlayers: number;
}

export interface RunRow {
  levelId: number;
  levelVersion: number;
  run: number;
  /** Epoch ms. */
  startedAt: number;
  endedAt: number;
  /** Time the run was actually running (pauses and sim restarts excluded). */
  durationMs: number;
  /** 0..1. */
  maxProgress: number;
  maxX: number;
  /** 0-based zone index. */
  zoneReached: number;
  /** Hazard name (a Cause), or 'win'. */
  cause: string;
  peakPlayers: number;
  clipId: string | null;
  /** Nickname-ready (spec §9): always null for now. */
  sessionId?: string | null;
}

export interface ClipRow {
  id: string;
  levelId: number;
  levelVersion: number;
  run: number;
  kind: ReplayKind;
  createdAt: number;
  progress: number;
  /** Hazard that ended the run ('win' for a win). */
  cause: string;
  /** Death count after the clip. */
  deaths: number;
  /** Packed replay (BLRP, deflated). */
  replay: Uint8Array;
  /** Link-preview image (PNG), rendered at clip creation; null when unavailable. */
  og: Uint8Array | null;
  sessionId?: string | null;
}
export type ClipMeta = Omit<ClipRow, 'replay' | 'og'> & { hasOg: boolean };

export interface LevelInfo { id: number; name: string; version: number; geometryHash: string; notes?: string }
export interface LevelRow { id: number; name: string; createdAt: number; unlockedAt: number | null; beatenAt: number | null; currentVersion: number }
export interface LevelVersionRow { levelId: number; version: number; geometryHash: string; createdAt: number; notes: string }

export interface HallRow {
  levelId: number;
  beatenAt: number;
  deathCount: number;
  peakPlayers: number;
  run: number;
  clipId: string | null;
}
export type HallEntry = HallRow & { levelName: string };

export interface RunQuery { levelId: number; page: number; pageSize: number; best: boolean }
export interface RunPage { runs: RunRow[]; page: number; pageSize: number; total: number; pages: number }

/** One chart point: [run number, max progress (0..1), ended at (epoch ms)]; a bucket's best when runs are bucketed. */
export type SeriesPoint = [number, number, number];

export interface Summary {
  levelId: number;
  attempts: number;
  /** Runs that reached each zone (index = zone), cumulative: reaching zone 3 counts for 0..3. */
  zoneReach: number[];
  /** Every attempt's progress (bucketed past `maxPoints`, each bucket keeping its best run). */
  series: SeriesPoint[];
  /** Runs per series point (1 unless bucketed). */
  bucket: number;
  /** Each run that set a new record, in order: the steps of the record line. */
  records: SeriesPoint[];
  firstAt: number | null;
  lastAt: number | null;
}

export interface Store {
  /** Connects and applies migrations (idempotent). */
  init(): Promise<void>;
  close(): Promise<void>;
  /** Makes sure the level and this version exist; sets it as the level's current version. */
  ensureLevel(l: LevelInfo): Promise<void>;
  levels(): Promise<LevelRow[]>;
  levelVersions(levelId: number): Promise<LevelVersionRow[]>;
  loadWorld(levelId: number): Promise<WorldRow | null>;
  saveWorld(w: WorldRow): Promise<void>;
  /** Insert once per (level, run number): a retried write is harmless and a run is never written over. */
  recordRun(r: RunRow): Promise<void>;
  /** Links a clip to its run (only if the run has none yet). */
  attachClip(levelId: number, run: number, clipId: string): Promise<void>;
  saveClip(c: ClipRow): Promise<void>;
  getClip(id: string): Promise<ClipRow | null>;
  listRuns(q: RunQuery): Promise<RunPage>;
  summary(levelId: number, maxPoints: number, zones: number): Promise<Summary>;
  hallOfFame(): Promise<HallEntry[]>;
  addHallOfFame(h: HallRow): Promise<void>;
}

export const clipMeta = (c: ClipRow): ClipMeta => {
  const { replay: _r, og, ...rest } = c;
  return { ...rest, hasOg: og !== null && og.length > 0 };
};
