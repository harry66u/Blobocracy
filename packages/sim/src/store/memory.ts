import type {
  ClipRow, HallEntry, HallRow, LevelInfo, LevelRow, LevelVersionRow, RunPage, RunQuery, RunRow, SeriesPoint, Store, Summary, WorldRow,
} from './types';

/** Everything in memory: dev, tests, and production without DATABASE_URL (history is lost on restart). */
export class MemoryStore implements Store {
  private levelRows = new Map<number, LevelRow & { name: string }>();
  private versions: LevelVersionRow[] = [];
  private worlds = new Map<number, WorldRow>();
  private runs = new Map<number, Map<number, RunRow>>();
  private clips = new Map<string, ClipRow>();
  private hall: HallRow[] = [];

  constructor(private now: () => number = Date.now) {}

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async ensureLevel(l: LevelInfo): Promise<void> {
    const row = this.levelRows.get(l.id);
    if (!row) this.levelRows.set(l.id, { id: l.id, name: l.name, createdAt: this.now(), unlockedAt: this.now(), beatenAt: null, currentVersion: l.version });
    else { row.name = l.name; row.currentVersion = l.version; }
    if (!this.versions.some((v) => v.levelId === l.id && v.version === l.version)) {
      this.versions.push({ levelId: l.id, version: l.version, geometryHash: l.geometryHash, createdAt: this.now(), notes: l.notes ?? '' });
    }
  }

  async levels(): Promise<LevelRow[]> { return [...this.levelRows.values()].map((r) => ({ ...r })).sort((a, b) => a.id - b.id); }
  async levelVersions(levelId: number): Promise<LevelVersionRow[]> {
    return this.versions.filter((v) => v.levelId === levelId).map((v) => ({ ...v })).sort((a, b) => a.version - b.version);
  }

  async loadWorld(levelId: number): Promise<WorldRow | null> {
    const w = this.worlds.get(levelId);
    return w ? structuredClone(w) : null;
  }
  async saveWorld(w: WorldRow): Promise<void> { this.worlds.set(w.levelId, structuredClone(w)); }

  private levelRuns(levelId: number): Map<number, RunRow> {
    let m = this.runs.get(levelId);
    if (!m) { m = new Map(); this.runs.set(levelId, m); }
    return m;
  }
  async recordRun(r: RunRow): Promise<void> {
    const m = this.levelRuns(r.levelId);
    if (!m.has(r.run)) m.set(r.run, { ...r, sessionId: r.sessionId ?? null });
  }
  async attachClip(levelId: number, run: number, clipId: string): Promise<void> {
    const r = this.levelRuns(levelId).get(run);
    if (r && !r.clipId) r.clipId = clipId;
  }

  async saveClip(c: ClipRow): Promise<void> { this.clips.set(c.id, { ...c, sessionId: c.sessionId ?? null }); }
  async getClip(id: string): Promise<ClipRow | null> { const c = this.clips.get(id); return c ? { ...c } : null; }

  async listRuns(q: RunQuery): Promise<RunPage> {
    const all = [...this.levelRuns(q.levelId).values()];
    all.sort(q.best ? (a, b) => b.maxProgress - a.maxProgress || b.run - a.run : (a, b) => b.run - a.run);
    const total = all.length;
    const start = (q.page - 1) * q.pageSize;
    return { runs: all.slice(start, start + q.pageSize).map((r) => ({ ...r })), page: q.page, pageSize: q.pageSize, total, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async summary(levelId: number, maxPoints: number, zones: number): Promise<Summary> {
    const all = [...this.levelRuns(levelId).values()].sort((a, b) => a.run - b.run);
    return summarize(levelId, all, maxPoints, zones);
  }

  async hallOfFame(): Promise<HallEntry[]> {
    return this.hall.map((h) => ({ ...h, levelName: this.levelRows.get(h.levelId)?.name ?? `Level ${h.levelId}` })).sort((a, b) => a.levelId - b.levelId);
  }
  async addHallOfFame(h: HallRow): Promise<void> {
    if (this.hall.some((x) => x.levelId === h.levelId)) return; // a level is beaten once
    this.hall.push({ ...h });
    const l = this.levelRows.get(h.levelId);
    if (l) l.beatenAt = h.beatenAt;
  }
}

/** Bucket size so `n` runs fit in `maxPoints` chart points. */
export const bucketSize = (n: number, maxPoints: number) => Math.max(1, Math.ceil(n / Math.max(1, maxPoints)));

/** The summary from runs sorted by run number (shared by the memory store and tests of the SQL). */
export function summarize(levelId: number, runs: readonly RunRow[], maxPoints: number, zones: number): Summary {
  const zoneReach = new Array<number>(zones).fill(0);
  const records: SeriesPoint[] = [];
  let best = -1;
  for (const r of runs) {
    for (let z = 0; z <= Math.min(r.zoneReached, zones - 1); z++) zoneReach[z]!++;
    if (r.maxProgress > best) { best = r.maxProgress; records.push([r.run, r.maxProgress, r.endedAt]); }
  }
  const bucket = bucketSize(runs.length, maxPoints);
  const series: SeriesPoint[] = [];
  if (runs.length) {
    // buckets by run number, like the SQL: (run - 1) / bucket
    let key = -1;
    for (const r of runs) {
      const k = Math.floor((r.run - 1) / bucket);
      const last = series[series.length - 1];
      if (k !== key || !last) { series.push([r.run, r.maxProgress, r.endedAt]); key = k; continue; }
      if (r.maxProgress > last[1]) { last[0] = r.run; last[1] = r.maxProgress; }
      last[2] = Math.max(last[2], r.endedAt);
    }
  }
  let firstAt: number | null = null, lastAt: number | null = null;
  for (const r of runs) {
    if (firstAt === null || r.startedAt < firstAt) firstAt = r.startedAt;
    if (lastAt === null || r.endedAt > lastAt) lastAt = r.endedAt;
  }
  return { levelId, attempts: runs.length, zoneReach, series, bucket, records, firstAt, lastAt };
}
