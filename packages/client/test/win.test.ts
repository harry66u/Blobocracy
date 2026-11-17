import { CELEBRATE_S, LEVEL1, LEVEL2, encodeState, type Replay, type StateFrame, type WinEvent } from '@blobocracy/shared';
import { describe, expect, test } from 'vitest';
import { ClipPlayback, type ClipAudioSink } from '../src/clip/playback.ts';
import { exportLayout } from '../src/clip/framing.ts';
import { Director } from '../src/director.ts';
import { levelView, hudLevelLabel } from '../src/levels.ts';
import { LEVELUP_S, WIN_BANNER_IN, WIN_BANNER_OUT, levelUpFrame, winFx, winLines } from '../src/moments.ts';
import { composeScene, sceneBlob } from '../src/scenemap.ts';
import { bodyFromFrame } from '../src/predict.ts';

const WIN: WinEvent = { t: 'win', levelId: 1, run: 4812, deaths: 4811, durationS: 494.2, peakPlayers: 12408, clipId: 'Zx9_-a' };

function make(reduced = false) {
  const said: string[] = [];
  const d = new Director(() => reduced, { announce: (t) => said.push(t) });
  d.welcome({ deaths: 4811, record: { progress: 0.83, run: 3940 }, run: 4812 });
  return { d, said };
}

describe('win moment timing (pure)', () => {
  test('time slows at the touch, then speeds back up; the crown flies onto the head; the party ends before the switch', () => {
    expect(winFx(0.05, false).timeScale).toBeLessThan(0.4);
    expect(winFx(3, false).timeScale).toBe(1);
    expect(winFx(0.05, false).crown).toBe(0); // glowing on its pedestal
    const mid = winFx(0.55, false).crown;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(winFx(1.2, false).crown).toBe(1); // worn
    expect(winFx(0.05, false).flash).toBeGreaterThan(0.2);
    expect(winFx(2, false).fireworks).toBe(true);
    expect(winFx(CELEBRATE_S - 0.5, false).fireworks).toBe(false);
    expect(winFx(1.3, false).cascade).not.toBeNull();
    expect(winFx(WIN_BANNER_IN - 0.1, false).banner).toBeNull();
    expect(winFx(WIN_BANNER_IN + 1, false).banner).toBeCloseTo(1, 6);
    expect(winFx(WIN_BANNER_OUT + 1, false).banner).toBeNull();
    expect(WIN_BANNER_OUT).toBeLessThan(CELEBRATE_S);
  });

  test('reduced motion: no slow-motion, no fireworks motion, the crown fades on', () => {
    const r = winFx(0.3, true);
    expect(r.timeScale).toBe(1);
    expect(r.fireworks).toBe(false);
    expect(winFx(2, true).fireworks).toBe(false);
    expect(winFx(1.2, true).crown).toBe(1);
    expect(winFx(0.05, true).flash).toBeLessThan(0.3);
  });

  test('the level-up: the old world shrinks away, the new one slides in and fills the screen', () => {
    const a = levelUpFrame(0, false), b = levelUpFrame(0.8, false), c = levelUpFrame(LEVELUP_S, false);
    expect(a.oldScale).toBeCloseTo(1, 3);
    expect(b.oldScale).toBeLessThan(0.8);
    expect(levelUpFrame(2.0, false).newAlpha).toBeGreaterThan(0);
    expect(c).toMatchObject({ done: true, newScale: 1, newX: 0, newRot: 0, oldAlpha: 0 });
    expect(levelUpFrame(2.2, false).banner).not.toBeNull();
    // reduced motion: a crossfade, no zoom or slide
    for (const t of [0, 0.3, 0.6, 1, 2]) {
      const r = levelUpFrame(t, true);
      expect(r.oldScale).toBe(1);
      expect(r.newScale).toBe(1);
      expect(r.newX).toBe(0);
      expect(r.oldX).toBe(0);
    }
    expect(levelUpFrame(0.1, true).oldAlpha).toBeGreaterThan(levelUpFrame(0.6, true).oldAlpha);
  });

  test('the banner words', () => {
    const w = winLines(WIN, { name: 'Crown Mountain', next: { levelId: 2, name: 'Storm Peaks' }, encore: false });
    expect(w.title).toBe('The internet did it!');
    expect(w.line).toBe('Level 1 beaten after 4,811 deaths');
    expect(w.stats).toEqual([
      { big: 'Run 4,812', small: 'made it' },
      { big: '8:14', small: 'run time' },
      { big: '12,408', small: 'peak players' },
    ]);
    expect(w.next(19.6)).toBe('Level 2 unlocks in 20');
    const last = winLines({ ...WIN, levelId: 2, deaths: 1 }, { name: 'Storm Peaks', next: null, encore: false });
    expect(last.line).toBe('Level 2 beaten after 1 death');
    expect(last.next(3)).toBe('A new level is coming. Encore in 3');
    expect(winLines(WIN, { name: 'x', next: null, encore: true }).line).toBe('Encore beaten after 4,811 deaths');
  });
});

