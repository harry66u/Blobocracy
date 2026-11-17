// Records replay clip fixtures from the real sim, headless and in-process: World + a
// VirtualCrowd of ~300 players driven at 60 Hz exactly like the server loop, every third
// tick encoded as the server would broadcast it and fed to a ReplayRecorder.
//
//   npx tsx tools/make-replay.ts [outDir]
//
// Writes near-miss.replay (a run dies just short of a seeded record: "So close.") and
// zone.replay (a run passes a seeded record, reaches a new zone, then dies: a new record).
// The virtual crowd rarely leaves zone 1 on its own, so each scenario starts its run partway
// along the level (the blob is placed on solid ground; everything after is the real sim),
// and the scenario is searched over start points and crowd seeds for a good moment.
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  DT, FRAME_CRUMBLE_RANGE, LEVEL1, MAX_FRAME_CRUMBLES, PHYS, T_EMPTY, T_SOLID, encodeState, nearbyCrumbles, packReplay, progressOf, tileAt, unpackReplay, zoneAt,
  ReplayRecorder, type Level, type Replay, type ServerEvent,
} from '../packages/shared/src/index';
import { Voters } from '../packages/sim/src/crowd';
import { VirtualCrowd } from '../packages/sim/src/virtual';
import { World } from '../packages/sim/src/world';

const out = process.argv[2] ?? 'packages/client/public/fixtures';
const PLAYERS = 300;
const FRAME_EVERY = 3; // 20 Hz
const DEATHS0 = 4811;
const level = LEVEL1;

/** A standing spot on plain solid ground at (or just after) column x. */
function groundAt(level: Level, x0: number): { x: number; y: number } | null {
  for (let x = Math.floor(x0); x < x0 + 30; x++) {
    for (let y = 1; y < level.height; y++) {
      const t = tileAt(level, x, y);
      if (t === T_EMPTY) continue;
      const ok = t === T_SOLID && tileAt(level, x, y - 1) === T_EMPTY && tileAt(level, x, y - 2) === T_EMPTY
        && tileAt(level, x - 1, y) === T_SOLID && tileAt(level, x + 1, y) === T_SOLID;
      if (ok) return { x: x + 0.5, y: y - PHYS.halfH };
      break;
    }
  }
  return null;
}

interface Outcome { zoneAt: number | null; zoneName: string; deathAt: number | null; deathProgress: number; startProgress: number; progressAt: (t: number) => number }

interface RunOpts { startX: number; seed: number; record: { progress: number; run: number } | null; maxS: number; recorder?: ReplayRecorder; snapshot?: (rec: ReplayRecorder) => void }

/** Runs the sim from a start point until the first death's hold ends (or maxS). */
function run(o: RunOpts): Outcome | null {
  const spot = groundAt(level, o.startX);
  if (!spot) return null;
  const world = new World(level, { deaths: DEATHS0, record: o.record });
  world.body.x = spot.x;
  world.body.y = spot.y;
  world.zone = zoneAt(level, spot.x).index;
  const voters = new Voters();
  const crowd = new VirtualCrowd(voters, PLAYERS, o.seed);
  const trail: number[] = [];
  let pending: ServerEvent[] = [world.welcome(voters.size())];
  let t = 0;
  let zoneT: number | null = null, zoneName = '', deathT: number | null = null, deathP = 0;
  for (let step = 0; t < o.maxS; step++) {
    t += DT;
    crowd.update(t, world);
    const counts = voters.counts(t);
    const events = world.step(counts);
    for (const e of events) {
      if (e.t === 'zone' && zoneT === null) { zoneT = t; zoneName = e.name; }
      if (e.t === 'death' && deathT === null) { deathT = t; deathP = e.progress; }
      if (e.t === 'reset') {
        o.snapshot?.(o.recorder!);
        return { zoneAt: zoneT, zoneName, deathAt: deathT, deathProgress: deathP, startProgress: progressOf(level, spot.x), progressAt: (s) => trail[Math.max(0, Math.min(trail.length - 1, Math.round(s / DT)))] ?? 0 };
      }
    }
    pending.push(...events);
    trail.push(world.maxProgress);
    if (world.tick % FRAME_EVERY === 0) {
      const { dots, dotJump } = voters.sample();
      const b = world.body, k = world.lastBlend, dyn = world.dyn;
      const frame = encodeState({
        tick: world.tick, run: world.run, x: b.x, y: b.y, vx: b.vx, vy: b.vy,
        grounded: b.grounded, facing: b.facing, phase: world.phase,
        pull: k.pull, pressure: k.pressure, strain: k.strain, jumpHeld: k.jumpHeld,
        online: voters.size(), active: counts.active, dots, dotJump,
        runTime: dyn.t, chompStart: dyn.chompStart,
        crumbles: nearbyCrumbles(dyn, world.level, b.x, FRAME_CRUMBLE_RANGE, MAX_FRAME_CRUMBLES),
      });
      o.recorder?.push(frame, pending);
      pending = [];
    }
  }
  return { zoneAt: zoneT, zoneName, deathAt: deathT, deathProgress: deathP, startProgress: progressOf(level, spot.x), progressAt: (s) => trail[Math.round(s / DT)] ?? 0 };
}

