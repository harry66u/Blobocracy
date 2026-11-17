// Renderer preview harness: a hand-made test level and a fake, animated scene.
// Query params: ?sky=blue|sunset|purple  &death=1  &paused=1  &at=<seconds to pre-simulate>
//               &touch=1 (force touch controls)  &dots=<count>  &freeze=1 (stop the clock after `at`)
//               &x=<start tile>  &still=1 (blob stands still)  &strain=<0..1> (force tug-of-war strain)
//               &level=mech (the milestone-2 mechanics test level)  &rt=<run clock offset, s>
//               &y=<start feet row>  &chomp=<tiles the Big Chomp's teeth are behind the blob>
//               &crumbleDemo=1 (crumble tiles left of the blob caught at every stage of breaking)
//               &moment=death|zone|record|swoop (play a big moment once the page is up; window.__momentAge
//                 is its age in preview seconds)  &cause=press|spikes|ceiling spikes|pit|saw|chomp
//               &slow=<time scale, e.g. 0.1 for slow motion>  &reduced=1 (reduced motion)  &settings=1 (open the panel)
//               &dead=1 (with &moment=death: the blob lies at x/y as killed by &cause)
import { makeEntity, type Entity } from '@blobocracy/shared';
import './fonts.css';
import { InputState, isGameKey } from './input.ts';
import { type Layout } from './layout.ts';
import { CameraRig } from './camera.ts';
import { Director } from './director.ts';
import { DEATH_SHAKE, DEATH_TOTAL_S, swoopDuration } from './moments.ts';
import { mountHudControls } from './settings.ts';
import { mountTouchControls } from './render/touch.ts';
import { renderFrame, TILE_CEIL_SPIKE, TILE_CONVEYOR_L, TILE_CONVEYOR_R, TILE_CRUMBLE, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE, TILE_SPRING, type Scene, type SceneCrumble, type SceneDot, type SceneLevel, type Sky } from './render/scene.ts';
import { crumbleGone } from './render/danger.ts';
import { entityState, MOVER_THICKNESS } from '@blobocracy/shared';
import { createCanvasView, loadFonts } from './view.ts';

// ---- test levels ----------------------------------------------------------------
const P = new URLSearchParams(location.search);
const MECH = P.get('level') === 'mech';
const W = MECH ? 176 : 216, H = 18;
const grid = new Uint8Array(W * H);
const set = (x: number, y: number, t: number) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = t; };
const fill = (x0: number, x1: number, y0: number, y1: number, t: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t); };

fill(0, W - 1, 13, 17, TILE_SOLID);
const entities: Entity[] = [];
const ent = (spec: Parameters<typeof makeEntity>[0], tx: number, ty: number) => entities.push(makeEntity(spec, entities.length, tx, ty));
if (MECH) buildMechLevel(); else buildBasicLevel();

function buildBasicLevel(): void {
// zone 1 (blue): spikes, a gap bridged by a one-way, a step up with a lone spike
fill(12, 14, 12, 12, TILE_SPIKE);
fill(18, 20, 13, 17, 0);
fill(17, 21, 10, 10, TILE_ONEWAY);
fill(25, 35, 12, 12, TILE_SOLID);
set(31, 11, TILE_SPIKE);
// zone 2: floating block with ceiling spikes, spike run, gap, one-way stairs
fill(44, 47, 8, 9, TILE_SOLID);
fill(44, 47, 10, 10, TILE_CEIL_SPIKE);
fill(51, 53, 12, 12, TILE_SPIKE);
fill(57, 59, 13, 17, 0);
fill(61, 63, 10, 10, TILE_ONEWAY);
fill(65, 68, 7, 7, TILE_ONEWAY);
// zone 3 (sunset): pillar, long gap with a one-way stepping stone, overhang with ceiling spikes
fill(77, 78, 11, 12, TILE_SOLID);
fill(83, 87, 13, 17, 0);
fill(84, 86, 11, 11, TILE_ONEWAY);
fill(92, 102, 7, 8, TILE_SOLID);
fill(94, 100, 9, 9, TILE_CEIL_SPIKE);
fill(105, 106, 12, 12, TILE_SPIKE);
// zone 4: staircase up, a wide gap, spikes under one-way platforms
fill(110, 113, 12, 12, TILE_SOLID);
fill(114, 117, 11, 12, TILE_SOLID);
fill(118, 121, 10, 12, TILE_SOLID);
fill(122, 125, 13, 17, 0);
fill(130, 132, 12, 12, TILE_SPIKE);
fill(128, 134, 9, 9, TILE_ONEWAY);
// zone 5 (purple): gap, long spike run, floating solid, ceiling spikes from a hanging mass
fill(150, 152, 13, 17, 0);
fill(156, 160, 12, 12, TILE_SPIKE);
fill(163, 166, 10, 10, TILE_SOLID);
fill(169, 173, 3, 6, TILE_SOLID);
fill(169, 173, 7, 7, TILE_CEIL_SPIKE);
// zone 6: a one-tile notch, diagonal blocks, a block with a hole
fill(186, 186, 13, 17, 0);
set(192, 9, TILE_SOLID); set(193, 10, TILE_SOLID); set(194, 11, TILE_SOLID);
fill(198, 203, 8, 11, TILE_SOLID);
fill(200, 201, 9, 10, 0);
fill(207, 209, 12, 12, TILE_SPIKE);
}

