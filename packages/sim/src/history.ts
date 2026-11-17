import { randomBytes } from 'node:crypto';
import {
  TICK_HZ, ReplayRecorder, packReplay, progressOf, zoneAt,
  type Level, type ReplayKind, type ServerEvent,
} from '@blobocracy/shared';
import type { LiveSnapshot } from './live';
import { renderClipOg, type OgCard } from './og';
import type { ClipRow, RecordMark, RunRow, Store } from './store';
import type { World } from './world';

/** Spec §13: a death clip is the last 30 s, ending when the run resets (so the card is in it). */
export const CLIP_SECONDS = 30;
export const WIN_CLIP_SECONDS = 60;
/** A "new record" this small is not worth a clip (the first few runs of a level). */
export const MIN_RECORD_CLIP = 0.05;
/** How long the clip API holds a request for a clip that is being made (death → reset ≈ 3.5 s). */
export const PENDING_WAIT_MS = 8000;

export const newClipId = () => randomBytes(6).toString('base64url');

/** Which clip a death earns, if any (spec §13): beating the old record, or dying within 5% of it. */
export function clipKindFor(death: Extract<ServerEvent, { t: 'death' }>, setRecord: boolean): ReplayKind | null {
  if (setRecord && death.progress >= MIN_RECORD_CLIP) return 'record';
  if (death.nearRecord) return 'near_miss';
  return null;
}

interface Pending { id: string; kind: ReplayKind; run: number; progress: number; cause: string; deaths: number; record: number | null; sky: OgCard['sky']; resolve: (c: ClipRow | null) => void }

export interface HistoryOptions {
  store: Store;
  level: Level;
  now?: () => number;
  newId?: () => string;
  /** Renders the link-preview PNG for a clip (default: og.ts); null = no image. */
  renderOg?: (c: OgCard) => Promise<Uint8Array | null>;
  log?: (msg: string) => void;
}

/**
 * Run bookkeeping and clips. Fed by the sim loop: every step (online count), every batch of
 * world events, and every broadcast frame. On a death it records the run (and the world row);
 * when the death earns a clip it reserves the clip id right away (so the death card can offer
 * "Share the clip" during the hold) and makes the clip when the run resets.
 */
export class History {
  readonly recorder: ReplayRecorder;
  readonly store: Store;
  readonly level: Level;
  runStartedAt: number;
  runPeak = 0;
  runMaxX: number;
  peakPlayers = 0;
  recordVersion: number | null = null;
  private pending: Pending | null = null;
  private making = new Map<string, Promise<ClipRow | null>>();
  private eventsSinceFrame: ServerEvent[] = [];
  private needWelcome = true;
  private now: () => number;
  private newId: () => string;
  private renderOg: (c: OgCard) => Promise<Uint8Array | null>;
  private log: (m: string) => void;
  clipsMade = 0;

  constructor(o: HistoryOptions) {
    this.store = o.store;
    this.level = o.level;
    this.now = o.now ?? Date.now;
    this.newId = o.newId ?? newClipId;
    this.renderOg = o.renderOg ?? renderClipOg;
    this.log = o.log ?? console.log;
    this.recorder = new ReplayRecorder({ levelId: o.level.id, levelVersion: o.level.version, maxSeconds: WIN_CLIP_SECONDS });
    this.runStartedAt = this.now();
    this.runMaxX = o.level.spawn.x;
  }

  /** Every sim step. */
  observe(world: World, online: number): void {
    if (online > this.runPeak) this.runPeak = online;
    if (online > this.peakPlayers) this.peakPlayers = online;
    if (world.phase === 'running' && world.body.x > this.runMaxX) this.runMaxX = world.body.x;
  }

