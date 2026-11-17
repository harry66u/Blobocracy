import { LEVEL1, encodeState, progressOf, replayDuration, type Replay, type ServerEvent, type StateFrame } from '@blobocracy/shared';
import { describe, expect, test } from 'vitest';
import { ClipPlayback, type ClipAudioSink } from '../src/clip/playback.ts';
import { clipLayout, EXPORT_SIZE, exportLayout } from '../src/clip/framing.ts';
import { DEATH_CARD_AT } from '../src/moments.ts';

const level = LEVEL1;

function frame(tick: number, over: Partial<StateFrame> = {}): Uint8Array {
  const n = 128;
  const dots = new Uint8Array(n), dotJump = new Uint8Array(n);
  for (let i = 0; i < n; i++) { dots[i] = i < 100 ? (i % 3) : 3; dotJump[i] = i % 7 === 0 ? 1 : 0; }
  const x = 40 + (tick - 600) * 0.1; // 6 tiles/s
  return encodeState({
    tick, run: 4812, x, y: 12.4, vx: 6, vy: 0, grounded: true, facing: 1, phase: 'running',
    pull: 0.5, pressure: 0.1, strain: 0.3, jumpHeld: false, online: 300, active: 280, dots, dotJump,
    runTime: (tick - 600) / 60, chompStart: null, crumbles: [], ...over,
  });
}

/** 8 s of running, a death at 6 s, then the 3.5 s hold and a reset. */
function replay(): Replay {
  const frames: Uint8Array[] = [];
  const events: Replay['events'] = [
    { frameIndex: 0, event: { t: 'welcome', levelId: 1, version: 1, deaths: 4811, record: { progress: 0.02, run: 3940 }, run: 4812, zone: 0, online: 300 } },
  ];
  let i = 0;
  for (let tick = 600; tick <= 600 + 60 * 10; tick += 3, i++) {
    const t = (tick - 600) / 60;
    if (t < 6) frames.push(frame(tick));
    else if (t < 9.5) frames.push(frame(tick, { x: 40 + 36, phase: 'dying', runTime: 6 }));
    else frames.push(frame(tick, { run: 4813, x: level.spawn.x, y: level.spawn.y, runTime: 0 }));
    if (Math.abs(t - 2) < 1e-9) events.push({ frameIndex: i, event: { t: 'zone', run: 4812, index: 1, name: 'Pointy Meadow' } });
    if (Math.abs(t - 6) < 1e-9) events.push({ frameIndex: i, event: { t: 'death', run: 4812, cause: 'saw', progress: progressOf(level, 76), deaths: 4812, zone: 1, nearRecord: true } });
    if (Math.abs(t - 9.5) < 1e-9) events.push({ frameIndex: i, event: { t: 'reset', run: 4813 } });
  }
  return { version: 1, levelId: 1, levelVersion: 1, kind: 'near_miss', run: 4812, deaths: 4812, progress: progressOf(level, 76), frames, events };
}

function recorder(): ClipAudioSink & { calls: string[] } {
  const calls: string[] = [];
  const log = (name: string) => (...a: unknown[]) => { calls.push(a.length ? `${name}(${a.map((v) => typeof v === 'number' ? v.toFixed(2) : v).join(',')})` : name); };
  return {
    calls,
    sawNear: () => {}, setCrowd: () => {}, pressSlam: log('press'), crumble: log('crumble'), land: log('land'), jump: log('jump'), spring: log('spring'),
    setZone: log('zone'), death: log('death'), cheer: log('cheer'), resetToStart: log('reset'),
  };
}

const L = exportLayout('vertical');