describe('Director: the win and the level-up', () => {
  test('the win takes over: frame carries the win, the record jumps to 100%, the death card never shows', () => {
    const { d, said } = make();
    d.frame(10, 4812, 0.99, true);
    d.onWin(WIN, 10);
    const f = d.frame(10.1, 4812, 1, false);
    expect(f.win).toMatchObject({ run: 4812, deaths: 4811, durationS: 494.2, peakPlayers: 12408, age: expect.closeTo(0.1, 6) });
    expect(f.timeScale).toBeLessThan(0.5);
    expect(f.card).toBeNull();
    expect(said.at(-1)).toMatch(/The internet did it! Level 1 beaten after 4,811 deaths/);
    expect(d.frame(11.3, 4812, 1, false).cascade).not.toBeNull();
  });

  test('a welcome during a celebration picks the party up at the right age', () => {
    const { d } = make();
    d.welcome({ deaths: 4811, record: null, run: 4812, celebrating: { win: WIN, ageS: 7 } });
    expect(d.frame(50, 4812, 1, false).win?.age).toBeCloseTo(7, 6);
  });

  test('the level event starts the level-up and ends the win; the fresh welcome that follows keeps the level-up', () => {
    const { d, said } = make();
    d.onWin(WIN, 10);
    d.onLevel({ t: 'level', levelId: 2, version: 1, name: 'Storm Peaks', encore: false }, 35);
    d.welcome({ deaths: 0, record: null, run: 1 });
    const f = d.frame(36, 1, 0, true);
    expect(f.win).toBeNull();
    expect(f.levelUp).toMatchObject({ levelId: 2, name: 'Storm Peaks', encore: false, age: 1 });
    expect(f.deaths).toBe(0);
    expect(said.at(-1)).toBe('Level 2 unlocked: Storm Peaks');
    expect(d.frame(35 + LEVELUP_S + 0.1, 1, 0, true).levelUp).toBeNull();
  });
});

describe('levels on the client', () => {
  test('one SceneLevel per level, reused (the renderer caches chunks per object)', () => {
    const a = levelView(1)!, b = levelView(2)!;
    expect(a.level).toBe(LEVEL1);
    expect(b.level).toBe(LEVEL2);
    expect(levelView(1)!.sceneLevel).toBe(a.sceneLevel);
    expect(a.sceneLevel).not.toBe(b.sceneLevel);
    expect(a.sceneLevel.goalX).toBe(LEVEL1.goalX);
    expect(levelView(99)).toBeNull();
  });

  test('the HUD names the level from level 2 on, and marks an encore', () => {
    expect(hudLevelLabel(1, false)).toBeNull();
    expect(hudLevelLabel(2, false)).toBe('Level 2');
    expect(hudLevelLabel(2, true)).toBe('Level 2');
    expect(hudLevelLabel(1, true)).toBe('Level 1');
  });
});

