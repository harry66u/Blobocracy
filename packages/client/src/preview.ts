// Renderer preview harness: a hand-made test level and a fake, animated scene.
// Query params: ?sky=blue|sunset|purple  &death=1  &paused=1  &at=<seconds to pre-simulate>
//               &touch=1 (force touch controls)  &dots=<count>  &freeze=1 (stop the clock after `at`)
//               &x=<start tile>  &still=1 (blob stands still)  &strain=<0..1> (force tug-of-war strain)
import './fonts.css';
import { InputState, isGameKey } from './input.ts';
import { camera, type Layout } from './layout.ts';
import { mountTouchControls } from './render/touch.ts';
import { renderFrame, TILE_CEIL_SPIKE, TILE_ONEWAY, TILE_SOLID, TILE_SPIKE, type Scene, type SceneDot, type SceneLevel, type Sky } from './render/scene.ts';
import { createCanvasView, loadFonts } from './view.ts';

// ---- test level -----------------------------------------------------------------
const W = 216, H = 18;
const grid = new Uint8Array(W * H);
const set = (x: number, y: number, t: number) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = t; };
const fill = (x0: number, x1: number, y0: number, y1: number, t: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t); };

fill(0, W - 1, 13, 17, TILE_SOLID);
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

const ZONE_NAMES = ['The Meadow', 'Pointy Hill', 'The Grinder', 'Up and Over', 'Night Shift', 'Last Stretch'];
const ZONE_SKIES: Sky[] = ['blue', 'blue', 'sunset', 'sunset', 'purple', 'purple'];
const LEVEL: SceneLevel = {
  width: W,
  height: H,
  tileAt: (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? 0 : grid[y * W + x]!),
  zones: ZONE_SKIES.map((sky, i) => ({ index: i, name: ZONE_NAMES[i]!, sky, startX: i * 36, endX: i * 36 + 36 })),
};

// ---- params ------------------------------------------------------------------------
const P = new URLSearchParams(location.search);
const forcedSky = P.get('sky') as Sky | null;
const deathMode = P.get('death') === '1';
const pausedMode = P.get('paused') === '1';
const nDots = Math.min(128, Number(P.get('dots') ?? 120));
const freeze = P.get('freeze') === '1';
const still = P.get('still') === '1';
const forcedStrain = P.get('strain');
const startX = P.has('x') ? Number(P.get('x')) : forcedSky === 'sunset' ? 73 : forcedSky === 'purple' ? 145 : 3;
const preSim = Number(P.get('at') ?? (deathMode || pausedMode ? 0 : 1.2));

// ---- fake blob physics (just enough to look like a real run) -----------------------
const blob = { x: startX, y: 12.4, vx: 0, vy: 0, grounded: true, facing: 1 as 1 | -1, pull: 0, strain: 0, dead: false };
const solidAt = (x: number, y: number) => LEVEL.tileAt(Math.floor(x), Math.floor(y)) === TILE_SOLID;
const HW = 0.55, HH = 0.6;

function stepBlob(dt: number, pull: number, wantJump: boolean): void {
  const target = 6.5 * Math.sign(pull || 1) * Math.min(1, 0.55 + Math.abs(pull));
  const accel = blob.grounded ? 40 : 28;
  blob.vx += Math.max(-accel * dt, Math.min(accel * dt, target - blob.vx));
  if (Math.abs(blob.vx) > 0.3) blob.facing = blob.vx > 0 ? 1 : -1;
  if (wantJump && blob.grounded) { blob.vy = -19.5; blob.grounded = false; }
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
  if (blob.y > H + 2 || blob.x > W - 4) { blob.x = startX; blob.y = 12.4; blob.vx = blob.vy = 0; }
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
    for (let y = feet + 1; y < H; y++) { const u = LEVEL.tileAt(cx, y); if (u === TILE_SOLID || u === TILE_ONEWAY) { floor = true; break; } }
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
};

let simT = 0;
// death preview: lie on the first floor-spike run of the zone
let deathX = startX + 2;
for (let x = startX; x < W; x++) if (LEVEL.tileAt(x, 12) === TILE_SPIKE) { let e = x; while (LEVEL.tileAt(e + 1, 12) === TILE_SPIKE) e++; deathX = (x + e + 1) / 2; break; }
function simulate(dt: number): void {
  simT += dt;
  updateDots(simT);
  let L = 0, R = 0;
  for (const d of dots) { if (d.dir < 0) L++; else if (d.dir > 0) R++; }
  blob.pull = (R - L) / Math.max(1, dots.length);
  blob.strain = Math.min(1, (2 * Math.min(L, R)) / Math.max(1, L + R));
  if (forcedStrain !== null) blob.strain = Number(forcedStrain);
  if (!deathMode && !pausedMode && !still) {
    const bits = input.bits;
    const pull = bits & 1 ? -1 : bits & 2 ? 1 : 1;
    stepBlob(dt, pull, shouldJump() || (bits & 4) !== 0);
  }
  const zone = LEVEL.zones.find((z) => blob.x >= z.startX && blob.x < z.endX) ?? LEVEL.zones[0]!;
  scene.zoneSky = zone.sky;
  scene.hud.progress = blob.x / W;
  if (deathMode) {
    blob.x = deathX; blob.y = 12.1 - HH; blob.dead = true; blob.grounded = true; blob.vx = 0;
    scene.hud.deaths = 4812;
    scene.hud.deathsJustTicked = true;
    scene.hud.progress = 0.78;
    scene.deathCard = { run: 4812, progress: 0.78, cause: 'Spikes', nearRecord: true };
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
  (window as unknown as { __input: InputState }).__input = input;
  window.addEventListener('keydown', (e) => { if (isGameKey(e.code)) { e.preventDefault(); input.key(e.code, true); } });
  window.addEventListener('keyup', (e) => input.key(e.code, false));
  window.addEventListener('blur', () => input.releaseAll());
  await loadFonts();

  for (let t = 0; t < preSim; t += 1 / 60) simulate(1 / 60);
  if (deathMode || pausedMode) simulate(1 / 60);

  let cam: { x: number; y: number } | null = null;
  let lastLayout: Layout | null = null;
  let last = performance.now();
  let clock = simT;
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!freeze) simulate(dt);
    clock += dt;
    const L = view.layout;
    const focus = { x: blob.x, y: blob.y };
    cam = camera(L, focus, lastLayout === null ? null : cam, dt);
    lastLayout = L;
    const viewW = L.w / L.tile;
    cam.x = Math.max(-1, Math.min(W + 1 - viewW, cam.x));
    const t0 = performance.now();
    renderFrame(view.ctx, L, cam, scene, clock);
    const stats = window as unknown as { __frames?: number; __renderMs?: number; __maxMs?: number };
    const ms = performance.now() - t0;
    stats.__frames = (stats.__frames ?? 0) + 1;
    stats.__renderMs = (stats.__renderMs ?? 0) + ms;
    if (stats.__frames > 30) stats.__maxMs = Math.max(stats.__maxMs ?? 0, ms);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
