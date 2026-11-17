// Plays a Replay as a sequence of Scenes: the recorded 20 Hz frames interpolated to any
// frame rate, the recorded events fed to the same Director and CameraRig the game uses
// (death freeze/pose/flip/card, zone banners, record pop, the swoop back), and the same
// world sounds. Pure and deterministic: the same clip times give the same scenes, so the
// page preview and the exported video match.
import { TICK_HZ, decodeFrame, progressOf, type Level, type Replay, type ServerEvent, type StateFrame } from '@blobocracy/shared';
import { CameraRig } from '../camera.ts';
import { Director } from '../director.ts';
import { keepDeathCard } from '../hudstate.ts';
import type { Layout } from '../layout.ts';
import { DEATH_SHAKE, swoopDuration } from '../moments.ts';
import { bodyFromFrame } from '../predict.ts';
import type { Scene, SceneDot, SceneLevel } from '../render/scene.ts';
import { composeScene, sceneBlob, sceneDots, sceneLevelOf, WorldSounds, type WorldSoundSink } from '../scenemap.ts';

/** The sounds a clip makes (a subset of GameAudio). */
export interface ClipAudioSink extends WorldSoundSink {
  setZone(index: number): void;
  death(): void;
  cheer(kind: 'zone' | 'record'): void;
  resetToStart(): void;
}

export interface ClipFrame {
  scene: Scene;
  /** View's left/top edge in tiles, shake included. */
  cam: { x: number; y: number };
}

export interface PlaybackOptions {
  reduced?: boolean;
  /** Reuse a SceneLevel (the renderer caches chunks per object). */
  sceneLevel?: SceneLevel;
}

const SILENT: ClipAudioSink = {
  sawNear() {}, pressSlam() {}, crumble() {}, setCrowd() {}, land() {}, jump() {}, spring() {},
  setZone() {}, death() {}, cheer() {}, resetToStart() {},
};

/** Interpolate between frames closer than this (tiles); further apart is a teleport/reset. */
const LERP_MAX = 3;

export class ClipPlayback {
  readonly duration: number;
  readonly sceneLevel: SceneLevel;
  private readonly frames: StateFrame[];
  private readonly ticks: number[];
  private readonly events: ServerEvent[][];
  private readonly reduced: boolean;

  private director!: Director;
  private rig!: CameraRig;
  private sounds!: WorldSounds;
  private idx = -1;
  private lastT = 0;
  private pos: { x: number; y: number } | null = null;
  private deathCause: string | null = null;
  private cardRun: number | null = null;
  private swoopFromProgress = 0;
  private online = 0;
  private sink: ClipAudioSink = SILENT;
  private readonly dots: SceneDot[] = [];

  constructor(replay: Replay, private readonly level: Level, opts: PlaybackOptions = {}) {
    this.reduced = opts.reduced ?? false;
    this.sceneLevel = opts.sceneLevel ?? sceneLevelOf(level);
    const frames: StateFrame[] = [];
    const ticks: number[] = [];
    const events: ServerEvent[][] = [];
    const byIndex = new Map<number, ServerEvent[]>();
    for (const e of replay.events) {
      const list = byIndex.get(e.frameIndex) ?? [];
      list.push(e.event);
      byIndex.set(e.frameIndex, list);
    }
    replay.frames.forEach((bytes, i) => {
      const f = decodeFrame(bytes);
      if (!f) return;
      frames.push(f);
      ticks.push(f.tick);
      events.push(byIndex.get(i) ?? []);
    });
    if (frames.length === 0) throw new Error('empty clip');
    this.frames = frames;
    this.ticks = ticks;
    this.events = events;
    const n = ticks.length;
    const span = ticks[n - 1]! - ticks[0]!;
    this.duration = n === 1 ? 1 / 20 : (span + span / (n - 1)) / TICK_HZ;
    this.restart();
  }

  /** Back to the first frame with fresh moments and camera (also reset the renderer). */
  restart(): void {
    this.director = new Director(() => this.reduced, { recordPassed: () => this.sink.cheer('record') });
    this.rig = new CameraRig();
    this.sounds = new WorldSounds(this.level);
    this.idx = -1;
    this.lastT = 0;
    this.pos = null;
    this.deathCause = null;
    this.cardRun = null;
    this.swoopFromProgress = 0;
    this.online = 0;
  }

