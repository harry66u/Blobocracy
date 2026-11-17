import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { ReplayKind } from '@blobocracy/shared';
import { bucketSize } from './memory';
import type {
  ClipRow, HallEntry, HallRow, LevelInfo, LevelRow, LevelVersionRow, RunPage, RunQuery, RunRow, SeriesPoint, Store, Summary, WorldRow,
} from './types';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const ms = (d: Date | string | null): number | null => (d === null ? null : new Date(d).getTime());
const date = (v: number) => new Date(v);
const bytes = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);

type Row = Record<string, unknown>;
const runOf = (r: Row): RunRow => ({
  levelId: Number(r.level_id), levelVersion: Number(r.level_version), run: Number(r.run_number),
  startedAt: ms(r.started_at as Date)!, endedAt: ms(r.ended_at as Date)!, durationMs: Number(r.duration_ms),
  maxProgress: Number(r.max_progress), maxX: Number(r.max_x), zoneReached: Number(r.zone_reached), cause: String(r.cause),
  peakPlayers: Number(r.peak_players), clipId: (r.clip_id as string | null) ?? null, sessionId: (r.session_id as string | null) ?? null,
});
const point = (r: Row): SeriesPoint => [Number(r.run), Number(r.p), ms(r.at as Date)!];

/** Postgres via `postgres` (porsager). `DATABASE_URL`; migrations in packages/sim/migrations, applied on init. */
export class PostgresStore implements Store {
  readonly sql: postgres.Sql;
  /**
   * A separate small pool for the public read API (history pages, clips), so page views can never
   * take the connections that runs, clips and the world row are written on (review C1).
   */
  readonly read: postgres.Sql;

  constructor(url: string, opts: { max?: number; readMax?: number; connectTimeoutS?: number; migrationsDir?: string } = {}) {
    this.sql = postgres(url, {
      max: opts.max ?? 4, idle_timeout: 30, connect_timeout: opts.connectTimeoutS ?? 5, onnotice: () => {},
      // one statement should never hang the write queue for long
      connection: { statement_timeout: 15_000, application_name: 'blobocracy-sim' },
    });
    this.read = postgres(url, {
      max: opts.readMax ?? 2, idle_timeout: 30, connect_timeout: opts.connectTimeoutS ?? 5, onnotice: () => {},
      connection: { statement_timeout: 10_000, application_name: 'blobocracy-sim-read' },
    });
    this.migrationsDir = opts.migrationsDir ?? MIGRATIONS_DIR;
  }
  private migrationsDir: string;