describe('ClipPlayback (frames + events → Scene)', () => {
  test('lasts as long as its frames', () => {
    const r = replay();
    expect(new ClipPlayback(r, level).duration).toBeCloseTo(replayDuration(r), 6);
  });

  test('is deterministic: the same times give the same scenes, also after restart()', () => {
    const p = new ClipPlayback(replay(), level);
    const run = () => {
      const out: string[] = [];
      for (let k = 0; k <= 11 * 30; k++) {
        const f = p.frame(k / 30, L);
        out.push(JSON.stringify({ scene: { ...f.scene, level: null }, cam: f.cam }));
      }
      return out;
    };
    const a = run();
    p.restart();
    const b = run();
    expect(b).toEqual(a);
  });

  test('interpolates the blob between 20 Hz frames', () => {
    const p = new ClipPlayback(replay(), level);
    const at = (t: number) => p.frame(t, L).scene.blob.x;
    expect(at(0)).toBeCloseTo(40, 4);
    expect(at(1 / 40)).toBeCloseTo(40.15, 3); // halfway between frames at 40 and 40.3
    expect(at(1)).toBeCloseTo(46, 3);
  });

  test('events land at their frame time whatever the step size (30 vs 60 fps)', () => {
    const cardAt = (fps: number) => {
      const p = new ClipPlayback(replay(), level);
      for (let k = 0; k <= 9 * fps; k++) if (p.frame(k / fps, L).scene.deathCard) return k / fps;
      return null;
    };
    const a = cardAt(30)!, b = cardAt(60)!;
    expect(a).toBeGreaterThanOrEqual(6 + DEATH_CARD_AT - 1e-9);
    expect(a - (6 + DEATH_CARD_AT)).toBeLessThan(1 / 30 + 1e-9);
    expect(b - (6 + DEATH_CARD_AT)).toBeLessThan(1 / 60 + 1e-9);
  });

  test('the big moments: zone banner + cheer, death freeze + card + "So close.", reset swoop', () => {
    const p = new ClipPlayback(replay(), level);
    const sink = recorder();
    let banner = false, froze = false, near = false, swoop = false, dead = false;
    for (let k = 0; k <= 11 * 30; k++) {
      const { scene } = p.frame(k / 30, L, sink);
      banner ||= scene.fx?.banner?.name === 'Pointy Meadow';
      froze ||= scene.fx?.freeze === true;
      near ||= scene.deathCard?.nearRecord === true;
      dead ||= scene.blob.dead && scene.blob.deathCause === 'saw';
      swoop ||= (scene.fx?.skyRate ?? 1) > 1;
      expect(scene.you).toBeNull(); // nobody's own dot in a clip
    }
    expect({ banner, froze, near, swoop, dead }).toEqual({ banner: true, froze: true, near: true, swoop: true, dead: true });
    expect(sink.calls.filter((c) => !/^(jump|land|press)/.test(c))).toEqual([
      'zone(0.00)', 'zone(1.00)', 'cheer(zone)', 'cheer(record)', 'death', 'reset',
    ]);
  });

  test('the record flag stands at the record the run chases, and the HUD shows the clip\'s numbers', () => {
    const p = new ClipPlayback(replay(), level);
    const s = p.frame(0.5, L).scene;
    expect(s.hud.online).toBe(300);
    expect(s.hud.deaths).toBe(4811);
    expect(s.fx?.recordFlag?.label).toBe('2%');
    // after the death the counter flips to the clip's final count
    expect(p.frame(7.5, L).scene.hud.deaths).toBe(4812);
  });
});

describe('clip framing', () => {
  test('export sizes are 1080×1920 and 1920×1080', () => {
    expect(EXPORT_SIZE.vertical).toEqual({ w: 1080, h: 1920 });
    expect(EXPORT_SIZE.wide).toEqual({ w: 1920, h: 1080 });
    for (const a of ['vertical', 'wide'] as const) {
      const l = exportLayout(a);
      expect(Math.round(l.w * l.dpr)).toBe(EXPORT_SIZE[a].w);
      expect(Math.round(l.h * l.dpr)).toBe(EXPORT_SIZE[a].h);
    }
  });

  test('vertical puts the ground in the lower middle and keeps the blob near the horizontal middle', () => {
    const v = clipLayout(432, 768, 2.5);
    expect(v.phone).toBe(true);
    expect(v.groundY / v.h).toBeGreaterThan(0.55);
    expect(v.groundY / v.h).toBeLessThan(0.75);
    const viewW = v.w / v.tile;
    expect(v.lookAhead / viewW).toBeGreaterThan(0.3);
    expect(v.lookAhead / viewW).toBeLessThan(0.5);
    const w = clipLayout(1280, 720, 1.5);
    expect(w.phone).toBe(false);
  });
});
