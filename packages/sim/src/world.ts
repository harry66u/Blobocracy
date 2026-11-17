import {
  DEATH_FREEZE_S, DEATH_HOLD_S, TICK_HZ,
  blend, createBody, createDynamics, stepBody, progressOf, zoneAt,
  type BlendOut, type Body, type Dynamics, type Level, type ServerEvent, type VoteCounts,
} from '@blobocracy/shared';

export interface WorldInit { deaths: number; record: { progress: number; run: number } | null }
export type Phase = 'running' | 'dying' | 'paused';

const DYING_TICKS = Math.round((DEATH_FREEZE_S + DEATH_HOLD_S) * TICK_HZ);
const IDLE_BLEND: BlendOut = { move: 0, jumpHeld: false, jumpPressed: false, freshHigh: false, pull: 0, pressure: 0, strain: 0 };
const NEAR_RECORD = 0.05;
/** Below this, a record is too small for dying near it to be a "so close" moment. */
const MIN_RECORD_FOR_NEAR_MISS = 0.1;

/**
 * The one shared world: a single blob, one run at a time, one life.
 * Advances exactly one fixed step per call; everything is deterministic.
 */
export class World {
  readonly level: Level;
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
  private dyingLeft = 0;

  constructor(level: Level, init: WorldInit = { deaths: 0, record: null }) {
    this.level = level;
    this.deaths = init.deaths;
    this.run = init.deaths + 1;
    this.record = init.record;
    this.body = createBody(level);
  }

  step(votes: VoteCounts): ServerEvent[] {
    this.tick++;
    const events: ServerEvent[] = [];

    if (this.phase === 'dying') {
      if (--this.dyingLeft <= 0) this.reset(events);
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
    return events;
  }

  welcome(online: number): ServerEvent {
    return {
      t: 'welcome', levelId: this.level.id, version: this.level.version, deaths: this.deaths,
      record: this.record, run: this.run, zone: this.zone, online,
    };
  }

  private die(cause: NonNullable<ReturnType<typeof stepBody>>, events: ServerEvent[]): void {
    const progress = this.maxProgress;
    const nearRecord = this.record !== null && this.record.progress >= MIN_RECORD_FOR_NEAR_MISS
      && progress >= this.record.progress - NEAR_RECORD;
    this.deaths++;
    events.push({ t: 'death', run: this.run, cause, progress, deaths: this.deaths, zone: this.zone, nearRecord });
    if (this.record === null || progress > this.record.progress) {
      this.record = { progress, run: this.run };
      events.push({ t: 'record', run: this.run, progress });
    }
    this.phase = 'dying';
    this.dyingLeft = DYING_TICKS;
  }

  private reset(events: ServerEvent[]): void {
    this.run++;
    this.body = createBody(this.level);
    this.dyn = createDynamics();
    this.maxProgress = 0;
    this.zone = 0;
    this.runTick = 0;
    this.phase = 'running';
    this.lastBlend = { ...IDLE_BLEND };
    events.push({ t: 'reset', run: this.run });
  }
}