function frameBytes(tick: number, over: Partial<StateFrame> = {}): Uint8Array {
  return encodeState({
    tick, run: 4812, x: LEVEL1.goalX - 6 + (tick - 600) * 0.1, y: 12.4, vx: 6, vy: 0, grounded: true, facing: 1, phase: 'running',
    pull: 1, pressure: 0, strain: 0, jumpHeld: false, online: 300, active: 280, dots: new Uint8Array(8), dotJump: new Uint8Array(8),
    runTime: (tick - 600) / 60, chompStart: null, crumbles: [], ...over,
  });
}

describe('a win clip plays the celebration', () => {
  test('the win event drives the same moment as the game (and the fanfare)', () => {
    const frames: Uint8Array[] = [];
    const events: Replay['events'] = [{ frameIndex: 0, event: { t: 'welcome', levelId: 1, version: 1, deaths: 4811, record: { progress: 0.83, run: 3940 }, run: 4812, zone: 5, online: 300 } }];
    let i = 0;
    for (let tick = 600; tick <= 600 + 60 * 10; tick += 3, i++) {
      const t = (tick - 600) / 60;
      frames.push(t < 1 ? frameBytes(tick) : frameBytes(tick, { x: LEVEL1.goalX + 0.1, vx: 0, phase: 'celebrating', runTime: 1 }));
      if (Math.abs(t - 1) < 1e-9) events.push({ frameIndex: i, event: WIN });
    }
    const r: Replay = { version: 1, levelId: 1, levelVersion: 1, kind: 'win', run: 4812, deaths: 4811, progress: 1, frames, events };
    const calls: string[] = [];
    const sink = {
      sawNear() {}, setCrowd() {}, pressSlam() {}, crumble() {}, land() {}, jump() {}, spring() {},
      setZone() {}, death() {}, cheer() {}, resetToStart() {}, win: () => calls.push('win'),
    } satisfies ClipAudioSink;
    const p = new ClipPlayback(r, LEVEL1);
    const L = exportLayout('vertical');
    expect(p.frame(0.5, L, sink).scene.win).toBeNull();
    const s = p.frame(5, L, sink).scene;
    expect(s.win).toMatchObject({ run: 4812, deaths: 4811, levelId: 1 });
    expect(s.blob.crown).toBe(1);
    expect(s.blob.joy).toBe(true);
    expect(calls).toEqual(['win']);
  });
});

describe('scene composition', () => {
  test('the blob wears the crown and smiles while celebrating; the HUD gets the level label', () => {
    const d = new Director(() => false);
    d.welcome({ deaths: 3, record: null, run: 4 });
    d.onWin({ ...WIN, levelId: 2 }, 0);
    const f = { ...decodeFrame(), phase: 'celebrating' as const };
    const body = bodyFromFrame(f);
    const blob = sceneBlob({ x: f.x, y: f.y }, body, f, null);
    const v = levelView(2)!;
    const scene = composeScene({
      level: v.level, sceneLevel: v.sceneLevel, frame: f, blob, runTime: 0, online: 5, muted: false, reduced: false, progress: 1,
      dots: [], you: null, director: d.frame(2, 4, 1, false), showCard: false, swoopK: null, swoopFade: 0, viewCenterX: 0, swoopFromProgress: 0,
      levelLabel: 'Level 2', encore: true,
    });
    expect(scene.blob.crown).toBe(1);
    expect(scene.blob.joy).toBe(true);
    expect(scene.hud.levelLabel).toBe('Level 2');
    expect(scene.hud.encore).toBe(true);
    expect(scene.fx?.timeScale).toBe(1);
    expect(scene.win?.levelId).toBe(2);
  });
});

function decodeFrame(): StateFrame {
  return {
    tick: 1, run: 4, x: LEVEL2.goalX, y: 12.4, vx: 0, vy: 0, grounded: true, facing: 1, phase: 'celebrating', pull: 0, pressure: 0, strain: 0,
    jumpHeld: false, online: 5, active: 0, dots: new Uint8Array(0), dotJump: new Uint8Array(0), runTime: 0, chompStart: null, crumbles: [],
  };
}