  /**
   * World events from one step. Returns extra events to broadcast (a clip announcement).
   * `recordBefore` is the record as it was before this step.
   */
  onEvents(events: readonly ServerEvent[], world: World, recordBefore: { progress: number; run: number } | null): ServerEvent[] {
    const out: ServerEvent[] = [];
    for (const e of events) {
      this.eventsSinceFrame.push(e);
      if (e.t === 'record') this.recordVersion = this.level.version;
      else if (e.t === 'death') {
        const setRecord = events.some((x) => x.t === 'record' && x.run === e.run);
        const row: RunRow = {
          levelId: this.level.id, levelVersion: this.level.version, run: e.run,
          startedAt: this.runStartedAt, endedAt: this.now(), durationMs: Math.round((world.runTick * 1000) / TICK_HZ),
          maxProgress: e.progress, maxX: Math.max(this.runMaxX, world.body.x), zoneReached: e.zone, cause: e.cause,
          peakPlayers: this.runPeak, clipId: null,
        };
        void this.store.recordRun(row);
        void this.store.saveWorld({ levelId: this.level.id, deaths: e.deaths, record: this.recordMark(world), peakPlayers: this.peakPlayers });
        const kind = clipKindFor(e, setRecord);
        if (kind) {
          const id = this.newId();
          const ref = kind === 'record' ? recordBefore?.progress ?? null : world.record?.progress ?? null;
          let resolve!: (c: ClipRow | null) => void;
          this.making.set(id, new Promise((r) => { resolve = r; }));
          this.pending = {
            id, kind, run: e.run, progress: e.progress, cause: e.cause, deaths: e.deaths, record: ref, resolve,
            sky: zoneAt(this.level, this.level.spawn.x + e.progress * (this.level.goalX - this.level.spawn.x)).sky,
          };
          out.push({ t: 'clip', id, kind, run: e.run });
        }
      } else if (e.t === 'reset') {
        this.finishClip();
        this.runStartedAt = this.now();
        this.runPeak = 0;
        this.runMaxX = this.level.spawn.x;
      }
    }
    return out;
  }

  /** Every broadcast frame (exact bytes), with the events since the previous frame. */
  onFrame(frame: Uint8Array, world: World, online: number): void {
    const events = this.eventsSinceFrame;
    this.eventsSinceFrame = [];
    if (this.needWelcome) { events.unshift(world.welcome(online)); this.needWelcome = false; }
    this.recorder.push(frame, events);
  }

  private recordMark(world: World): RecordMark | null {
    return world.record ? { ...world.record, version: this.recordVersion ?? this.level.version } : null;
  }

  /** Snapshot, pack, render the preview, save, link to the run. Runs in the background. */
  private finishClip(): void {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    const replay = this.recorder.snapshot(p.kind, p.kind === 'win' ? WIN_CLIP_SECONDS : CLIP_SECONDS, { run: p.run, progress: p.progress });
    const done = (c: ClipRow | null) => { p.resolve(c); setTimeout(() => this.making.delete(p.id), PENDING_WAIT_MS); };
    if (!replay) { done(null); return; }
    const zoneStarts = this.level.zones.map((z) => progressOf(this.level, z.startX));
    void (async () => {
      try {
        const bytes = await packReplay(replay);
        let og: Uint8Array | null = null;
        try {
          og = await this.renderOg({ run: p.run, progress: p.progress, cause: p.cause, kind: p.kind, deaths: p.deaths, sky: p.sky, zoneStarts, record: p.record });
        } catch (e) { this.log(`[clips] preview image failed: ${String(e)}`); }
        const row: ClipRow = {
          id: p.id, levelId: this.level.id, levelVersion: this.level.version, run: p.run, kind: p.kind, createdAt: this.now(),
          progress: p.progress, cause: p.cause, deaths: p.deaths, replay: bytes, og,
        };
        await this.store.saveClip(row);
        await this.store.attachClip(this.level.id, p.run, p.id);
        this.clipsMade++;
        this.log(`[clips] ${p.kind} clip ${p.id} for run ${p.run} (${Math.round(p.progress * 100)}%, ${bytes.length} bytes)`);
        done(row);
      } catch (e) {
        this.log(`[clips] clip ${p.id} failed: ${String(e)}`);
        done(null);
      }
    })();
  }

  /** A clip being made right now (reserved at the death), or null if `id` is not one. */
  whenMade(id: string): Promise<ClipRow | null> | null {
    return this.making.get(id) ?? null;
  }

  /** Bookkeeping fields for the live snapshot. */
  live(): Pick<LiveSnapshot, 'runStartedAt' | 'runPeak' | 'runMaxX' | 'peakPlayers' | 'recordVersion'> {
    return { runStartedAt: this.runStartedAt, runPeak: this.runPeak, runMaxX: this.runMaxX, peakPlayers: this.peakPlayers, recordVersion: this.recordVersion };
  }

  restore(s: Pick<LiveSnapshot, 'runStartedAt' | 'runPeak' | 'runMaxX' | 'peakPlayers' | 'recordVersion'>, freshRun: boolean): void {
    this.peakPlayers = Math.max(this.peakPlayers, s.peakPlayers);
    this.recordVersion = s.recordVersion;
    if (freshRun) return;
    this.runStartedAt = s.runStartedAt;
    this.runPeak = s.runPeak;
    this.runMaxX = s.runMaxX;
  }
}