/** Every milestone-2 mechanic, one zone each (44 columns per zone). */
function buildMechLevel(): void {
  // zone 0 (sunset) The Grinder: three staggered presses, a mover over a pit, a lift
  for (const [i, x] of [9, 13, 17].entries()) ent({ kind: 'crusher', w: 2, drop: 13 - 5 - 2.72, period: 3.2, phase: i * 0.33 }, x, 5);
  fill(23, 31, 13, 17, 0);
  ent({ kind: 'mover', w: 3, dx: 6, dy: 0, period: 4 }, 22, 12);
  ent({ kind: 'mover', w: 2, dx: 0, dy: -4, period: 3.5 }, 35, 12);
  fill(38, 43, 8, 12, TILE_SOLID);
  // zone 1 (sunset) Sundown Steps: a crumble bridge, springs, crumbling steps
  fill(49, 56, 13, 17, 0);
  fill(49, 56, 13, 13, TILE_CRUMBLE);
  set(60, 12, TILE_SPRING);
  fill(62, 66, 6, 7, TILE_SOLID);
  fill(70, 72, 10, 10, TILE_CRUMBLE);
  fill(74, 76, 8, 8, TILE_CRUMBLE);
  set(80, 12, TILE_SPRING);
  set(84, 12, TILE_SPRING);
  // zone 2 (purple) Purple Panic: a belt pushing back into a saw gate, a high belt, saws on rails
  fill(92, 100, 13, 13, TILE_CONVEYOR_L);
  ent({ kind: 'saw', r: 0.9, dx: 0, dy: -3, period: 2 }, 103, 11);
  fill(107, 112, 9, 9, TILE_CONVEYOR_R);
  ent({ kind: 'saw', r: 0.7, dx: 6, dy: 0, period: 3 }, 115, 11);
  ent({ kind: 'saw', r: 1.25, period: 1 }, 126, 13);
  // zone 3 (purple) The Last Inch: the Big Chomp chasing through spikes, a press and crumbles
  ent({ kind: 'chomp', speed: 2.2 }, 133, 0);
  fill(142, 143, 12, 12, TILE_SPIKE);
  ent({ kind: 'crusher', w: 3, drop: 13 - 4 - 2.72, period: 2.6 }, 150, 4);
  fill(158, 161, 13, 17, 0);
  fill(158, 161, 13, 13, TILE_CRUMBLE);
  fill(166, 167, 12, 12, TILE_SPIKE);
}

const ZONE_NAMES = MECH ? ['The Grinder', 'Sundown Steps', 'Purple Panic', 'The Last Inch'] : ['The Meadow', 'Pointy Hill', 'The Grinder', 'Up and Over', 'Night Shift', 'Last Stretch'];
const ZONE_SKIES: Sky[] = MECH ? ['sunset', 'sunset', 'purple', 'purple'] : ['blue', 'blue', 'sunset', 'sunset', 'purple', 'purple'];
const ZW = MECH ? 44 : 36;
const LEVEL: SceneLevel = {
  width: W,
  height: H,
  tileAt: (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? 0 : grid[y * W + x]!),
  zones: ZONE_SKIES.map((sky, i) => ({ index: i, name: ZONE_NAMES[i]!, sky, startX: i * ZW, endX: i * ZW + ZW })),
  entities,
};

