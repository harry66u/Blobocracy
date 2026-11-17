import { CLIP_ID_RE, deathSentence, levelTitle, progressOf, trackId, trackOf, type Level } from '@blobocracy/shared';
import type uWS from 'uWebSockets.js';
import { PENDING_WAIT_MS, type History } from './history';
import { clipMeta, type ClipRow, type RunRow, type Store, type Summary } from './store';

/**
 * The public read API (spec §12 pages), served by the sim's internal HTTP port; edges proxy
 * `/api/*` to it and cache the answers (see packages/edge/src/api.ts).
 *   GET /api/counter                 deaths, run, record, online
 *   GET /api/levels                  the levels so far (track ids for ?level=), which is current, which are beaten
 *   GET /api/summary?level=<track>   the chart and the header of /runs (default: the current level)
 *   GET /api/runs?page=1&best=1&level=<track>  run history, 25 a page (best: furthest first)
 *   GET /api/hall                    beaten levels, the current level (empty state), and whether a new level is coming
 *   GET /api/clips/<id>              the packed replay (binary, immutable)
 *   GET /api/clips/<id>/meta         what the clip is about (for link previews)
 *   GET /api/clips/<id>/og.png       its link-preview image
 */
export interface ApiResponse { status: number; type: string; body: string | Uint8Array; cache: string }

/** The level being played: its geometry, display name, and whether it is an encore. */
export interface CurrentLevel { level: Level; name: string; encore: boolean }

export interface ApiDeps {
  store: Store;
  /** The level when there is only one (tests); `current` wins when given. */
  level: Level;
  history?: History | null;
  levelName: string;
  /** The level being played right now (it changes after a win). */
  current?: () => CurrentLevel;
  /** Every built level in order (default [level]). */
  levels?: readonly Level[];
  counter: () => { deaths: number; run: number; record: { progress: number; run: number } | null; online: number };
  /** Chart points at most (runs are bucketed past this). */
  maxPoints?: number;
  /**
   * History reads at once (default 2) and waiting (default 32); past that a request is refused
   * with a 503 instead of piling up. The sim's thread and its database connections are shared
   * with the game, so anonymous page views must never be able to queue unbounded work (C1).
   */
  reads?: { concurrency?: number; queue?: number };
  /** How long one track's summary (the heaviest query) is reused (default 5 s). */
  summaryTtlMs?: number;
  now?: () => number;
}

class Busy extends Error {}

/** Runs at most `concurrency` tasks at once with at most `queue` waiting; beyond that, throws Busy. */
export function limiter(concurrency: number, queue: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running < concurrency) running++;
    else {
      if (waiting.length >= queue) throw new Busy('busy');
      await new Promise<void>((r) => waiting.push(r)); // the slot is handed over by the task that frees it
    }
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next(); else running--;
    }
  };
}

export const PAGE_SIZE = 25;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const json = (status: number, body: unknown, cache = 'no-store'): ApiResponse => ({ status, type: 'application/json', body: JSON.stringify(body), cache });
const notFound = () => json(404, { error: 'not found' }, 'public, max-age=30');

