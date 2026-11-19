// Choreographs the big moments from server events: the death beat (hit-stop, flash,
// delayed counter flip, death card with a countdown), the zone banner, passing the
// record mid-run, the win (spec §6.7: slow motion, the crown, fireworks, the card) and
// the level-up that follows. Holds no rendering state; it turns events + time into Scene fields.
import type { WinEvent } from '@blobocracy/shared';
import { BANNER_S, DEATH_CARD_AT, DEATH_COUNTER_AT, DEATH_TOTAL_S, LEVELUP_S, deathFx, deathLine, winFx, winLines } from './moments.ts';
import type { SceneBanner, SceneDeathCard } from './render/scene.ts';

export interface DeathEvent { run: number; cause: string; progress: number; deaths: number; nearRecord: boolean; /** Progress of the checkpoint everyone goes back to (absent or 0 = the start). */ checkpointProgress?: number }
export type Record = { progress: number; run: number } | null;

/** Below this progress, passing the record is not a moment (the very first runs). */
const MIN_RECORD = 0.02;
/** The "+1"/lit counter stays this long after it flips. */
const LIT_S = DEATH_TOTAL_S - DEATH_COUNTER_AT + 0.3;

/** The win being celebrated: the server's numbers and seconds since the blob touched the goal. */
export interface WinMoment { age: number; levelId: number; run: number; deaths: number; durationS: number; peakPlayers: number; clipId: string | null }
/** The level-up after a celebration: seconds since the 'level' event, and where everyone is going. */
export interface LevelUpMoment { age: number; levelId: number; name: string; encore: boolean }

export interface DirectorFrame {
  /** The win being celebrated, or null. */
  win: WinMoment | null;
  /** The level-up transition, or null. */
  levelUp: LevelUpMoment | null;
  /** World animation speed (slow motion at the win), 1 normally. */
  timeScale: number;
  /** Seconds into a celebratory wave across the counter cards, or null. */
  cascade: number | null;
  freeze: boolean;
  flash: number;
  vignette: number;
  /** Death count to show (flips a beat after the impact). */
  deaths: number;
  deathsJustTicked: boolean;
  card: SceneDeathCard | null;
  banner: SceneBanner | null;
  /** Record as the HUD should show it: live while this run is beating it. */
  record: Record;
  recordLabel: string;
  /** Seconds since this run passed the record, or null. */
  recordPop: number | null;
  /** Progress where the in-world record flag stands (the record this run is chasing). */
  flagProgress: number | null;
  /** Cause of the death being shown, while dying. */
  cause: string | null;
}

