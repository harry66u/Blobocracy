import {
  CELEBRATE_S, DEATH_FREEZE_S, DEATH_HOLD_S, PHYS, TICK_HZ,
  blend, checkpointsOf, createBody, createBodyAt, createDynamics, levelTitle, stepBody, progressOf, trackId, zoneAt,
  type BlendOut, type Body, type Checkpoint, type Dynamics, type Level, type Phase, type ServerEvent, type VoteCounts, type WinEvent,
} from '@blobocracy/shared';

export interface WorldInit {
  deaths: number;
  record: { progress: number; run: number } | null;
  /** The next run's number (default deaths + 1; an encore win uses a number without a death). */
  run?: number;
}
export type { Phase };

export interface WorldOptions {
  /** Every level in order: beating one unlocks the next; beating the last starts an encore of it. Default [level]. */
  levels?: readonly Level[];
  /** Start in the encore of `level`. */
  encore?: boolean;
  /** How long the celebration lasts (default CELEBRATE_S; shorter in tests). */
  celebrateS?: number;
  /** Checkpoints to use instead of the level's own (tests). */
  checkpoints?: readonly Checkpoint[];
}

/** Everything needed to carry on the run in progress after a restart (spec §9 `live:snapshot`). */
export interface WorldSnapshot {
  tick: number;
  run: number;
  runTick: number;
  deaths: number;
  record: { progress: number; run: number } | null;
  phase: Phase;
  body: Body;
  dyn: { t: number; crumbles: [number, number][]; chompStart: number | null };
  maxProgress: number;
  /** The last checkpoint reached (older snapshots: none). */
  checkpoint?: number;
  zone: number;
  /** The level being played and whether it is an encore (older snapshots: the boot level). */
  levelId?: number;
  encore?: boolean;
  /** Celebrating: ticks left, and the win being celebrated. */
  celebrateLeft?: number;
  win?: WinEvent | null;
  /** The other tracks' counters (track id → deaths and record). */
  counters?: [number, WorldInit][];
}

const DYING_TICKS = Math.round((DEATH_FREEZE_S + DEATH_HOLD_S) * TICK_HZ);
/** Victory hops: the first one after the crown has popped on, then one every HOP_EVERY ticks. */
const HOP_START = Math.round(0.9 * TICK_HZ), HOP_EVERY = Math.round(0.95 * TICK_HZ), HOP_HOLD = 9;
const IDLE_BLEND: BlendOut = { move: 0, jumpHeld: false, jumpPressed: false, freshHigh: false, pull: 0, pressure: 0, strain: 0 };
const NEAR_RECORD = 0.05;
/** Below this, a record is too small for dying near it to be a "so close" moment. */
const MIN_RECORD_FOR_NEAR_MISS = 0.1;

const copyInit = (c: WorldInit): WorldInit => ({ deaths: c.deaths, record: c.record ? { ...c.record } : null, ...(c.run !== undefined ? { run: c.run } : {}) });
/** The next run on a track: its stored counter, never below deaths + 1. */
const nextRunOf = (c: WorldInit) => Math.max(c.deaths + 1, c.run ?? 0);

/**
 * The one shared world: a single blob, one run at a time, one life.
 * Advances exactly one fixed step per call; everything is deterministic.
 *
 * Reaching the goal alive wins the level (spec §6.7): a 'win' event (History fills in its
 * peak players and clip id), then CELEBRATE_S of celebration that ignores inputs while the blob
 * hops on the crown, then a 'level' event and the next level with that level's own counters.
 * Beating the last level starts an encore of it, counted on its own track.
 */
