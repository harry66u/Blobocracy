import { CLIP_ID_RE, deathSentence, progressOf, type Level } from '@blobocracy/shared';
import type uWS from 'uWebSockets.js';
import { PENDING_WAIT_MS, type History } from './history';
import { clipMeta, type ClipRow, type RunRow, type Store } from './store';

/**
 * The public read API (spec §12 pages), served by the sim's internal HTTP port; edges proxy
 * `/api/*` to it and cache the answers (see packages/edge/src/api.ts).
 *   GET /api/counter                 deaths, run, record, online
 *   GET /api/summary                 the chart and the header of /runs
 *   GET /api/runs?page=1&best=1      run history, 25 a page (best: furthest first)
 *   GET /api/hall                    beaten levels (and the current level for the empty state)
 *   GET /api/clips/<id>              the packed replay (binary, immutable)
 *   GET /api/clips/<id>/meta         what the clip is about (for link previews)
 *   GET /api/clips/<id>/og.png       its link-preview image
 */
export interface ApiResponse { status: number; type: string; body: string | Uint8Array; cache: string }

export interface ApiDeps {
  store: Store;
  level: Level;
  history?: History | null;
  levelName: string;
  counter: () => { deaths: number; run: number; record: { progress: number; run: number } | null; online: number };
  /** Chart points at most (runs are bucketed past this). */
  maxPoints?: number;
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

/** "Run 4,812 made it 78%…" — the link-preview title of a clip. */
export function clipTitle(c: Pick<ClipRow, 'kind' | 'run' | 'progress'>): string {
  const run = `Run ${c.run.toLocaleString('en-US')}`;
  if (c.kind === 'win') return `${run} beat Blobocracy!`;
  const pct = `${Math.round(c.progress * 100)}%`;
  return c.kind === 'record' ? `New record! ${run} made it ${pct}…` : `So close. ${run} made it ${pct}…`;
}

export function createApi(d: ApiDeps) {
  const maxPoints = d.maxPoints ?? 2400;

  async function clip(id: string): Promise<ClipRow | null> {
    const c = await d.store.getClip(id);
    if (c) return c;
    // made right now (reserved at the death, saved when the run resets): wait for it
    const making = d.history?.whenMade(id);
    if (!making) return null;
    return Promise.race([making, new Promise<null>((r) => setTimeout(() => r(null), PENDING_WAIT_MS))]);
  }

  async function route(path: string, q: URLSearchParams): Promise<ApiResponse> {
    if (path === '/api/counter') {
      const c = d.counter();
      return json(200, c, 'public, max-age=5');
    }
    if (path === '/api/summary') {
      const s = await d.store.summary(d.level.id, maxPoints, d.level.zones.length);
      const c = d.counter();
      return json(200, {
        levelId: d.level.id, levelName: d.levelName, ...c, attempts: s.attempts,
        zones: d.level.zones.map((z) => ({ index: z.index, name: z.name, sky: z.sky, start: progressOf(d.level, z.startX) })),
        zoneReach: s.zoneReach, series: s.series, bucket: s.bucket, records: s.records, firstAt: s.firstAt, lastAt: s.lastAt,
      }, 'public, max-age=10');
    }
    if (path === '/api/runs') {
      const page = intParam(q.get('page'), 1, 1, 100_000);
      const pageSize = intParam(q.get('size'), PAGE_SIZE, 1, 100);
      const best = truthy(q.get('best'));
      const r = await d.store.listRuns({ levelId: d.level.id, page, pageSize, best });
      return json(200, { page: r.page, pages: r.pages, pageSize: r.pageSize, total: r.total, best, record: d.counter().record, runs: r.runs.map(runJson) }, 'public, max-age=5');
    }
    if (path === '/api/hall') {
      const entries = await d.store.hallOfFame();
      const c = d.counter();
      return json(200, { entries, current: { levelId: d.level.id, name: d.levelName, deaths: c.deaths, record: c.record } }, 'public, max-age=10');
    }
    const m = path.match(/^\/api\/clips\/([^/]+)(\/meta|\/og\.png)?$/);
    if (m) {
      const id = m[1]!;
      if (!CLIP_ID_RE.test(id)) return notFound();
      const c = await clip(id);
      if (!c) return notFound();
      if (m[2] === '/meta') {
        return json(200, { ...clipMeta(c), title: clipTitle(c), description: deathSentence(c.run, c.progress, c.cause) }, 'public, max-age=300');
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
      console.warn(`[api] ${path}: ${e instanceof Error ? e.message : String(e)}`);
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