// ---- params ------------------------------------------------------------------------
const forcedSky = P.get('sky') as Sky | null;
const deathMode = P.get('death') === '1';
const pausedMode = P.get('paused') === '1';
const nDots = Math.min(128, Number(P.get('dots') ?? 120));
const freeze = P.get('freeze') === '1';
const still = P.get('still') === '1';
const forcedStrain = P.get('strain');
const startX = P.has('x') ? Number(P.get('x')) : MECH ? 3 : forcedSky === 'sunset' ? 73 : forcedSky === 'purple' ? 145 : 3;
const startY = (P.has('y') ? Number(P.get('y')) : 13) - 0.6;
const preSim = Number(P.get('at') ?? (deathMode || pausedMode ? 0 : 1.2));
const rtOffset = Number(P.get('rt') ?? 0);
const chompBehind = P.has('chomp') ? Number(P.get('chomp')) : null;
const crumbleDemo = P.get('crumbleDemo') === '1';
const moment = P.get('moment');
const cause = P.get('cause') ?? 'spikes';
const timeScale = Number(P.get('slow') ?? 1);
let reduced = P.get('reduced') === '1';
let muted = false;

// ---- fake blob physics (just enough to look like a real run) -----------------------
const blob: { x: number; y: number; vx: number; vy: number; grounded: boolean; facing: 1 | -1; pull: number; strain: number; dead: boolean; deathCause?: string | null } = { x: startX, y: startY, vx: 0, vy: 0, grounded: true, facing: 1, pull: 0, strain: 0, dead: false };
const startX0 = MECH ? 3 : 3;
const crumbles: SceneCrumble[] = [];
let runTime = rtOffset;
const solidTile = (t: number) => t === TILE_SOLID || t === TILE_CRUMBLE || t === TILE_SPRING || t === TILE_CONVEYOR_L || t === TILE_CONVEYOR_R;
const solidAt = (x: number, y: number) => {
  const tx = Math.floor(x), ty = Math.floor(y);
  const t = LEVEL.tileAt(tx, ty);
  return solidTile(t) && !(t === TILE_CRUMBLE && crumbleGone(crumbles, tx, ty, runTime));
};
const HW = 0.55, HH = 0.6;
let riding: Entity | null = null;

function stepBlob(dt: number, pull: number, wantJump: boolean): void {
  const target = 6.5 * Math.sign(pull || 1) * Math.min(1, 0.55 + Math.abs(pull));
  const accel = blob.grounded ? 40 : 28;
  blob.vx += Math.max(-accel * dt, Math.min(accel * dt, target - blob.vx));
  if (Math.abs(blob.vx) > 0.3) blob.facing = blob.vx > 0 ? 1 : -1;
  // what the blob stands on: springs launch, belts push, crumbles start to go
  if (blob.grounded) {
    const fx = Math.floor(blob.x), fy = Math.floor(blob.y + HH + 0.05);
    const t = LEVEL.tileAt(fx, fy);
    if (t === TILE_SPRING) { blob.vy = -29; blob.grounded = false; wantJump = false; }
    if (t === TILE_CONVEYOR_L || t === TILE_CONVEYOR_R) blob.x += (t === TILE_CONVEYOR_R ? 3 : -3) * dt;
    for (const xx of [blob.x - HW + 0.05, blob.x + HW - 0.05]) {
      const cx = Math.floor(xx);
      if (LEVEL.tileAt(cx, fy) === TILE_CRUMBLE && !crumbles.some((c) => c.tx === cx && c.ty === fy)) crumbles.push({ tx: cx, ty: fy, at: runTime });
    }
  }
  if (riding) {
    const a = entityState(riding, runTime - dt), b = entityState(riding, runTime);
    if (a.kind === 'mover' && b.kind === 'mover') { blob.x += b.x - a.x; blob.y = b.y - HH; }
  }
  if (wantJump && blob.grounded) { blob.vy = -19.5; blob.grounded = false; riding = null; }
  blob.vy = Math.min(22, blob.vy + 55 * dt);
  // x
  blob.x += blob.vx * dt;
  for (const yy of [blob.y - HH + 0.05, blob.y, blob.y + HH - 0.05]) {
    if (blob.vx > 0 && solidAt(blob.x + HW, yy)) { blob.x = Math.floor(blob.x + HW) - HW - 0.001; blob.vx = 0; }
    if (blob.vx < 0 && solidAt(blob.x - HW, yy)) { blob.x = Math.floor(blob.x - HW) + 1 + HW + 0.001; blob.vx = 0; }
  }
  // y
  const prevBottom = blob.y + HH;
  blob.y += blob.vy * dt;
  blob.grounded = false;
  for (const xx of [blob.x - HW + 0.05, blob.x + HW - 0.05]) {
    const bottom = blob.y + HH;
    const t = LEVEL.tileAt(Math.floor(xx), Math.floor(bottom));
    if (blob.vy >= 0 && (t === TILE_SOLID || (t === TILE_ONEWAY && prevBottom <= Math.floor(bottom) + 0.01))) {
      blob.y = Math.floor(bottom) - HH;
      blob.vy = 0;
      blob.grounded = true;
    }
    if (blob.vy < 0 && solidAt(xx, blob.y - HH)) { blob.y = Math.floor(blob.y - HH) + 1 + HH; blob.vy = 0; }
  }
  riding = null;
  for (const e of entities) {
    if (e.kind !== 'mover' || blob.vy < 0) continue;
    const s = entityState(e, runTime);
    if (s.kind !== 'mover' || blob.x + HW < s.x || blob.x - HW > s.x + s.w) continue;
    const bottom = blob.y + HH;
    if (prevBottom <= s.y + 0.2 && bottom >= s.y && bottom <= s.y + MOVER_THICKNESS) { blob.y = s.y - HH; blob.vy = 0; blob.grounded = true; riding = e; }
  }
  if (blob.y > H + 2 || blob.x > W - 4) { blob.x = startX; blob.y = startY; blob.vx = blob.vy = 0; crumbles.length = 0; }
}