export class World {
  level: Level;
  readonly levels: readonly Level[];
  /** Playing the last level again after it was beaten (its own counters). */
  encore: boolean;
  tick = 0;
  /** Ticks the current run has actually been running. */
  runTick = 0;
  /** The run's clock, crumbles and Big Chomp; advanced only by running steps, fresh every run. */
  dyn: Dynamics = createDynamics();
  run: number;
  deaths: number;
  phase: Phase = 'running';
  body: Body;
  lastBlend: BlendOut = { ...IDLE_BLEND };
  record: { progress: number; run: number } | null;
  maxProgress = 0;
  zone = 0;
  /** The last checkpoint the blob reached this level (0 = none): deaths send everyone back to it. */
  checkpoint = 0;
  private readonly cpOverride: readonly Checkpoint[] | undefined;
  private dyingLeft = 0;
  private celebrateLeft = 0;
  private readonly celebrateTicks: number;
  private winEvent: WinEvent | null = null;
  /** Counters of the tracks not being played (track id → deaths, record). */
  private saved = new Map<number, WorldInit>();

  constructor(level: Level, init: WorldInit = { deaths: 0, record: null }, opts: WorldOptions = {}) {
    this.level = level;
    this.levels = opts.levels?.length ? opts.levels : [level];
    this.encore = opts.encore ?? false;
    this.cpOverride = opts.checkpoints;
    this.celebrateTicks = Math.max(1, Math.round((opts.celebrateS ?? CELEBRATE_S) * TICK_HZ));
    this.deaths = init.deaths;
    this.run = nextRunOf(init);
    this.record = init.record;
    this.body = createBody(level);
  }

  private get checkpoints(): readonly Checkpoint[] { return this.cpOverride ?? checkpointsOf(this.level); }

  /** Where this level's counters, runs and hall of fame entry live. */
  get track(): number { return trackId(this.level.id, this.encore); }

  /** The win being celebrated, or null. */
  get win(): WinEvent | null { return this.phase === 'celebrating' ? this.winEvent : null; }

  /** Counters of a track (from storage) to use when play gets there. Ignored for the track being played. */
  setCounters(track: number, c: WorldInit): void {
    if (track !== this.track) this.saved.set(track, copyInit(c));
  }

  /** Counters of a track: live for the one being played, else the last known. */
  countersFor(track: number): WorldInit | null {
    if (track === this.track) return { deaths: this.deaths, record: this.record ? { ...this.record } : null, run: this.run };
    const c = this.saved.get(track);
    return c ? copyInit(c) : null;
  }

  step(votes: VoteCounts): ServerEvent[] {
    this.tick++;
    const events: ServerEvent[] = [];

    if (this.phase === 'dying') {
      if (--this.dyingLeft <= 0) this.reset(events);
      return events;
    }
    if (this.phase === 'celebrating') {
      this.celebrateStep();
      if (--this.celebrateLeft <= 0) this.advance(events);
      return events;
    }

    if (votes.active === 0) {
      this.phase = 'paused';
      this.lastBlend = { ...IDLE_BLEND };
      return events;
    }
    this.phase = 'running';
    this.runTick++;

    this.lastBlend = blend(votes, this.lastBlend.jumpHeld, this.lastBlend.freshHigh);
    const cause = stepBody(this.body, this.lastBlend, this.level, this.dyn);

    const progress = progressOf(this.level, this.body.x);
    if (progress > this.maxProgress) this.maxProgress = progress;
    const z = zoneAt(this.level, this.body.x).index;
    if (z > this.zone) {
      this.zone = z;
      events.push({ t: 'zone', run: this.run, index: z, name: this.level.zones[z]!.name });
    }

    if (cause) this.die(cause, events);
    else {
      // reaching a checkpoint alive (a step that kills never counts)
      const cps = this.checkpoints;
      while (this.checkpoint < cps.length && this.body.x >= cps[this.checkpoint]!.x) {
        const c = cps[this.checkpoint]!;
        this.checkpoint = c.index;
        events.push({ t: 'checkpoint', run: this.run, index: c.index, progress: c.progress });
      }
      if (this.body.x >= this.level.goalX) this.beat(events);
    }
    return events;
  }

  welcome(online: number): ServerEvent {
    const win = this.win;
    return {
      t: 'welcome', levelId: this.level.id, version: this.level.version, name: levelTitle(this.level), encore: this.encore,
      deaths: this.deaths, record: this.record, run: this.run, zone: this.zone, online,
      ...(this.checkpoint > 0 ? { checkpoint: this.checkpoint } : {}),
      ...(win ? { celebrating: { win, ageS: (this.celebrateTicks - this.celebrateLeft) / TICK_HZ } } : {}),
    };
  }

