import { describe, expect, test } from 'vitest';
import { CELEBRATE_S, ENCORE_TRACK, TICK_HZ, type ServerEvent, type VoteCounts } from '@blobocracy/shared';
import { World } from '../src/world';
import { JUMP_LEFT, LEFT, NOBODY, RIGHT, TINY, TINY1, TINY2 } from './fixtures';

const CELEBRATE_TICKS = Math.round(CELEBRATE_S * TICK_HZ);

function runUntil(w: World, votes: VoteCounts, pred: (e: ServerEvent) => boolean, max = 4000): ServerEvent[] {
  const all: ServerEvent[] = [];
  for (let i = 0; i < max; i++) {
    const ev = w.step(votes);
    all.push(...ev);
    if (ev.some(pred)) return all;
  }
  throw new Error('condition never reached');
}
const win = (w: World) => runUntil(w, RIGHT, (e) => e.t === 'win');
const celebrate = (w: World, votes: VoteCounts = JUMP_LEFT) => runUntil(w, votes, (e) => e.t === 'level', CELEBRATE_TICKS + 5);

describe('winning a level', () => {
  test('reaching the goal alive is a win: a record at 100%, then the celebration', () => {
    const w = new World(TINY1, { deaths: 4811, record: { progress: 0.83, run: 3940 } }, { levels: TINY });
    const events = win(w);
    const e = events.find((x) => x.t === 'win')!;
    expect(e).toMatchObject({ t: 'win', levelId: 1, run: 4812, deaths: 4811, peakPlayers: 0, clipId: null });
    expect(e.t === 'win' && e.durationS).toBeCloseTo(w.runTick / TICK_HZ, 6);
    expect(events).toContainEqual({ t: 'record', run: 4812, progress: 1 });
    expect(w.phase).toBe('celebrating');
    expect(w.maxProgress).toBe(1);
    expect(w.record).toEqual({ progress: 1, run: 4812 });
    expect(w.deaths).toBe(4811); // a win is not a death
    expect(events.some((x) => x.t === 'death')).toBe(false);
  });

  test('the celebration ignores inputs: the blob hops on the crown, nobody dies, the run clock stands still', () => {
    const w = new World(TINY1, undefined, { levels: TINY });
    win(w);
    const x0 = w.body.x, t0 = w.dyn.t;
    let minY = w.body.y, airborne = 0;
    for (let i = 0; i < CELEBRATE_TICKS - 1; i++) {
      const ev = w.step(i % 2 ? LEFT : JUMP_LEFT);
      expect(ev).toEqual([]);
      expect(w.phase).toBe('celebrating');
      minY = Math.min(minY, w.body.y);
      if (!w.body.grounded) airborne++;
    }
    expect(Math.abs(w.body.x - TINY1.goalX)).toBeLessThan(0.6); // stays at the crown (did not walk left)
    expect(Math.abs(x0 - TINY1.goalX)).toBeLessThan(1);
    expect(minY).toBeLessThan(TINY1.spawn.y - 0.4); // victory hops
    expect(airborne).toBeGreaterThan(60);
    expect(w.dyn.t).toBe(t0);
    expect(w.deaths).toBe(0);
    // nobody online: the party goes on all the same
    const w2 = new World(TINY1, undefined, { levels: TINY });
    win(w2);
    expect(celebrate(w2, NOBODY).at(-1)?.t).toBe('level');
  });

  test('after about 25 s the next level unlocks with its own fresh counters', () => {
    const w = new World(TINY1, { deaths: 4811, record: { progress: 0.83, run: 3940 } }, { levels: TINY });
    win(w);
    const tick0 = w.tick;
    const ev = celebrate(w);
    expect(w.tick - tick0).toBe(CELEBRATE_TICKS);
    expect(ev.at(-1)).toEqual({ t: 'level', levelId: 2, version: 3, name: 'Tiny Peak', encore: false });
    expect(w.level).toBe(TINY2);
    expect(w).toMatchObject({ deaths: 0, record: null, run: 1, zone: 0, maxProgress: 0, runTick: 0, encore: false, phase: 'running' });
    expect(w.body.x).toBeCloseTo(TINY2.spawn.x);
    expect(w.welcome(5)).toEqual({ t: 'welcome', levelId: 2, version: 3, name: 'Tiny Peak', encore: false, deaths: 0, record: null, run: 1, zone: 0, online: 5 });
    // deaths now count on level 2
    w.step(RIGHT);
    expect(w.phase).toBe('running');
  });

  test('counters a level already has (from storage) carry on when it unlocks', () => {
    const w = new World(TINY1, undefined, { levels: TINY });
    w.setCounters(2, { deaths: 7, record: { progress: 0.4, run: 3 } });
    win(w);
    celebrate(w);
    expect(w).toMatchObject({ deaths: 7, run: 8, record: { progress: 0.4, run: 3 } });
    // level 1's final counters are kept for its track
    expect(w.countersFor(1)).toEqual({ deaths: 0, record: { progress: 1, run: 1 } });
  });

  test('beating the last level starts an encore of it with its own counter; beating the encore encores again', () => {
    const w = new World(TINY2, { deaths: 12, record: null }, { levels: TINY });
    win(w);
    const ev = celebrate(w);
    expect(ev.at(-1)).toEqual({ t: 'level', levelId: 2, version: 3, name: 'Tiny Peak', encore: true });
    expect(w.level).toBe(TINY2);
    expect(w).toMatchObject({ encore: true, deaths: 0, run: 1, record: null });
    expect(w.track).toBe(ENCORE_TRACK + 2);
    expect(w.welcome(1)).toMatchObject({ levelId: 2, encore: true, deaths: 0 });
    expect(w.countersFor(2)).toEqual({ deaths: 12, record: { progress: 1, run: 13 } });
    // the encore can be won too: its counters carry on in the encore
    w.deaths = 3; w.run = 4;
    win(w);
    expect(celebrate(w).at(-1)).toMatchObject({ t: 'level', levelId: 2, encore: true });
    expect(w).toMatchObject({ encore: true, deaths: 3, run: 4, record: { progress: 1, run: 4 } });
  });

  test('a level list without the next level: the beaten level encores', () => {
    const w = new World(TINY1);
    win(w);
    expect(celebrate(w).at(-1)).toMatchObject({ t: 'level', levelId: 1, encore: true });
  });

  test('a welcome during the celebration carries the win and how long ago it was', () => {
    const w = new World(TINY1, undefined, { levels: TINY });
    const e = win(w).find((x) => x.t === 'win')!;
    for (let i = 0; i < 90; i++) w.step(NOBODY);
    const wel = w.welcome(2);
    expect(wel.t === 'welcome' && wel.celebrating).toEqual({ win: e, ageS: 1.5 });
  });

  test('the debug jump puts the blob just before the goal of the current level', () => {
    const w = new World(TINY2, undefined, { levels: TINY });
    w.step(RIGHT);
    expect(w.debugNearGoal()).toBe(true);
    expect(TINY2.goalX - w.body.x).toBeGreaterThan(1);
    expect(TINY2.goalX - w.body.x).toBeLessThan(4);
    expect(w.zone).toBe(1);
    win(w);
    expect(w.debugNearGoal()).toBe(false); // not while celebrating
  });
});

