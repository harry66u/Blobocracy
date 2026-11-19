import { describe, expect, test } from 'vitest';
import { encodeState, parseLevel, unpackReplay, type ServerEvent, type VoteCounts } from '@blobocracy/shared';
import { History, clipKindFor } from '../src/history';
import { MemoryStore, ResilientStore } from '../src/store';
import { World } from '../src/world';

function room(profile: string, spawnAt = -1, goalAt = -1): string[] {
  const rows: string[] = [];
  for (let r = 0; r < 18; r++) {
    let row = '';
    for (let c = 0; c < profile.length; c++) {
      if (r === 12 && c === spawnAt) row += '@';
      else if (r === 12 && c === goalAt) row += 'G';
      else row += r >= 13 && profile[c] === '#' ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}
// a lone voter holding right always dies in the same pit
const LEVEL = parseLevel(99, 3, [
  { name: 'A', sky: 'blue', rooms: [room('######', 1)] },
  { name: 'B', sky: 'sunset', rooms: [room('####____######', -1, 13)] },
]);
const RIGHT: VoteCounts = { left: 0, right: 1, jump: 0, active: 1 };

/** The sim loop in miniature: steps, events, a frame every 3 ticks. */
function harness() {
  const mem = new MemoryStore();
  const store = new ResilientStore(mem, { log: () => {} });
  let t = 1_700_000_000_000;
  const world = new World(LEVEL);
  let id = 0;
  const og: unknown[] = [];
  const history = new History({
    store, level: LEVEL, now: () => t, newId: () => `clip${++id}`, log: () => {},
    renderOg: async (c) => { og.push(c); return new Uint8Array([137, 80, 78, 71]); },
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
  const until = (pred: (e: ServerEvent) => boolean, max = 5000) => {
    for (let i = 0; i < max; i++) if (step(RIGHT).some(pred)) return;
    throw new Error('never happened');
  };
  return { mem, store, world, history, sent, step, until, og };
}

describe('clip triggers', () => {
  const death = (progress: number, nearRecord: boolean) => ({ t: 'death' as const, run: 9, cause: 'saw' as const, progress, deaths: 9, zone: 2, nearRecord });
  test('new record past the old one, near miss, nothing', () => {
    expect(clipKindFor(death(0.5, false), true)).toBe('record');
    expect(clipKindFor(death(0.5, true), false)).toBe('near_miss');
    expect(clipKindFor(death(0.3, false), false)).toBeNull();
    expect(clipKindFor(death(0.02, false), true)).toBeNull(); // the first runs of a level set tiny records
  });
});

describe('History', () => {
  test('records every run, makes a record clip when the run resets, then a near miss', async () => {
    const h = harness();
    h.until((e) => e.t === 'death');
    const clipEv = h.sent.find((e) => e.t === 'clip');
    expect(clipEv).toEqual({ t: 'clip', id: 'clip1', kind: 'record', run: 1 });
    // announced at the death, saved at the reset: a request in between waits for it
    const making = h.history.whenMade('clip1');
    // the live snapshot names the clip being made, so a restart can say it was lost (M6)
    expect(h.history.live().pendingClip).toMatchObject({ id: 'clip1', kind: 'record', run: 1 });
    expect(making).not.toBeNull();
    h.until((e) => e.t === 'reset');
    const made = await making!;
    expect(h.history.live().pendingClip).toBeUndefined();
    expect(made?.kind).toBe('record');
    await h.store.drained();

    const page = await h.mem.listRuns({ levelId: 99, page: 1, pageSize: 10, best: false });
    expect(page.runs).toHaveLength(1);
    const run = page.runs[0]!;
    expect(run).toMatchObject({ run: 1, levelVersion: 3, cause: 'pit', zoneReached: 1, peakPlayers: 7, clipId: 'clip1' });
    expect(run.durationMs).toBeGreaterThan(500);
    expect(run.endedAt - run.startedAt).toBeGreaterThanOrEqual(run.durationMs - 1); // durationMs is rounded to whole ms
    expect(run.maxX).toBeGreaterThan(9);

    const clip = await h.mem.getClip('clip1');
    expect(clip).toMatchObject({ kind: 'record', run: 1, levelId: 99, levelVersion: 3, cause: 'pit', deaths: 1 });
    expect(clip!.og).toEqual(new Uint8Array([137, 80, 78, 71]));
    const replay = await unpackReplay(clip!.replay);
    expect(replay).not.toBeNull();
    const kinds = replay!.events.map((e) => e.event.t);
    expect(kinds[0]).toBe('welcome');
    expect(kinds).toContain('death');
    // the clip ends with the whole death hold (freeze + card), right before the reset
    const deathAt = replay!.events.find((e) => e.event.t === 'death')!.frameIndex;
    const tick = (i: number) => new DataView(replay!.frames[i]!.buffer, replay!.frames[i]!.byteOffset).getUint32(1, true);
    expect((tick(replay!.frames.length - 1) - tick(deathAt)) / 60).toBeGreaterThan(3.3);
    expect(kinds).not.toContain('clip');
    expect(h.og[0]).toMatchObject({ run: 1, kind: 'record', cause: 'pit', sky: 'sunset', record: null });

    // the world row is written on every death, record marked with its level version
    expect(await h.mem.loadWorld(99)).toMatchObject({ deaths: 1, record: { run: 1, version: 3 }, peakPlayers: 7, nextRun: 2 });

    // the same death again is within 5% of the record: a near miss
    h.until((e) => e.t === 'death');
    expect(h.sent.filter((e) => e.t === 'clip').at(-1)).toEqual({ t: 'clip', id: 'clip2', kind: 'near_miss', run: 2 });
    h.until((e) => e.t === 'reset');
    await h.history.whenMade('clip2');
    await h.store.drained();
    expect((await h.mem.getClip('clip2'))?.kind).toBe('near_miss');
    expect((await h.mem.listRuns({ levelId: 99, page: 1, pageSize: 10, best: false })).runs.map((r) => [r.run, r.clipId])).toEqual([[2, 'clip2'], [1, 'clip1']]);
  });
});