export interface DirectorHooks {
  /** A live-region announcement. */
  announce?(text: string): void;
  /** The run just passed the record flag. */
  recordPassed?(): void;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export class Director {
  private deaths = 0;
  private shownDeaths = 0;
  private tickedAt = -Infinity;
  private record: Record = null;
  /** The record the current run is chasing (fixed when the run starts). */
  private chasing: Record = null;
  private run = 0;
  private best = 0;
  private beatenAt: number | null = null;
  private primed = false;
  private death: (DeathEvent & { at: number; line: string }) | null = null;
  private deathEndAt = -Infinity;
  private banner: (SceneBanner & { at: number }) | null = null;
  private bannerId = 0;
  /** `at` is null until the first frame anchors a celebration joined `age0` seconds in. */
  private win: { e: WinEvent; at: number | null; age0: number } | null = null;
  private levelUp: { levelId: number; name: string; encore: boolean; at: number } | null = null;

  constructor(private readonly reduced: () => boolean, private readonly hooks: DirectorHooks = {}) {}

  /** A welcome resets the counters; during a celebration it carries the win (picked up at its age). A level-up in progress stays. */
  welcome(e: { deaths: number; record: Record; run: number; celebrating?: { win: WinEvent; ageS: number } }): void {
    this.deaths = this.shownDeaths = e.deaths;
    this.record = this.chasing = e.record;
    this.run = e.run;
    this.best = 0;
    this.beatenAt = null;
    this.primed = false; // the first frame tells us whether this run is already past it
    this.death = null;
    this.banner = null;
    if (e.celebrating) {
      if (!this.win || this.win.e.run !== e.celebrating.win.run) this.win = { e: { ...e.celebrating.win }, at: null, age0: e.celebrating.ageS };
    } else this.win = null;
  }

  /** The blob touched the goal. */
  onWin(e: WinEvent, now: number): void {
    this.win = { e: { ...e }, at: now, age0: 0 };
    this.record = { progress: 1, run: e.run };
    this.death = null;
    this.banner = null;
    const w = winLines(e, { name: '', next: null, encore: false });
    this.hooks.announce?.(`${w.title} ${w.line}. Run ${fmt(e.run)} made it all the way.`);
  }

  /** The celebration is over: everyone moves to the next level (or the encore). */
  onLevel(e: { t?: 'level'; levelId: number; version?: number; name: string; encore: boolean }, now: number): void {
    this.win = null;
    this.levelUp = { levelId: e.levelId, name: e.name, encore: e.encore, at: now };
    this.hooks.announce?.(e.encore ? `Encore! ${e.name} again, with a fresh death counter.` : `Level ${e.levelId} unlocked: ${e.name}`);
  }

  onDeath(e: DeathEvent, now: number): void {
    this.deaths = e.deaths;
    this.death = { ...e, at: now, line: deathLine(e.cause, e.run) };
    this.banner = null; // the death card takes the stage
  }

  /** The blob reached a checkpoint: a short banner (it never interrupts a death card or a win). */
  onCheckpoint(index: number, progress: number, now: number): void {
    if (this.death || this.win) return;
    const pct = Math.round(progress * 100);
    this.banner = { id: ++this.bannerId, index: -1, name: `${pct}% of the way`, age: 0, at: now, label: 'Checkpoint!', life: 2.4 };
    this.hooks.announce?.(`Checkpoint ${index}: ${pct}% of the way. Deaths now send everyone back here.`);
  }

  onRecord(e: { run: number; progress: number }): void {
    this.record = { run: e.run, progress: e.progress };
  }

  onReset(run: number, now: number): void {
    if (this.death) this.deathEndAt = now;
    this.death = null;
    this.shownDeaths = this.deaths;
    this.run = run;
    this.chasing = this.record;
    this.best = 0;
    this.beatenAt = null;
    this.primed = true;
    this.banner = null;
  }

  onZone(index: number, name: string, now: number): void {
    this.banner = { id: ++this.bannerId, index, name, age: 0, at: now };
    this.hooks.announce?.(`Zone ${index + 1}: ${name}`);
  }

  /**
   * Per-frame update. `progress` is the run's progress from the latest frame, `running`
   * whether the world is running that run.
   */
  frame(now: number, run: number, progress: number, running: boolean): DirectorFrame {
    const reduced = this.reduced();
    let win: WinMoment | null = null;
    if (this.win) {
      if (this.win.at === null) this.win.at = now - this.win.age0;
      const e = this.win.e;
      win = { age: now - this.win.at, levelId: e.levelId, run: e.run, deaths: e.deaths, durationS: e.durationS, peakPlayers: e.peakPlayers, clipId: e.clipId };
    }
    let levelUp: LevelUpMoment | null = null;
    if (this.levelUp) {
      const age = now - this.levelUp.at;
      if (age > LEVELUP_S) this.levelUp = null;
      else levelUp = { age, levelId: this.levelUp.levelId, name: this.levelUp.name, encore: this.levelUp.encore };
    }
    const wf = win ? winFx(win.age, reduced) : null;
    if (run !== this.run && running) {
      // a reset we never heard about (reconnect): start chasing afresh
      this.onReset(run, now);
      this.primed = false;
    }
    if (running) {
      if (!this.primed) {
        this.primed = true;
        this.best = progress;
        if (this.chasing && progress > this.chasing.progress) this.beatenAt = -Infinity; // joined mid-way past it
      }
      if (progress > this.best) this.best = progress;
      if (this.beatenAt === null && this.chasing && this.chasing.progress >= MIN_RECORD && this.best > this.chasing.progress) {
        this.beatenAt = now;
        this.hooks.recordPassed?.();
        this.hooks.announce?.(`New record! Run ${fmt(this.run)} passed ${Math.round(this.chasing.progress * 100)}%.`);
      }
    }

    // death beat
    const d = this.death;
    const dt = d ? now - d.at : -1;
    const fx = d ? deathFx(dt, reduced) : { freeze: false, flash: 0, vignette: 0, shake: 0 };
    // after the reset the vignette lets go over a moment
    const vignette = d ? fx.vignette : Math.max(0, 0.55 * (1 - (now - this.deathEndAt) / 0.5));
    if (d && dt >= DEATH_COUNTER_AT && this.shownDeaths !== this.deaths) {
      this.shownDeaths = this.deaths;
      this.tickedAt = d.at + DEATH_COUNTER_AT;
    }
    if (!d) this.shownDeaths = this.deaths;
    const card: SceneDeathCard | null = d && dt >= DEATH_CARD_AT
      ? { run: d.run, progress: d.progress, line: d.line, nearRecord: d.nearRecord, ...(d.checkpointProgress ? { checkpoint: d.checkpointProgress } : {}), countdown: Math.max(1, Math.ceil(DEATH_TOTAL_S - dt)) }
      : null;

    let banner: SceneBanner | null = null;
    if (this.banner) {
      const age = now - this.banner.at;
      if (age > (this.banner.life ?? BANNER_S)) this.banner = null;
      else banner = { id: this.banner.id, index: this.banner.index, name: this.banner.name, age, ...(this.banner.label ? { label: this.banner.label } : {}), ...(this.banner.life ? { life: this.banner.life } : {}) };
    }

    const beating = this.beatenAt !== null && this.chasing !== null && !d;
    const record: Record = beating ? { progress: Math.max(this.best, this.chasing!.progress), run: this.run } : this.record;
    return {
      win,
      levelUp,
      timeScale: wf ? wf.timeScale : 1,
      cascade: wf ? wf.cascade : null,
      freeze: fx.freeze,
      flash: fx.flash,
      vignette,
      deaths: this.shownDeaths,
      deathsJustTicked: now - this.tickedAt < LIT_S,
      card,
      banner,
      record,
      recordLabel: record ? (beating ? 'this run!' : `run ${fmt(record.run)}`) : '',
      recordPop: this.beatenAt !== null && Number.isFinite(this.beatenAt) ? now - this.beatenAt : null,
      flagProgress: this.chasing && this.chasing.progress >= MIN_RECORD ? this.chasing.progress : null,
      cause: d ? d.cause : null,
    };
  }

  /** Seconds since the current death, or null when not dying. */
  deathAge(now: number): number | null {
    return this.death ? now - this.death.at : null;
  }
}