  /**
   * Dev only (admin debug): puts the blob on the ground a few tiles before the goal, so a
   * win can be checked end to end. Refused during the death hold and the celebration.
   */
  debugNearGoal(): boolean {
    if (this.phase === 'dying' || this.phase === 'celebrating') return false;
    const L = this.level;
    const x = L.goalX - 2.5;
    let row = 12;
    while (row < L.height && L.tiles[row * L.width + Math.floor(x)] === 0) row++;
    this.body = { ...createBody(L), x, y: row - PHYS.halfH, facing: 1 };
    this.zone = zoneAt(L, x).index;
    this.maxProgress = Math.max(this.maxProgress, progressOf(L, x));
    return true;
  }

  /**
   * Dev only (admin debug): puts the blob on checkpoint `n`'s pad just before its flag (hold right
   * to reach it). Refused during the death hold and the celebration, or for a checkpoint that does not exist.
   */
  debugNearCheckpoint(n: number): boolean {
    const cp = this.checkpoints[n - 1];
    if (!cp || this.phase === 'dying' || this.phase === 'celebrating') return false;
    this.body = { ...createBodyAt(this.level, cp.x - 1.2, cp.y), facing: 1 };
    this.zone = zoneAt(this.level, cp.x).index;
    this.maxProgress = Math.max(this.maxProgress, progressOf(this.level, cp.x - 1.2));
    return true;
  }

  /** Dev only (admin debug): drops the blob into the pit, as if the crowd walked it off. */
  debugKill(): boolean {
    if (this.phase === 'dying' || this.phase === 'celebrating') return false;
    this.body.y = this.level.height;
    return true;
  }

  snapshot(): WorldSnapshot {
    return {
      tick: this.tick, run: this.run, runTick: this.runTick, deaths: this.deaths, record: this.record ? { ...this.record } : null,
      phase: this.phase, body: { ...this.body },
      dyn: { t: this.dyn.t, crumbles: [...this.dyn.crumbles], chompStart: this.dyn.chompStart },
      maxProgress: this.maxProgress, zone: this.zone, checkpoint: this.checkpoint,
      levelId: this.level.id, encore: this.encore,
      celebrateLeft: this.celebrateLeft, win: this.win,
      counters: [...this.saved].map(([k, c]) => [k, copyInit(c)]),
    };
  }

  /**
   * Carries on from a snapshot: a restart is not a death. A run caught in its death hold
   * was already counted, so the next run starts fresh. A celebration carries on where it was.
   */
  restore(s: WorldSnapshot): void {
    const level = s.levelId === undefined ? undefined : this.levels.find((l) => l.id === s.levelId);
    if (level) { this.level = level; this.encore = s.encore ?? false; }
    for (const [k, c] of s.counters ?? []) if (k !== this.track) this.saved.set(k, copyInit(c));
    this.saved.delete(this.track);
    this.tick = s.tick;
    this.deaths = s.deaths;
    this.record = s.record ? { ...s.record } : null;
    this.lastBlend = { ...IDLE_BLEND };
    this.dyingLeft = 0;
    this.celebrateLeft = 0;
    this.winEvent = null;
    this.checkpoint = Math.min(s.checkpoint ?? 0, this.checkpoints.length);
    if (s.phase === 'dying') {
      this.run = s.run + 1;
      this.freshRun();
      return;
    }
    this.run = s.run;
    this.runTick = s.runTick;
    this.body = { ...s.body };
    this.dyn = { t: s.dyn.t, crumbles: new Map(s.dyn.crumbles), chompStart: s.dyn.chompStart };
    this.maxProgress = s.maxProgress;
    this.zone = s.zone;
    if (s.phase === 'celebrating' && s.win && (s.celebrateLeft ?? 0) > 0) {
      this.phase = 'celebrating';
      this.celebrateLeft = s.celebrateLeft!;
      this.winEvent = { ...s.win };
      return;
    }
    this.phase = s.phase === 'paused' ? 'paused' : 'running';
  }