describe('resuming across a level switch (live snapshot)', () => {
  test('after the switch: the new level, its counters and the old level\'s counters all come back', () => {
    const a = new World(TINY1, { deaths: 40, record: null }, { levels: TINY });
    win(a);
    celebrate(a);
    for (let i = 0; i < 20; i++) a.step(RIGHT);
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as ReturnType<World['snapshot']>;
    expect(snap).toMatchObject({ levelId: 2, encore: false });
    const b = new World(TINY1, undefined, { levels: TINY });
    b.restore(snap);
    expect(b.level).toBe(TINY2);
    expect(b).toMatchObject({ run: 1, deaths: 0, encore: false, phase: 'running' });
    expect(b.body).toEqual(a.body);
    expect(b.countersFor(1)).toEqual({ deaths: 40, record: { progress: 1, run: 41 } });
  });

  test('mid-celebration: the party resumes where it was and still unlocks the next level on time', () => {
    const a = new World(TINY1, undefined, { levels: TINY });
    const e = win(a).find((x) => x.t === 'win')!;
    for (let i = 0; i < 600; i++) a.step(NOBODY);
    const b = new World(TINY1, undefined, { levels: TINY });
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.phase).toBe('celebrating');
    expect((b.welcome(0) as { celebrating?: unknown }).celebrating).toEqual({ win: e, ageS: 10 });
    const ev = runUntil(b, RIGHT, (x) => x.t === 'level');
    expect(ev.at(-1)).toMatchObject({ levelId: 2 });
    expect(b.tick - a.tick).toBe(CELEBRATE_TICKS - 600);
  });

  test('an encore resumes as an encore', () => {
    const a = new World(TINY2, undefined, { levels: TINY });
    win(a);
    celebrate(a);
    const b = new World(TINY1, undefined, { levels: TINY });
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.level).toBe(TINY2);
    expect(b.encore).toBe(true);
    expect(b.track).toBe(ENCORE_TRACK + 2);
  });
});

// ---- History: the permanent record of a win ------------------------------------------------
import { encodeState, unpackReplay } from '@blobocracy/shared';
import { History } from '../src/history';
import { MemoryStore, ResilientStore } from '../src/store';