function shouldJump(): boolean {
  if (!blob.grounded) return false;
  const dir = blob.facing;
  for (let d = 0.6; d <= 2.2; d += 0.4) {
    const cx = Math.floor(blob.x + dir * d);
    const feet = Math.floor(blob.y + HH - 0.01);
    const t = LEVEL.tileAt(cx, feet);
    if (t === TILE_SPIKE || solidAt(cx, blob.y)) return true;
    let floor = false;
    for (let y = feet + 1; y < H; y++) { const u = LEVEL.tileAt(cx, y); if (solidTile(u) || u === TILE_ONEWAY) { floor = true; break; } }
    if (!floor && d > 1.2) return true;
  }
  return false;
}

// ---- fake crowd ------------------------------------------------------------------
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const dots: SceneDot[] = Array.from({ length: nDots }, (_, i) => ({ slot: i, dir: 0, jump: false }));
function updateDots(t: number): void {
  // alternate between the crowd mostly agreeing and a real tug of war
  const fight = Math.sin(t * 0.45) > 0.35;
  for (const d of dots) {
    const period = 2.5 + hash(d.slot, 99) * 4;
    const bucket = Math.floor((t + hash(d.slot, 7) * period) / period);
    const r = hash(d.slot, bucket);
    const pL = fight ? 0.42 : 0.18, pR = fight ? 0.84 : 0.86;
    const intent = r < pL ? -1 : r < pR ? 1 : 0;
    d.dir = intent as -1 | 0 | 1;
    d.jump = intent === 0 ? hash(d.slot, bucket + 5) < 0.8 : hash(d.slot, bucket + 3) < 0.2;
    if (pausedMode) { d.dir = 0; d.jump = false; }
  }
}

// ---- scene ---------------------------------------------------------------------
const input = new InputState(() => {});
const scene: Scene = {
  level: LEVEL,
  blob,
  dots,
  you: { dir: 1, jump: true },
  hud: { deaths: 4811, deathsJustTicked: false, online: 12408, record: { progress: 0.83, run: 3940 }, progress: 0, recordLabel: 'run 3,940, nine days ago' },
  deathCard: null,
  zoneSky: forcedSky ?? 'blue',
  paused: pausedMode,
  runTime,
  chompStart: null,
  crumbles,
};
const chomp = entities.find((e) => e.kind === 'chomp');