async function save(name: string, r: Replay | null): Promise<void> {
  if (!r) throw new Error(`${name}: nothing recorded`);
  const bytes = await packReplay(r);
  const back = await unpackReplay(bytes);
  if (!back || back.frames.length !== r.frames.length) throw new Error(`${name}: does not round-trip`);
  writeFileSync(`${out}/${name}.replay`, bytes);
  const secs = (r.frames.length / 20).toFixed(1);
  const ev = r.events.map((e) => `${e.event.t}@${(e.frameIndex / 20).toFixed(1)}s`).join(' ');
  console.log(`${name}.replay  ${bytes.length} bytes  ${r.frames.length} frames (${secs} s)  kind ${r.kind}  run ${r.run}  ${Math.round(r.progress * 100)}%  deaths ${r.deaths}\n   ${ev}`);
}

mkdirSync(out, { recursive: true });
const recordRun = 3940;
const seeds = [42, 7, 1234, 99, 2026, 5, 314, 808];

// --- near miss: the longest-lived run from a start in zones 2-3, a record seeded just ahead ---
// of where it dies (the crowd dies a lot out there, so runs are short: the clip is the whole run)
let nearMiss: { startX: number; seed: number; p: number; life: number } | null = null;
for (let startX = 540; startX < 1600; startX += 15) {
  for (const seed of seeds.slice(0, 4)) {
    const r = run({ startX, seed, record: null, maxS: 70 });
    if (!r?.deathAt || r.deathProgress - r.startProgress < 0.006) continue;
    if (!nearMiss || r.deathAt > nearMiss.life) nearMiss = { startX, seed, p: r.deathProgress, life: r.deathAt };
  }
}
if (!nearMiss) throw new Error('no near-miss run found');
if (process.env.DEBUG) console.log('near miss pick', nearMiss);
{
  const rec = new ReplayRecorder({ levelId: level.id, levelVersion: level.version });
  const record = { progress: Math.min(1, nearMiss.p + 0.006), run: recordRun };
  run({ ...nearMiss, record, maxS: 90, recorder: rec, snapshot: (r) => void save('near-miss', r.snapshot('near_miss', 30)) });
  console.log(`near miss: start x ${nearMiss.startX}, seed ${nearMiss.seed}, died at ${(nearMiss.p * 100).toFixed(1)}%, record ${(record.progress * 100).toFixed(1)}%`);
}

// --- zone: pass a seeded record, reach a new zone, then die (a new record) -------------------
let zoneRun: { startX: number; seed: number; recordP: number; score: number } | null = null;
for (const boundary of level.zones.slice(1).map((z) => z.startX)) {
  for (let back = 20; back <= 110; back += 6) {
    for (const seed of seeds.slice(0, 4)) {
      const r = run({ startX: boundary - back, seed, record: null, maxS: 60 });
      if (!r?.zoneAt || !r.deathAt) continue;
      const after = r.deathAt - r.zoneAt;
      if (r.zoneAt < 3 || after < 3) continue;
      // build-up before the zone, a while in the new zone, and all of it inside 30 s
      const score = Math.min(r.zoneAt, 9) + Math.min(after, 12) - Math.max(0, r.deathAt + 3.5 - 30);
      const recordP = r.progressAt(r.zoneAt - 2.4);
      if (recordP <= r.startProgress + 0.002) continue;
      if (!zoneRun || score > zoneRun.score) zoneRun = { startX: boundary - back, seed, recordP, score };
      if (process.env.DEBUG) console.log('zone cand', boundary - back, seed, r.zoneAt.toFixed(1), r.deathAt.toFixed(1), score.toFixed(1));
    }
  }
}
if (!zoneRun) throw new Error('no zone run found');
{
  const rec = new ReplayRecorder({ levelId: level.id, levelVersion: level.version });
  const record = { progress: zoneRun.recordP, run: recordRun };
  run({ ...zoneRun, record, maxS: 90, recorder: rec, snapshot: (r) => void save('zone', r.snapshot('record', 30)) });
  console.log(`zone: start x ${zoneRun.startX}, seed ${zoneRun.seed}, record ${(record.progress * 100).toFixed(1)}%`);
}