  /** Seconds into the clip of frame `i`. */
  private timeOf(i: number): number {
    return (this.ticks[i]! - this.ticks[0]!) / TICK_HZ;
  }

  private onEvent(e: ServerEvent, now: number): void {
    const level = this.level;
    switch (e.t) {
      case 'welcome':
        this.director.welcome(e);
        this.deathCause = null;
        this.cardRun = null;
        this.online = e.online;
        this.sink.setZone(e.zone);
        break;
      case 'death':
        this.director.onDeath(e, now);
        this.deathCause = e.cause;
        this.cardRun = e.run;
        if (!this.reduced) this.rig.kick(DEATH_SHAKE.amp, DEATH_SHAKE.dur);
        this.sink.death();
        break;
      case 'record':
        this.director.onRecord(e);
        break;
      case 'reset': {
        this.swoopFromProgress = this.pos ? progressOf(level, this.pos.x) : 0;
        this.director.onReset(e.run, now);
        this.deathCause = null;
        this.cardRun = null;
        const from = this.pos ? this.pos.x : level.spawn.x;
        this.pos = null;
        this.rig.swoop(swoopDuration(from - level.spawn.x, this.reduced), this.reduced);
        this.sink.resetToStart();
        break;
      }
      case 'zone':
        this.director.onZone(e.index, e.name, now);
        this.sink.setZone(e.index);
        this.sink.cheer('zone');
        break;
    }
  }

  /**
   * The scene at clip time `t` (seconds; call with non-decreasing times, restart() to go
   * back). Sounds for everything since the last call go to `sink`.
   */
  frame(t: number, L: Layout, sink: ClipAudioSink = SILENT): ClipFrame {
    this.sink = sink;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const n = this.frames.length;
    const tickF = this.ticks[0]! + Math.max(0, t) * TICK_HZ;
    if (this.idx < 0) {
      this.idx = 0;
      for (const e of this.events[0]!) this.onEvent(e, 0);
    }
    while (this.idx + 1 < n && this.ticks[this.idx + 1]! <= tickF + 1e-6) {
      this.idx++;
      const at = this.timeOf(this.idx);
      for (const e of this.events[this.idx]!) this.onEvent(e, at);
    }
    const f = this.frames[this.idx]!;
    const next = this.idx + 1 < n ? this.frames[this.idx + 1]! : null;

    const body = bodyFromFrame(f);
    let runTime = f.runTime;
    if (next && f.phase === 'running' && next.phase === 'running' && next.run === f.run && Math.hypot(next.x - f.x, next.y - f.y) < LERP_MAX) {
      const t0 = this.ticks[this.idx]!, t1 = this.ticks[this.idx + 1]!;
      const a = t1 > t0 ? Math.min(1, Math.max(0, (tickF - t0) / (t1 - t0))) : 0;
      const nb = bodyFromFrame(next);
      body.x += (nb.x - body.x) * a;
      body.y += (nb.y - body.y) * a;
      body.vx += (nb.vx - body.vx) * a;
      body.vy += (nb.vy - body.vy) * a;
      runTime += (next.runTime - f.runTime) * a;
    }
    this.pos = { x: body.x, y: body.y };
    const pos = this.pos;
    const blob = sceneBlob(pos, body, f, this.deathCause);
    this.online = f.online;
    this.sounds.world(f, pos, runTime, sink);
    if (!keepDeathCard(this.cardRun === null ? null : { run: this.cardRun }, f)) {
      this.cardRun = null;
      this.deathCause = blob.dead ? this.deathCause : null;
    }
    this.sounds.body(f, body, sink);

    const running = f.phase === 'running';
    const progress = progressOf(this.level, blob.x);
    const d = this.director.frame(t, f.run, progress, running);
    let cam = this.rig.update(L, blob, dt, this.reduced);
    const swoopK = this.rig.swoopK;
    const shake = this.rig.shakeOffset();
    cam = { x: cam.x + shake.x, y: cam.y + shake.y };
    const scene = composeScene({
      level: this.level, sceneLevel: this.sceneLevel, frame: f, blob, runTime, online: this.online, muted: false, reduced: this.reduced, progress,
      dots: sceneDots(f.dots, f.dotJump, this.dots).slice(),
      you: null,
      director: d,
      showCard: this.cardRun !== null,
      swoopK, swoopFade: this.rig.swoopFade, viewCenterX: cam.x + L.lookAhead, swoopFromProgress: this.swoopFromProgress,
    });
    return { scene, cam };
  }
}
