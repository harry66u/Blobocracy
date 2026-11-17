import { describe, expect, test } from 'vitest';
import { encodeState, type ServerEvent, type StateFrame } from '../src/protocol';
import {
  MAX_REPLAY_FRAMES, REPLAY_MAGIC, ReplayRecorder, decodeReplay, encodeReplay, frameTick, packReplay, replayDuration, unpackReplay, type Replay,
} from '../src/replay';

function frame(tick: number, over: Partial<StateFrame> = {}): Uint8Array<ArrayBuffer> {
  const n = 128;
  const dots = new Uint8Array(n), dotJump = new Uint8Array(n);
  for (let i = 0; i < n; i++) { dots[i] = (i * 7 + tick) % 4; dotJump[i] = (i + tick) % 5 === 0 ? 1 : 0; }
  return encodeState({
    tick, run: 4812, x: 3.5 + tick / 20, y: 12.4, vx: 6, vy: 0, grounded: true, facing: 1, phase: 'running',
    pull: 0.4, pressure: 0.1, strain: 0.2, jumpHeld: false, online: 300, active: 280, dots, dotJump,
    runTime: tick / 60, chompStart: null, crumbles: [], ...over,
  });
}

const death: ServerEvent = { t: 'death', run: 4812, cause: 'saw', progress: 0.41, deaths: 4812, zone: 2, nearRecord: true };

function sample(n = 90): Replay {
  const frames = Array.from({ length: n }, (_, i) => frame(1000 + i * 3));
  return {
    version: 1, levelId: 1, levelVersion: 3, kind: 'near_miss', run: 4812, deaths: 4812, progress: 0.41,
    frames,
    events: [
      { frameIndex: 0, event: { t: 'welcome', levelId: 1, version: 3, deaths: 4811, record: { progress: 0.43, run: 3940 }, run: 4812, zone: 2, online: 300 } },
      { frameIndex: 10, event: { t: 'zone', run: 4812, index: 2, name: 'The Grinder' } },
      { frameIndex: n - 20, event: death },
    ],
  };
}