function harness(start = TINY1, init?: { deaths: number; record: null }) {
  const mem = new MemoryStore();
  const store = new ResilientStore(mem, { log: () => {} });
  let t = 1_700_000_000_000;
  const world = new World(start, init, { levels: TINY });
  let id = 0;
  const history = new History({
    store, level: start, now: () => t, newId: () => `clip${++id}`, log: () => {},
    renderOg: async () => new Uint8Array([137, 80, 78, 71]),
  });
  const sent: ServerEvent[] = [];
  const step = (votes: VoteCounts, online = 7) => {
    t += 1000 / 60;
    history.observe(world, online);
    const before = world.record;
    const ev = world.step(votes);
    const all = ev.length ? [...ev, ...history.onEvents(ev, world, before)] : ev;
    sent.push(...all);
    if (world.tick % 3 === 0) {
      const b = world.body;
      history.onFrame(encodeState({
        tick: world.tick, run: world.run, x: b.x, y: b.y, vx: b.vx, vy: b.vy, grounded: b.grounded, facing: b.facing, phase: world.phase,
        pull: 0, pressure: 0, strain: 0, jumpHeld: false, online, active: 1, dots: new Uint8Array(4), dotJump: new Uint8Array(4),
        runTime: world.dyn.t, chompStart: null, crumbles: [],
      }), world, online);
    }
    return all;
  };
  const until = (pred: (e: ServerEvent) => boolean, votes = RIGHT, max = CELEBRATE_TICKS + 4000) => {
    for (let i = 0; i < max; i++) if (step(votes).some(pred)) return;
    throw new Error('never happened');
  };
  return { mem, store, world, history, sent, step, until };
}

describe('History: a win', () => {
  test('stamps the win, writes the run, the world row and a permanent hall of fame entry right away', async () => {
    const h = harness(TINY1, { deaths: 4811, record: null });
    h.until((e) => e.t === 'win');
    const w = h.sent.find((e) => e.t === 'win')!;
    expect(w).toMatchObject({ t: 'win', levelId: 1, run: 4812, deaths: 4811, peakPlayers: 7, clipId: 'clip1' });
    expect(h.sent).toContainEqual({ t: 'clip', id: 'clip1', kind: 'win', run: 4812 });
    await h.store.drained();
    const runs = await h.mem.listRuns({ levelId: 1, page: 1, pageSize: 5, best: false });
    expect(runs.runs[0]).toMatchObject({ run: 4812, cause: 'win', maxProgress: 1, zoneReached: 1, peakPlayers: 7, clipId: 'clip1' });
    expect(await h.mem.hallOfFame()).toEqual([{ levelId: 1, levelName: 'Level 1', beatenAt: expect.any(Number), deathCount: 4811, peakPlayers: 7, run: 4812, clipId: 'clip1' }]);
    expect(await h.mem.loadWorld(1)).toMatchObject({ deaths: 4811, record: { progress: 1, run: 4812 } });
    // the clip is being made: it is saved when the celebration ends
    expect(h.history.whenMade('clip1')).not.toBeNull();
    expect(await h.mem.getClip('clip1')).toBeNull();
  });

  test('the win clip is the last 60 s, saved as the celebration ends; then the next level is a fresh track', async () => {
    const h = harness();
    // a slow run first, so the clip window is full
    for (let i = 0; i < 40 * 60; i++) h.step(i < 30 * 60 ? NOBODY : { left: 1, right: 1, jump: 0, active: 2 });
    h.until((e) => e.t === 'win');
    const making = h.history.whenMade('clip1')!;
    h.until((e) => e.t === 'level', JUMP_LEFT);
    const clip = await making;
    expect(clip).toMatchObject({ kind: 'win', run: 1, levelId: 1, progress: 1, cause: 'win', deaths: 0 });
    const replay = (await unpackReplay(clip!.replay))!;
    expect(replay).toMatchObject({ kind: 'win', levelId: 1, run: 1, progress: 1 });
    const kinds = replay.events.map((e) => e.event.t);
    expect(kinds).toContain('win');
    expect(kinds).not.toContain('level');
    const tick = (i: number) => new DataView(replay.frames[i]!.buffer, replay.frames[i]!.byteOffset).getUint32(1, true);
    const span = (tick(replay.frames.length - 1) - tick(0)) / 60;
    expect(span).toBeGreaterThan(59);
    expect(span).toBeLessThanOrEqual(60);
    // the whole celebration is in it
    const winAt = replay.events.find((e) => e.event.t === 'win')!.frameIndex;
    expect((tick(replay.frames.length - 1) - tick(winAt)) / 60).toBeGreaterThan(CELEBRATE_S - 0.2);

    // level 2: its runs and counters are its own
    expect(h.history.level).toBe(TINY2);
    h.until((e) => e.t === 'win'); // run 1 of level 2
    await h.store.drained();
    expect((await h.mem.listRuns({ levelId: 2, page: 1, pageSize: 5, best: false })).runs.map((r) => r.run)).toEqual([1]);
    expect((await h.mem.listRuns({ levelId: 1, page: 1, pageSize: 5, best: false })).runs.map((r) => r.run)).toEqual([1]);
    expect((await h.mem.hallOfFame()).map((x) => x.levelId)).toEqual([1, 2]);
    // the encore that follows counts on its own track
    h.until((e) => e.t === 'level', JUMP_LEFT);
    expect(h.world.track).toBe(ENCORE_TRACK + 2);
    expect(h.history.track).toBe(ENCORE_TRACK + 2);
  });
});