  private die(cause: NonNullable<ReturnType<typeof stepBody>>, events: ServerEvent[]): void {
    const progress = this.maxProgress;
    const nearRecord = this.record !== null && this.record.progress >= MIN_RECORD_FOR_NEAR_MISS
      && progress >= this.record.progress - NEAR_RECORD;
    this.deaths++;
    events.push({ t: 'death', run: this.run, cause, progress, deaths: this.deaths, zone: this.zone, nearRecord, checkpoint: this.checkpoint });
    if (this.record === null || progress > this.record.progress) {
      this.record = { progress, run: this.run };
      events.push({ t: 'record', run: this.run, progress });
    }
    this.phase = 'dying';
    this.dyingLeft = DYING_TICKS;
  }

  /** The goal, alive: the level is beaten. */
  private beat(events: ServerEvent[]): void {
    this.maxProgress = 1;
    this.winEvent = {
      t: 'win', levelId: this.level.id, run: this.run, deaths: this.deaths, durationS: this.runTick / TICK_HZ,
      peakPlayers: 0, clipId: null,
    };
    events.push(this.winEvent);
    if (this.record === null || this.record.progress < 1) {
      this.record = { progress: 1, run: this.run };
      events.push({ t: 'record', run: this.run, progress: 1 });
    }
    this.phase = 'celebrating';
    this.celebrateLeft = this.celebrateTicks;
    this.lastBlend = { ...IDLE_BLEND };
  }

  /** One celebration step: inputs ignored, the blob settles on the crown and does victory hops. */
  private celebrateStep(): void {
    const k = this.celebrateTicks - this.celebrateLeft;
    const b = this.body;
    const off = this.level.goalX - b.x;
    const hopT = k - HOP_START;
    const jumpHeld = hopT >= 0 && hopT % HOP_EVERY < HOP_HOLD;
    const before = { ...b };
    const cause = stepBody(b, { move: Math.max(-0.35, Math.min(0.35, off * 0.8)), jumpHeld }, this.level);
    if (cause) Object.assign(b, before, { vx: 0, vy: 0 }); // nothing can hurt the champion
    b.facing = 1;
  }

  /** After the celebration: on to the next level, or an encore of the last. */
  private advance(events: ServerEvent[]): void {
    // the winning run took this number: the track's next run is the one after it
    this.saved.set(this.track, { deaths: this.deaths, record: this.record ? { ...this.record } : null, run: this.run + 1 });
    const i = this.levels.findIndex((l) => l.id === this.level.id);
    const next = i >= 0 && i + 1 < this.levels.length ? this.levels[i + 1]! : null;
    if (next) { this.level = next; this.encore = false; } else this.encore = true;
    const c = this.saved.get(this.track) ?? { deaths: 0, record: null };
    this.saved.delete(this.track);
    this.deaths = c.deaths;
    this.record = c.record ? { ...c.record } : null;
    this.run = nextRunOf(c);
    this.winEvent = null;
    this.celebrateLeft = 0;
    this.checkpoint = 0;
    this.freshRun();
    events.push({ t: 'level', levelId: this.level.id, version: this.level.version, name: levelTitle(this.level), encore: this.encore });
  }

  private freshRun(): void {
    // a new run starts at the last checkpoint reached (the start when none)
    const cp = this.checkpoint > 0 ? this.checkpoints[this.checkpoint - 1] : undefined;
    this.body = cp ? createBodyAt(this.level, cp.x, cp.y) : createBody(this.level);
    this.dyn = createDynamics();
    this.maxProgress = cp ? cp.progress : 0;
    this.zone = cp ? zoneAt(this.level, cp.x).index : 0;
    this.runTick = 0;
    this.phase = 'running';
    this.lastBlend = { ...IDLE_BLEND };
  }

  private reset(events: ServerEvent[]): void {
    this.run++;
    this.freshRun();
    events.push({ t: 'reset', run: this.run, checkpoint: this.checkpoint, zone: this.zone });
  }
}