describe('replay codec', () => {
  test('encode → decode round-trips every field and the exact frame bytes', () => {
    const r = sample();
    const bytes = encodeReplay(r);
    expect([...bytes.subarray(0, 4)]).toEqual([...REPLAY_MAGIC]);
    const back = decodeReplay(bytes);
    expect(back).not.toBeNull();
    expect(back!.frames.map((f) => [...f])).toEqual(r.frames.map((f) => [...f]));
    expect({ ...back!, frames: [] }).toEqual({ ...r, frames: [] });
  });

  test('a 30 s clip at 20 Hz stays small', () => {
    const bytes = encodeReplay(sample(600));
    expect(bytes.length).toBeLessThan(600 * 110);
  });

  test('pack (deflate when available) and unpack round-trip, and packing shrinks it', async () => {
    const r = sample(600);
    const packed = await packReplay(r);
    const back = await unpackReplay(packed);
    expect(back!.frames.map((f) => [...f])).toEqual(r.frames.map((f) => [...f]));
    expect(back!.events).toEqual(r.events);
    if (typeof CompressionStream !== 'undefined') expect(packed.length).toBeLessThan(encodeReplay(r).length / 2);
    // an uncompressed replay is also accepted by unpack
    expect((await unpackReplay(encodeReplay(r)))!.run).toBe(4812);
  });

  test('corrupt input decodes to null', async () => {
    const good = encodeReplay(sample(20));
    expect(decodeReplay(new Uint8Array(0))).toBeNull();
    expect(decodeReplay(good.subarray(0, 5))).toBeNull();
    for (const cut of [8, 30, good.length - 1]) expect(decodeReplay(good.subarray(0, cut))).toBeNull();
    const extra = new Uint8Array(good.length + 1);
    extra.set(good);
    expect(decodeReplay(extra)).toBeNull(); // trailing junk
    const flip = (at: number, v: number) => { const b = good.slice(); b[at] = v; return b; };
    expect(decodeReplay(flip(0, 0x58))).toBeNull(); // magic
    expect(decodeReplay(flip(4, 2))).toBeNull(); // version
    expect(decodeReplay(flip(5, 0x80))).toBeNull(); // unknown flags
    expect(decodeReplay(flip(6, 9))).toBeNull(); // kind
    // a frame that is not a valid state frame
    const r = sample(3);
    expect(decodeReplay(encodeReplay({ ...r, frames: [r.frames[0]!, new Uint8Array([10, 1, 2, 3])] }))).toBeNull();
    // frames must not go back in time
    expect(decodeReplay(encodeReplay({ ...r, frames: [r.frames[1]!, r.frames[0]!] }))).toBeNull();
    // events: out of range, unsorted, malformed
    expect(decodeReplay(encodeReplay({ ...r, events: [{ frameIndex: 3, event: death }] }))).toBeNull();
    expect(decodeReplay(encodeReplay({ ...r, events: [{ frameIndex: 2, event: death }, { frameIndex: 1, event: death }] }))).toBeNull();
    const bad = { t: 'death', run: 1, cause: 'lava', progress: 0.1, deaths: 1, zone: 0, nearRecord: false } as unknown as ServerEvent;
    expect(decodeReplay(encodeReplay({ ...r, events: [{ frameIndex: 0, event: bad }] }))).toBeNull();
    expect(decodeReplay(encodeReplay({ ...r, events: [{ frameIndex: 0, event: { t: 'zone', run: 1, index: 'x' } as unknown as ServerEvent }] }))).toBeNull();
    expect(decodeReplay(encodeReplay({ ...r, frames: [] }))).toBeNull(); // empty clip
    // garbage in the compressed body
    const packed = await packReplay(sample(50));
    if (packed[5] === 1) {
      const junk = packed.slice();
      for (let i = 10; i < junk.length; i += 7) junk[i] = junk[i]! ^ 0x5a;
      expect(await unpackReplay(junk)).toBeNull();
    }
    expect(await unpackReplay(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test('refuses absurd sizes instead of allocating', () => {
    expect(MAX_REPLAY_FRAMES).toBeGreaterThanOrEqual(1200);
    const b = encodeReplay(sample(2)).slice();
    // patch the frame count to something huge
    new DataView(b.buffer).setUint32(6 + 1 + 4 + 4 + 4 + 8, 0x7fffffff, true);
    expect(decodeReplay(b)).toBeNull();
  });

  test('duration comes from the frame ticks (60 Hz)', () => {
    const r = sample(61); // ticks 1000 … 1180
    expect(frameTick(r.frames[0]!)).toBe(1000);
    expect(replayDuration(r)).toBeCloseTo(180 / 60 + 1 / 20, 5);
  });
});

describe('ReplayRecorder', () => {
  const opts = { levelId: 1, levelVersion: 3 };

  test('keeps only the last `seconds` of frames (by tick), oldest first', () => {
    const rec = new ReplayRecorder({ ...opts, maxSeconds: 60 });
    for (let i = 0; i < 3000; i++) rec.push(frame(i * 3));
    expect(rec.size).toBeLessThanOrEqual(60 * 20 + 1);
    const r = rec.snapshot('near_miss', 30)!;
    const ticks = r.frames.map(frameTick);
    expect(ticks.at(-1)).toBe(2999 * 3);
    expect(ticks[0]).toBe(2999 * 3 - 30 * 60 + 3);
    expect(r.frames.length).toBe(600);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]! - ticks[i - 1]!).toBe(3);
    // wins keep the last minute
    expect(rec.snapshot('win', 60)!.frames.length).toBe(1200);
    // asking for more than the buffer holds gives what it has
    expect(rec.snapshot('win', 600)!.frames.length).toBe(rec.size);
  });

  test('shorter than the window: everything it has', () => {
    const rec = new ReplayRecorder(opts);
    expect(rec.snapshot('record', 30)).toBeNull();
    for (let i = 0; i < 40; i++) rec.push(frame(i * 3));
    expect(rec.snapshot('record', 30)!.frames.length).toBe(40);
  });

  test('events are attached to the frame they arrive with, and the clip opens with a welcome of the state at its start', () => {
    const rec = new ReplayRecorder(opts);
    rec.push(frame(0), [{ t: 'welcome', levelId: 1, version: 3, deaths: 4810, record: { progress: 0.43, run: 3940 }, run: 4811, zone: 0, online: 12 }]);
    for (let i = 1; i < 700; i++) {
      const ev: ServerEvent[] = [];
      if (i === 5) ev.push({ t: 'death', run: 4811, cause: 'pit', progress: 0.1, deaths: 4811, zone: 0, nearRecord: false });
      if (i === 80) ev.push({ t: 'reset', run: 4812 });
      if (i === 400) ev.push({ t: 'zone', run: 4812, index: 1, name: 'Pointy Meadow' });
      if (i === 690) ev.push(death, { t: 'record', run: 4812, progress: 0.44 });
      rec.push(frame(i * 3), ev);
    }
    const r = rec.snapshot('near_miss', 30)!;
    expect(r.frames.length).toBe(600);
    const first = 700 - 600;
    expect(r.events[0]).toEqual({
      frameIndex: 0,
      event: { t: 'welcome', levelId: 1, version: 3, deaths: 4811, record: { progress: 0.43, run: 3940 }, run: 4812, zone: 0, online: 300 },
    });
    expect(r.events.slice(1)).toEqual([
      { frameIndex: 400 - first, event: { t: 'zone', run: 4812, index: 1, name: 'Pointy Meadow' } },
      { frameIndex: 690 - first, event: death },
      { frameIndex: 690 - first, event: { t: 'record', run: 4812, progress: 0.44 } },
    ]);
    // the clip is about its last death: run, progress, and the death count after it
    expect(r).toMatchObject({ version: 1, levelId: 1, levelVersion: 3, kind: 'near_miss', run: 4812, progress: 0.41, deaths: 4812 });
    // and it survives the codec
    expect(decodeReplay(encodeReplay(r))!.events).toEqual(r.events);
  });

  test('a win clip without a death reports the current run at 100%', () => {
    const rec = new ReplayRecorder(opts);
    rec.push(frame(0), [{ t: 'welcome', levelId: 1, version: 3, deaths: 99, record: null, run: 100, zone: 5, online: 1 }]);
    rec.push(frame(3));
    expect(rec.snapshot('win', 60)).toMatchObject({ kind: 'win', run: 100, progress: 1, deaths: 99 });
    expect(rec.snapshot('win', 60, { progress: 0.999 })!.progress).toBe(0.999);
  });

  test('refuses bytes that are not a state frame', () => {
    const rec = new ReplayRecorder(opts);
    expect(() => rec.push(new Uint8Array([12, 0, 0, 0, 0]))).toThrow();
  });

  test('recorded frames are copies (the caller may reuse its buffer)', () => {
    const rec = new ReplayRecorder(opts);
    const f = frame(3);
    rec.push(f);
    const want = [...f];
    f.fill(0);
    expect([...rec.snapshot('record', 30)!.frames[0]!]).toEqual(want);
  });
});