let simT = 0;
/** The blob lies dead where it is (moment=death, until the swoop). */
let momentDead = false;
// death preview: lie on the first floor-spike run of the zone
let deathX = startX + 2;
for (let x = startX; x < W; x++) if (LEVEL.tileAt(x, 12) === TILE_SPIKE) { let e = x; while (LEVEL.tileAt(e + 1, 12) === TILE_SPIKE) e++; deathX = (x + e + 1) / 2; break; }
function simulate(dt: number): void {
  simT += dt;
  runTime += dt;
  scene.runTime = runTime;
  updateDots(simT);
  let L = 0, R = 0;
  for (const d of dots) { if (d.dir < 0) L++; else if (d.dir > 0) R++; }
  blob.pull = (R - L) / Math.max(1, dots.length);
  blob.strain = Math.min(1, (2 * Math.min(L, R)) / Math.max(1, L + R));
  if (forcedStrain !== null) blob.strain = Number(forcedStrain);
  if (!deathMode && !pausedMode && !still && !momentDead) {
    const bits = input.bits;
    const pull = bits & 1 ? -1 : bits & 2 ? 1 : 1;
    stepBlob(dt, pull, shouldJump() || (bits & 4) !== 0);
  }
  if (chomp && chomp.kind === 'chomp') {
    // chase once the blob enters the last zone, or sit a fixed distance behind it (&chomp=)
    if (chompBehind !== null) scene.chompStart = runTime - (blob.x - chompBehind - chomp.x) / chomp.speed;
    else if (scene.chompStart === null && blob.x > chomp.x + 4) scene.chompStart = runTime;
  }
  if (crumbleDemo) {
    crumbles.length = 0;
    const fy = Math.floor(blob.y + HH + 0.05);
    for (let k = 0; k < 6; k++) {
      const tx = Math.floor(blob.x) - k;
      if (LEVEL.tileAt(tx, fy) === TILE_CRUMBLE) crumbles.push({ tx, ty: fy, at: runTime - k * 0.24 });
    }
  }
  const zone = LEVEL.zones.find((z) => blob.x >= z.startX && blob.x < z.endX) ?? LEVEL.zones[0]!;
  scene.zoneSky = zone.sky;
  scene.hud.progress = blob.x / W;
  if (deathMode) {
    blob.x = deathX; blob.y = 12.1 - HH; blob.dead = true; blob.grounded = true; blob.vx = 0;
    scene.hud.deaths = 4812;
    scene.hud.deathsJustTicked = true;
    scene.hud.progress = 0.78;
    scene.deathCard = { run: 4812, progress: 0.78, line: 'then the Spikes popped it.', nearRecord: true, countdown: 3 };
  } else {
    const k = Math.floor(simT / 7);
    scene.hud.deaths = 4811 + k;
    scene.hud.deathsJustTicked = k > 0 && simT % 7 < 1.6;
  }
  const bits = input.bits;
  scene.you = bits
    ? { dir: bits & 1 ? -1 : bits & 2 ? 1 : 0, jump: (bits & 4) !== 0 }
    : { dir: 1, jump: Math.sin(simT * 0.9) > -0.2 };
}

