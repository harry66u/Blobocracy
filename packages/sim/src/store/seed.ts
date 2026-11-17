// Fake history for development and screenshots: ~2,000 runs where the internet slowly gets
// better (spec §12 "the internet getting better"). Deaths happen at the level's real hazards
// (spikes, ceiling spikes, pits, presses, saws, the Big Chomp), so every cause and zone
// matches the geometry. Deterministic for a seed.
import { T_SPIKE_DOWN, T_SPIKE_UP, progressOf, zoneAt, type Level } from '@blobocracy/shared';
import type { ClipRow, RunRow, Store } from './types';

export interface SeedOptions {
  runs: number;
  level: Level;
  levelName?: string;
  /** The last run ended at this time (epoch ms). */
  now: number;
  seed?: number;
  /** Replay bytes to use for every seeded clip (e.g. a fixture); no clips without it. */
  clipReplay?: Uint8Array;
  /** Also mark the level as beaten (the last run wins), for the hall of fame. */
  beaten?: boolean;
}

interface Spot { p: number; x: number; cause: string }

/** Every place on the level a run can die, as progress → cause, sorted. */
export function hazardSpots(level: Level): Spot[] {
  const spots: Spot[] = [];
  const W = level.width, H = level.height;
  for (let x = Math.ceil(level.spawn.x) + 2; x < level.goalX; x++) {
    let spike = false, ceil = false;
    for (let y = 0; y < H; y++) {
      const t = level.tiles[y * W + x];
      if (t === T_SPIKE_UP) spike = true;
      if (t === T_SPIKE_DOWN) ceil = true;
    }
    if (spike) spots.push({ p: progressOf(level, x), x, cause: 'spikes' });
    if (ceil) spots.push({ p: progressOf(level, x), x, cause: 'ceiling spikes' });
    if (level.tiles[(H - 1) * W + x] === 0 && level.tiles[(H - 1) * W + x - 1] !== 0) spots.push({ p: progressOf(level, x), x, cause: 'pit' });
  }
  for (const e of level.entities) {
    if (e.kind === 'crusher') spots.push({ p: progressOf(level, e.x), x: e.x, cause: 'press' });
    if (e.kind === 'saw') spots.push({ p: progressOf(level, e.x), x: e.x, cause: 'saw' });
  }
  // the Big Chomp catches stragglers all through the last zone
  const last = level.zones[level.zones.length - 1]!;
  if (level.entities.some((e) => e.kind === 'chomp')) {
    for (let x = last.startX + 8; x < level.goalX - 4; x += 9) spots.push({ p: progressOf(level, x), x, cause: 'chomp' });
  }
  return spots.filter((s) => s.p > 0 && s.p < 1).sort((a, b) => a.p - b.p);
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Builds the fake runs (without writing them). */
export function fakeRuns(o: SeedOptions): RunRow[] {
  const r = rng(o.seed ?? 4812);
  const spots = hazardSpots(o.level);
  const n = o.runs;
  const out: RunRow[] = [];
  let t = 0;
  for (let i = 1; i <= n; i++) {
    // skill grows with practice, in fits and starts
    const k = i / n;
    const skill = 0.07 + 0.72 * (1 - Math.exp(-k * 2.4)) + 0.03 * Math.sin(i / 37);
    let target: number;
    const u = r();
    if (u < 0.16) target = r() * 0.08; // fell at the very start, again
    else target = Math.min(0.97, skill * Math.pow(r(), 0.7) * (0.72 + 0.45 * r()));
    if (o.beaten && i === n) target = 1;
    // die at one of the hazards just past the target (not always the first: some are nastier)
    const near = spots.filter((s) => s.p >= target && s.p <= target + 0.05);
    const spot = near.length ? near[Math.floor(r() * near.length)]! : spots.find((s) => s.p >= target) ?? spots[spots.length - 1]!;
    const win = o.beaten && i === n;
    const p = win ? 1 : spot.p;
    const x = win ? o.level.goalX : spot.x;
    const durationMs = Math.round((4 + p * (420 + 600 * r())) * 1000);
    const start = t;
    t += durationMs + 3500 + (r() < 0.12 ? r() * 40 * 60_000 : r() * 20_000); // quiet hours now and then
    out.push({
      levelId: o.level.id, levelVersion: o.level.version, run: i, startedAt: start, endedAt: start + durationMs, durationMs,
      maxProgress: p, maxX: x, zoneReached: zoneAt(o.level, x).index, cause: win ? 'win' : spot.cause,
      peakPlayers: 0, clipId: null,
    });
  }
  // place the whole history so the last run just ended; players follow the time of day
  const shift = o.now - out[out.length - 1]!.endedAt - 90_000;
  for (const row of out) {
    row.startedAt += shift;
    row.endedAt += shift;
    const hour = new Date(row.startedAt).getUTCHours() + new Date(row.startedAt).getUTCMinutes() / 60;
    const day = 0.5 + 0.5 * Math.sin(((hour - 9) / 24) * Math.PI * 2);
    row.peakPlayers = Math.max(1, Math.round((8 + 520 * day * day) * (0.4 + (row.run / n) * 1.2) * (0.8 + r() * 0.4)));
  }
  return out;
}

/** Writes the fake history (runs, clips for records and near misses, world row, optional win). */
export async function seedDemoRuns(store: Store, o: SeedOptions): Promise<{ deaths: number; record: { progress: number; run: number } | null }> {
  const runs = fakeRuns(o);
  await store.ensureLevel({ id: o.level.id, name: o.levelName ?? `Level ${o.level.id}`, version: o.level.version, geometryHash: 'seed' });
  let record: { progress: number; run: number } | null = null;
  let clipNo = 0;
  for (const run of runs) {
    let kind: ClipRow['kind'] | null = null;
    if (run.cause === 'win') kind = 'win';
    else if (!record || run.maxProgress > record.progress) kind = run.maxProgress >= 0.05 ? 'record' : null;
    else if (record.progress >= 0.1 && run.maxProgress >= record.progress - 0.05) kind = 'near_miss';
    if (kind && o.clipReplay) {
      const id = `demo${(++clipNo).toString(36)}`;
      run.clipId = id;
      await store.saveClip({
        id, levelId: run.levelId, levelVersion: run.levelVersion, run: run.run, kind, createdAt: run.endedAt + 3500,
        progress: run.maxProgress, cause: run.cause, deaths: run.run, replay: o.clipReplay, og: null,
      });
    }
    if (run.cause !== 'win' && (!record || run.maxProgress > record.progress)) record = { progress: run.maxProgress, run: run.run };
    await store.recordRun(run);
  }
  const last = runs[runs.length - 1]!;
  const deaths = o.beaten ? runs.length - 1 : runs.length;
  const peak = runs.reduce((m, x) => Math.max(m, x.peakPlayers), 0);
  await store.saveWorld({ levelId: o.level.id, deaths, record: record && { ...record, version: o.level.version }, peakPlayers: peak });
  if (o.beaten) {
    await store.addHallOfFame({ levelId: o.level.id, beatenAt: last.endedAt, deathCount: deaths, peakPlayers: last.peakPlayers, run: last.run, clipId: last.clipId });
  }
  return { deaths, record };
}