  async init(): Promise<void> {
    const files = (await readdir(this.migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    await this.sql.begin(async (tx) => {
      // one sim at a time; the lock is released with the transaction
      await tx`SELECT pg_advisory_xact_lock(724501)`;
      await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      const done = new Set((await tx`SELECT name FROM schema_migrations`).map((r) => String(r.name)));
      for (const f of files) {
        if (done.has(f)) continue;
        await tx.unsafe(await readFile(`${this.migrationsDir}/${f}`, 'utf8'));
        await tx`INSERT INTO schema_migrations (name) VALUES (${f}) ON CONFLICT DO NOTHING`;
      }
    });
  }

  async close(): Promise<void> { await Promise.all([this.sql.end({ timeout: 5 }), this.read.end({ timeout: 5 })]); }

  async ensureLevel(l: LevelInfo): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO levels (id, name, unlocked_at, current_version) VALUES (${l.id}, ${l.name}, now(), ${l.version})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, current_version = EXCLUDED.current_version`;
      await tx`INSERT INTO level_versions (level_id, version, geometry_hash, notes) VALUES (${l.id}, ${l.version}, ${l.geometryHash}, ${l.notes ?? ''})
        ON CONFLICT (level_id, version) DO NOTHING`;
    });
  }

  async levels(): Promise<LevelRow[]> {
    const rows = await this.sql`SELECT * FROM levels ORDER BY id`;
    return rows.map((r) => ({
      id: Number(r.id), name: String(r.name), createdAt: ms(r.created_at)!, unlockedAt: ms(r.unlocked_at), beatenAt: ms(r.beaten_at),
      currentVersion: Number(r.current_version),
    }));
  }

  async levelVersions(levelId: number): Promise<LevelVersionRow[]> {
    const rows = await this.sql`SELECT * FROM level_versions WHERE level_id = ${levelId} ORDER BY version`;
    return rows.map((r) => ({ levelId: Number(r.level_id), version: Number(r.version), geometryHash: String(r.geometry_hash), createdAt: ms(r.created_at)!, notes: String(r.notes) }));
  }

  async loadWorld(levelId: number): Promise<WorldRow | null> {
    const [r] = await this.sql`SELECT * FROM world WHERE level_id = ${levelId}`;
    if (!r) return null;
    const record = r.record_progress === null ? null
      : { progress: Number(r.record_progress), run: Number(r.record_run), version: Number(r.record_version ?? 1) };
    const row: WorldRow = { levelId, deaths: Number(r.deaths), record, peakPlayers: Number(r.peak_players) };
    if (r.next_run !== null && r.next_run !== undefined) row.nextRun = Number(r.next_run);
    return row;
  }

  async saveWorld(w: WorldRow): Promise<void> {
    // The record is only replaced by a better one: a sim that booted without the database (counters
    // from zero) must never clobber the all-time record when its queued row lands.
    await this.sql`INSERT INTO world (level_id, deaths, record_progress, record_run, record_version, peak_players, next_run, updated_at)
      VALUES (${w.levelId}, ${w.deaths}, ${w.record?.progress ?? null}, ${w.record?.run ?? null}, ${w.record?.version ?? null}, ${w.peakPlayers}, ${w.nextRun ?? null}, now())
      ON CONFLICT (level_id) DO UPDATE SET deaths = GREATEST(world.deaths, EXCLUDED.deaths),
        record_progress = CASE WHEN world.record_progress IS NULL OR EXCLUDED.record_progress > world.record_progress THEN EXCLUDED.record_progress ELSE world.record_progress END,
        record_run = CASE WHEN world.record_progress IS NULL OR EXCLUDED.record_progress > world.record_progress THEN EXCLUDED.record_run ELSE world.record_run END,
        record_version = CASE WHEN world.record_progress IS NULL OR EXCLUDED.record_progress > world.record_progress THEN EXCLUDED.record_version ELSE world.record_version END,
        peak_players = GREATEST(world.peak_players, EXCLUDED.peak_players),
        next_run = GREATEST(world.next_run, EXCLUDED.next_run), updated_at = now()`;
  }

  async recordRun(r: RunRow): Promise<void> {
    await this.sql`INSERT INTO runs (level_id, level_version, run_number, started_at, ended_at, duration_ms, max_progress, max_x, zone_reached, cause, peak_players, clip_id, session_id)
      VALUES (${r.levelId}, ${r.levelVersion}, ${r.run}, ${date(r.startedAt)}, ${date(r.endedAt)}, ${Math.round(r.durationMs)}, ${r.maxProgress}, ${r.maxX},
        ${r.zoneReached}, ${r.cause}, ${r.peakPlayers}, ${r.clipId}, ${r.sessionId ?? null})
      ON CONFLICT (level_id, run_number) DO NOTHING`;
  }

  async attachClip(levelId: number, run: number, clipId: string): Promise<void> {
    await this.sql`UPDATE runs SET clip_id = ${clipId} WHERE level_id = ${levelId} AND run_number = ${run} AND clip_id IS NULL`;
  }

  async saveClip(c: ClipRow): Promise<void> {
    await this.sql`INSERT INTO clips (id, level_id, level_version, run_number, kind, created_at, progress, cause, deaths, replay, og_image, session_id)
      VALUES (${c.id}, ${c.levelId}, ${c.levelVersion}, ${c.run}, ${c.kind}, ${date(c.createdAt)}, ${c.progress}, ${c.cause}, ${c.deaths},
        ${bytes(c.replay)}, ${c.og ? bytes(c.og) : null}, ${c.sessionId ?? null})
      ON CONFLICT (id) DO NOTHING`;
  }

  async getClip(id: string): Promise<ClipRow | null> {
    const [r] = await this.read`SELECT * FROM clips WHERE id = ${id}`;
    if (!r) return null;
    return {
      id: String(r.id), levelId: Number(r.level_id), levelVersion: Number(r.level_version), run: Number(r.run_number), kind: r.kind as ReplayKind,
      createdAt: ms(r.created_at)!, progress: Number(r.progress), cause: String(r.cause), deaths: Number(r.deaths),
      replay: new Uint8Array(r.replay as Buffer), og: r.og_image ? new Uint8Array(r.og_image as Buffer) : null, sessionId: (r.session_id as string | null) ?? null,
    };
  }

  async listRuns(q: RunQuery): Promise<RunPage> {
    const off = (q.page - 1) * q.pageSize;
    const [rows, [count]] = await Promise.all([
      q.best
        ? this.read`SELECT * FROM runs WHERE level_id = ${q.levelId} ORDER BY max_progress DESC, run_number DESC LIMIT ${q.pageSize} OFFSET ${off}`
        : this.read`SELECT * FROM runs WHERE level_id = ${q.levelId} ORDER BY run_number DESC LIMIT ${q.pageSize} OFFSET ${off}`,
      this.read`SELECT count(*)::int AS n FROM runs WHERE level_id = ${q.levelId}`,
    ]);
    const total = Number(count?.n ?? 0);
    return { runs: rows.map(runOf), page: q.page, pageSize: q.pageSize, total, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async summary(levelId: number, maxPoints: number, zones: number): Promise<Summary> {
    const [agg] = await this.read`SELECT count(*)::int AS n, min(started_at) AS first, max(ended_at) AS last FROM runs WHERE level_id = ${levelId}`;
    const n = Number(agg?.n ?? 0);
    const bucket = bucketSize(n, maxPoints);
    const [reach, series, records] = await Promise.all([
      this.read`SELECT zone_reached AS z, count(*)::int AS n FROM runs WHERE level_id = ${levelId} GROUP BY zone_reached`,
      // each bucket's best run (ties: the earlier run) and the bucket's last end time
      this.read`SELECT DISTINCT ON (b) run_number AS run, max_progress AS p, max(ended_at) OVER (PARTITION BY b) AS at
        FROM (SELECT *, (run_number - 1) / ${bucket}::int AS b FROM runs WHERE level_id = ${levelId}) t
        ORDER BY b, max_progress DESC, run_number ASC`,
      this.read`SELECT run_number AS run, max_progress AS p, ended_at AS at FROM (
          SELECT run_number, max_progress, ended_at,
            max(max_progress) OVER (ORDER BY run_number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before
          FROM runs WHERE level_id = ${levelId}) t
        WHERE before IS NULL OR max_progress > before ORDER BY run_number`,
    ]);
    const zoneReach = new Array<number>(zones).fill(0);
    for (const r of reach) for (let z = 0; z <= Math.min(Number(r.z), zones - 1); z++) zoneReach[z]! += Number(r.n);
    return {
      levelId, attempts: n, zoneReach, bucket, series: series.map(point), records: records.map(point),
      firstAt: ms((agg?.first as Date | null) ?? null), lastAt: ms((agg?.last as Date | null) ?? null),
    };
  }

  async hallOfFame(): Promise<HallEntry[]> {
    const rows = await this.read`SELECT h.*, l.name FROM hall_of_fame h LEFT JOIN levels l ON l.id = h.level_id ORDER BY h.level_id`;
    return rows.map((r) => ({
      levelId: Number(r.level_id), levelName: String(r.name ?? `Level ${r.level_id}`), beatenAt: ms(r.beaten_at)!, deathCount: Number(r.death_count),
      peakPlayers: Number(r.peak_players), run: Number(r.run_number), clipId: (r.clip_id as string | null) ?? null,
    }));
  }

  async addHallOfFame(h: HallRow): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`INSERT INTO hall_of_fame (level_id, beaten_at, death_count, peak_players, run_number, clip_id)
        VALUES (${h.levelId}, ${date(h.beatenAt)}, ${h.deathCount}, ${h.peakPlayers}, ${h.run}, ${h.clipId})
        ON CONFLICT (level_id) DO NOTHING`;
      await tx`UPDATE levels SET beaten_at = COALESCE(beaten_at, ${date(h.beatenAt)}) WHERE id = ${h.levelId}`;
    });
  }
}