// ---- boot ----------------------------------------------------------------------
async function main(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const view = createCanvasView(canvas);
  mountTouchControls(document.body, input, { force: P.get('touch') === '1' });
  (window as unknown as { __input: InputState; __scene: Scene }).__input = input;
  (window as unknown as { __scene: Scene }).__scene = scene;
  window.addEventListener('keydown', (e) => { if (isGameKey(e.code)) { e.preventDefault(); input.key(e.code, true); } });
  window.addEventListener('keyup', (e) => input.key(e.code, false));
  window.addEventListener('blur', () => input.releaseAll());
  await loadFonts();

  for (let t = 0; t < preSim; t += 1 / 60) simulate(1 / 60);
  if (deathMode || pausedMode) simulate(1 / 60);

  const rig = new CameraRig();
  const director = new Director(() => reduced);
  const W0 = { deaths: 4811, record: { progress: 0.83, run: 3940 }, run: 4812 };
  director.welcome(W0);
  const controls = mountHudControls(document.body, {
    layout: () => view.layout,
    muted: () => muted,
    setMuted: (m) => { muted = m; },
    reduced: () => reduced,
    setReduced: (on) => { reduced = on; },
  });
  if (P.get('settings') === '1') controls.open();
  let last = performance.now();
  let clock = simT;
  let momentT0: number | null = null;
  let swooped = false;
  const stats = window as unknown as { __frames?: number; __renderMs?: number; __maxMs?: number; __momentAge?: number };
  const progressOfX = (x: number) => x / W;
  const startMoment = () => {
    momentT0 = clock;
    if (moment === 'death') {
      momentDead = true;
      blob.dead = true;
      blob.vx = blob.vy = 0;
      director.onDeath({ run: 4812, cause, progress: 0.78, deaths: 4812, nearRecord: true }, clock);
      if (!reduced) rig.kick(DEATH_SHAKE.amp, DEATH_SHAKE.dur);
    } else if (moment === 'swoop') {
      momentDead = true;
      blob.dead = true;
      director.onDeath({ run: 4812, cause, progress: progressOfX(blob.x), deaths: 4812, nearRecord: false }, clock);
    } else if (moment === 'zone') {
      const z = LEVEL.zones.find((zz) => blob.x >= zz.startX && blob.x < zz.endX) ?? LEVEL.zones[0]!;
      director.onZone(z.index, z.name, clock);
    } else if (moment === 'record') {
      // a record just behind the blob, so this run passes it right away
      director.welcome({ ...W0, record: { progress: progressOfX(blob.x - 1.2), run: 3940 } });
      director.frame(clock, W0.run, progressOfX(blob.x - 2), true);
    }
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000) * timeScale;
    last = now;
    if (!freeze) simulate(dt);
    clock += dt;
    if (moment && momentT0 === null && (stats.__frames ?? 0) > 3) startMoment();
    const age = momentT0 === null ? null : clock - momentT0;
    stats.__momentAge = age ?? -1;
    if (moment === 'swoop' && age !== null && age > DEATH_TOTAL_S && !swooped) {
      // the reset: everyone back to the start, camera flies there
      swooped = true;
      const from = blob.x;
      director.onReset(4813, clock);
      momentDead = false;
      blob.dead = false;
      blob.x = startX0; blob.y = startY; blob.vx = 0;
      rig.swoop(swoopDuration(from - startX0, reduced), reduced);
    }
    const L = view.layout;
    let cam = rig.update(L, blob, dt, reduced);
    const sh = rig.shakeOffset();
    cam = { x: cam.x + sh.x, y: cam.y + sh.y };
    const viewW = L.w / L.tile;
    cam.x = Math.max(-1, Math.min(W + 1 - viewW, cam.x));
    if (moment) {
      const d = director.frame(clock, swooped ? 4813 : 4812, progressOfX(blob.x), !blob.dead);
      blob.deathCause = blob.dead ? cause : null;
      scene.hud.deaths = d.deaths;
      scene.hud.deathsJustTicked = d.deathsJustTicked;
      scene.hud.record = d.record;
      scene.hud.recordLabel = d.recordLabel;
      scene.hud.recordPop = d.recordPop;
      scene.deathCard = d.card;
      if (rig.swoopK !== null) {
        scene.hud.progress = progressOfX(cam.x + L.lookAhead);
        const z = LEVEL.zones.find((zz) => cam.x + L.lookAhead >= zz.startX && cam.x + L.lookAhead < zz.endX) ?? LEVEL.zones[0]!;
        scene.zoneSky = z.sky;
      }
      scene.fx = {
        reduced, freeze: d.freeze, flash: d.flash, vignette: d.vignette, fade: rig.swoopFade, banner: d.banner,
        recordFlag: d.flagProgress === null ? null : { x: d.flagProgress * W, label: `${Math.round(d.flagProgress * 100)}%` },
        skyRate: rig.swoopK !== null ? (reduced ? 50 : 3.5) : reduced ? 0.6 : 1,
      };
    } else {
      scene.fx = { reduced, freeze: false, flash: 0, vignette: 0, fade: 0, banner: null, recordFlag: { x: 0.83 * W, label: '83%' }, skyRate: 1 };
    }
    scene.hud.muted = muted;
    const t0 = performance.now();
    renderFrame(view.ctx, L, cam, scene, clock);
    const ms = performance.now() - t0;
    stats.__frames = (stats.__frames ?? 0) + 1;
    stats.__renderMs = (stats.__renderMs ?? 0) + ms;
    if (stats.__frames > 30) stats.__maxMs = Math.max(stats.__maxMs ?? 0, ms);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