/** A positive integer query parameter, clamped. */
export function intParam(v: string | null, def: number, min: number, max: number): number {
  const n = v === null || v === '' ? def : Number(v);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

const truthy = (v: string | null) => v === '1' || v === 'true' || v === 'yes';

export const runJson = (r: RunRow) => ({
  run: r.run, version: r.levelVersion, startedAt: r.startedAt, endedAt: r.endedAt, durationMs: r.durationMs,
  progress: r.maxProgress, zone: r.zoneReached, cause: r.cause, peakPlayers: r.peakPlayers, clipId: r.clipId,
});

const ENCORE_SUFFIX = ' · Encore';

/** "Run 4,812 made it 78%…" — the link-preview title of a clip. */
export function clipTitle(c: Pick<ClipRow, 'kind' | 'run' | 'progress'>): string {
  const run = `Run ${c.run.toLocaleString('en-US')}`;
  if (c.kind === 'win') return `${run} beat Blobocracy!`;
  const pct = `${Math.round(c.progress * 100)}%`;
  return c.kind === 'record' ? `New record! ${run} made it ${pct}…` : `So close. ${run} made it ${pct}…`;
}

/** A clip still being made after the wait: try again shortly (never cached, so the edge asks again). */
const MAKING = (): ApiResponse => ({ status: 503, type: 'application/json', body: JSON.stringify({ error: 'This clip is still being made.', making: true }), cache: 'no-store' });
/** A clip that was being made when the sim restarted: gone for good, said kindly (cached like a 404). */
const LOST = (): ApiResponse => ({
  status: 410, type: 'application/json', cache: 'public, max-age=300',
  body: JSON.stringify({ error: "This clip didn't make it: the blob restarted while it was being made.", lost: true }),
});
/** The longest the API holds one request for a clip being made; past it the client retries. */
const MAX_HOLD_MS = 10_000;

export function createApi(d: ApiDeps) {
  const maxPoints = d.maxPoints ?? 2400;
  const now = d.now ?? Date.now;
  const limit = limiter(d.reads?.concurrency ?? 2, d.reads?.queue ?? 32);
  const summaries = new Map<number, { at: number; p: Promise<Summary> }>();
  /** The store's reads, a few at a time; the summary shared per track for a few seconds. */
  const reads = {
    getClip: (id: string) => limit(() => d.store.getClip(id)),
    loadWorld: (track: number) => limit(() => d.store.loadWorld(track)),
    hallOfFame: () => limit(() => d.store.hallOfFame()),
    listRuns: (q: Parameters<Store['listRuns']>[0]) => limit(() => d.store.listRuns(q)),
    summary: (track: number, zones: number): Promise<Summary> => {
      const hit = summaries.get(track);
      if (hit && now() - hit.at < (d.summaryTtlMs ?? 5000)) return hit.p;
      const p = limit(() => d.store.summary(track, maxPoints, zones));
      const e = { at: now(), p };
      summaries.set(track, e);
      p.catch(() => { if (summaries.get(track) === e) summaries.delete(track); });
      return p;
    },
  };
  const levels = d.levels?.length ? d.levels : [d.level];
  const cur = (): CurrentLevel => d.current?.() ?? { level: d.level, name: d.levelName, encore: false };
  const curTrack = () => { const c = cur(); return trackId(c.level.id, c.encore); };
  const nameOf = (level: Level, encore: boolean) => (cur().level.id === level.id && !d.current ? d.levelName : levelTitle(level)) + (encore ? ENCORE_SUFFIX : '');

  /** The track a ?level= asks for: a known level (or its encore), else the current one. */
  function trackParam(v: string | null): { track: number; level: Level; encore: boolean } {
    const n = v === null || v === '' ? NaN : Number(v);
    if (Number.isInteger(n)) {
      const t = trackOf(n);
      const level = levels.find((l) => l.id === t.levelId);
      if (level) return { track: n, level, encore: t.encore };
    }
    const c = cur();
    return { track: curTrack(), level: c.level, encore: c.encore };
  }

  /** Deaths and record of a track: live for the current one, else from storage. */
  async function countersOf(track: number) {
    const c = d.counter();
    if (track === curTrack()) return c;
    const w = await reads.loadWorld(track);
    return { deaths: w?.deaths ?? 0, run: (w?.deaths ?? 0) + 1, record: w?.record ? { progress: w.record.progress, run: w.record.run } : null, online: c.online };
  }

  async function clip(id: string): Promise<ClipRow | null | 'making'> {
    const c = await reads.getClip(id);
    if (c) return c;
    // made right now (reserved at the death or the win, saved when the run resets or the celebration ends): wait for it
    const making = d.history?.whenMade(id);
    if (!making) return null;
    const wait = Math.min(MAX_HOLD_MS, d.history?.waitMs(id) ?? PENDING_WAIT_MS);
    return Promise.race([making, new Promise<'making'>((r) => setTimeout(() => r('making'), wait))]);
  }

  async function route(path: string, q: URLSearchParams): Promise<ApiResponse> {
    if (path === '/api/counter') {
      const c = d.counter(), now = cur();
      return json(200, { ...c, levelId: now.level.id, encore: now.encore }, 'public, max-age=5');
    }
    if (path === '/api/levels') {
      const hall = await reads.hallOfFame();
      const beaten = new Set(hall.map((h) => h.levelId));
      const now = curTrack();
      const curIdx = levels.findIndex((l) => l.id === cur().level.id);
      const out = levels.filter((_, i) => i <= curIdx || beaten.has(levels[i]!.id))
        .map((l) => ({ track: l.id, levelId: l.id, name: nameOf(l, false), encore: false, beaten: beaten.has(l.id), current: now === l.id }));
      const last = levels[levels.length - 1]!;
      const encoreTrack = trackId(last.id, true);
      if (now === encoreTrack || beaten.has(encoreTrack)) {
        out.push({ track: encoreTrack, levelId: last.id, name: nameOf(last, true), encore: true, beaten: beaten.has(encoreTrack), current: now === encoreTrack });
      }
      return json(200, { current: now, levels: out }, 'public, max-age=10');
    }
    if (path === '/api/summary') {
      const t = trackParam(q.get('level'));
      const L = t.level;
      const [s, c] = await Promise.all([reads.summary(t.track, L.zones.length), countersOf(t.track)]);
      return json(200, {
        levelId: L.id, track: t.track, encore: t.encore, current: t.track === curTrack(), levelName: nameOf(L, t.encore), ...c, attempts: s.attempts,
        zones: L.zones.map((z) => ({ index: z.index, name: z.name, sky: z.sky, start: progressOf(L, z.startX) })),
        zoneReach: s.zoneReach, series: s.series, bucket: s.bucket, records: s.records, firstAt: s.firstAt, lastAt: s.lastAt,
      }, 'public, max-age=10');
    }
    if (path === '/api/runs') {
      const page = intParam(q.get('page'), 1, 1, 100_000);
      const pageSize = intParam(q.get('size'), PAGE_SIZE, 1, 100);
      const best = truthy(q.get('best'));
      const t = trackParam(q.get('level'));
      const [r, c] = await Promise.all([reads.listRuns({ levelId: t.track, page, pageSize, best }), countersOf(t.track)]);
      return json(200, { track: t.track, page: r.page, pages: r.pages, pageSize: r.pageSize, total: r.total, best, record: c.record, runs: r.runs.map(runJson) }, 'public, max-age=5');
    }
    if (path === '/api/hall') {
      const rows = await reads.hallOfFame();
      const c = d.counter();
      const now = cur();
      const entries = rows.map((h) => {
        const t = trackOf(h.levelId);
        return { ...h, levelId: t.levelId, track: h.levelId, encore: t.encore };
      });
      const last = levels[levels.length - 1]!;
      const idx = levels.findIndex((l) => l.id === now.level.id);
      const next = idx >= 0 && idx + 1 < levels.length ? levels[idx + 1]! : null;
      return json(200, {
        entries,
        current: { levelId: now.level.id, name: now.name, deaths: c.deaths, record: c.record, encore: now.encore },
        next: next ? { levelId: next.id, name: levelTitle(next) } : null,
        // the last built level has fallen: the hall says a new level is coming (spec §6.7)
        comingSoon: rows.some((h) => h.levelId === last.id),
      }, 'public, max-age=10');
    }
    const m = path.match(/^\/api\/clips\/([^/]+)(\/meta|\/og\.png)?$/);
    if (m) {
      const id = m[1]!;
      if (!CLIP_ID_RE.test(id)) return notFound();
      const c = await clip(id);
      if (c === 'making') return MAKING();
      if (!c) return notFound();
      if (c.replay.length === 0) return LOST();
      if (m[2] === '/meta') {
        const description = c.kind === 'win'
          ? `Run ${c.run.toLocaleString('en-US')} made it all the way after ${c.deaths.toLocaleString('en-US')} deaths. Everyone online steered one blob.`
          : deathSentence(c.run, c.progress, c.cause);
        return json(200, { ...clipMeta(c), title: clipTitle(c), description }, 'public, max-age=300');
      }
      if (m[2] === '/og.png') {
        return c.og ? { status: 200, type: 'image/png', body: c.og, cache: IMMUTABLE } : notFound();
      }
      return { status: 200, type: 'application/octet-stream', body: c.replay, cache: IMMUTABLE };
    }
    return notFound();
  }

  return async (path: string, query: string): Promise<ApiResponse> => {
    try {
      return await route(path.replace(/\/+$/, '') || '/', new URLSearchParams(query));
    } catch (e) {
      if (!(e instanceof Busy)) console.warn(`[api] ${path}: ${e instanceof Error ? e.message : String(e)}`);
      return json(503, { error: 'The history book is catching its breath. Try again in a moment.' });
    }
  };
}

export type ApiHandler = ReturnType<typeof createApi>;

/** Serves the API on a uWS app (the sim's internal port, and the local relay in dev). */
export function mountApi(app: uWS.TemplatedApp, api: () => ApiHandler | null): void {
  app.get('/api/*', (res, req) => {
    const path = req.getUrl(), query = req.getQuery() ?? '';
    const handler = api();
    if (!handler) { res.writeStatus('503 Service Unavailable').end('starting'); return; }
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    void handler(path, query).then((r) => {
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(String(r.status)).writeHeader('content-type', r.type).writeHeader('cache-control', r.cache);
        res.end(r.body);
      });
    });
  });
}
