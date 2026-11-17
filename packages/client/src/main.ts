// The game page: connects to the shared world, sends this player's input, and draws
// the server's blob with a little prediction so it feels responsive.
import './fonts.css';
import { LEVEL1, progressOf, tileAt, zoneAt, type ServerEvent } from '@blobocracy/shared';
import { connect } from './net.ts';
import { InputState, isGameKey } from './input.ts';
import { camera } from './layout.ts';
import { predict, smooth } from './predict.ts';
import { mountTouchControls } from './render/touch.ts';
import { renderFrame, type Scene, type SceneDot, type SceneLevel } from './render/scene.ts';
import { createCanvasView, loadFonts } from './view.ts';

const level = LEVEL1;
// One SceneLevel object for the whole session: the renderer caches level chunks per object.
const sceneLevel: SceneLevel = {
  width: level.width,
  height: level.height,
  tileAt: (tx, ty) => tileAt(level, tx, ty),
  zones: level.zones,
};

const TICK_FLASH_S = 1.2;
const CAUSE_NAMES: Record<string, string> = { spikes: 'Spikes', 'ceiling spikes': 'Ceiling Spikes', pit: 'Pit' };

const hud = { deaths: 0, record: null as { progress: number; run: number } | null, tickedAt: -Infinity };
let deathCard: Scene['deathCard'] = null;
const statusEl = document.getElementById('status')!;
const announceEl = document.getElementById('announce')!;

function onEvent(e: ServerEvent): void {
  const now = performance.now() / 1000;
  switch (e.t) {
    case 'welcome':
      hud.deaths = e.deaths;
      hud.record = e.record;
      break;
    case 'death':
      hud.deaths = e.deaths;
      hud.tickedAt = now;
      deathCard = { run: e.run, progress: e.progress, cause: CAUSE_NAMES[e.cause] ?? e.cause, nearRecord: e.nearRecord };
      announceEl.textContent = `Run ${e.run} made it ${Math.round(e.progress * 100)}% of the way. Deaths: ${e.deaths}.`;
      break;
    case 'record':
      hud.record = { progress: e.progress, run: e.run };
      break;
    case 'reset':
      deathCard = null;
      pos = null; // snap to the start instead of sliding there
      break;
    case 'zone':
      announceEl.textContent = `Zone ${e.index + 1}: ${e.name}`;
      break;
  }
}

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const net = connect(`${proto}://${location.host}/ws`, onEvent);
const input = new InputState((bits) => net.sendInput(bits));

// Keyboard
addEventListener('keydown', (e) => { if (isGameKey(e.code)) { e.preventDefault(); input.key(e.code, true); } });
addEventListener('keyup', (e) => { if (isGameKey(e.code)) { e.preventDefault(); input.key(e.code, false); } });
// Never leave a button "held" when the player switches away (review focus 1).
addEventListener('blur', () => input.releaseAll());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.releaseAll();
  else { pos = null; cam = null; } // snap to the latest frame on return
});
mountTouchControls(document.body, input);

const view = createCanvasView(document.getElementById('game') as HTMLCanvasElement);
let pos: { x: number; y: number } | null = null;
let cam: { x: number; y: number } | null = null;
let lastT = performance.now() / 1000;
const dots: SceneDot[] = [];

function sceneDots(d: Uint8Array, j: Uint8Array): SceneDot[] {
  dots.length = 0;
  for (let i = 0; i < d.length; i++) {
    const code = d[i]!;
    const jump = j[i] === 1;
    // Slots that are empty this frame have no player at all; skip them.
    if (code === 0 && !jump && !occupied(i)) continue;
    dots.push({ slot: i, dir: code === 1 ? -1 : code === 2 ? 1 : 0, jump });
  }
  return dots;
}
// A slot counts as occupied once we've seen anyone in it; idle players keep floating.
const seen = new Uint8Array(128);
const occupied = (i: number) => seen[i] === 1;

function frame(): void {
  const t = performance.now() / 1000;
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  const f = net.state.latest;
  const L = view.layout;

  let blob: Scene['blob'];
  let online = net.state.welcome && net.state.welcome.t === 'welcome' ? net.state.welcome.online : 0;
  if (f) {
    const ahead = (performance.now() - net.state.latestAt) / 1000 + net.state.rttMs / 2000;
    const body = predict(f, level, ahead);
    pos = pos ? smooth(pos, body, dt) : { x: body.x, y: body.y };
    blob = { x: pos.x, y: pos.y, vx: body.vx, vy: body.vy, grounded: body.grounded, facing: body.facing, pull: f.pull, strain: f.strain, dead: f.phase === 'dying' };
    online = f.online;
    for (let i = 0; i < f.dots.length; i++) if (f.dots[i] !== 0 || f.dotJump[i]) seen[i] = 1;
  } else {
    pos = pos ?? { x: level.spawn.x, y: level.spawn.y };
    blob = { x: pos.x, y: pos.y, vx: 0, vy: 0, grounded: true, facing: 1, pull: 0, strain: 0, dead: false };
  }

  const bits = input.bits;
  const scene: Scene = {
    level: sceneLevel,
    blob,
    dots: f ? sceneDots(f.dots, f.dotJump) : [],
    you: { dir: (bits & 1) && !(bits & 2) ? -1 : (bits & 2) && !(bits & 1) ? 1 : 0, jump: (bits & 4) !== 0 },
    hud: {
      deaths: hud.deaths,
      deathsJustTicked: t - hud.tickedAt < TICK_FLASH_S,
      online,
      record: hud.record,
      progress: progressOf(level, blob.x),
      recordLabel: hud.record ? `run ${hud.record.run.toLocaleString('en-US')}` : '',
    },
    deathCard,
    zoneSky: zoneAt(level, blob.x).sky,
    paused: f?.phase === 'paused',
  };

  cam = camera(L, pos, cam, dt);
  renderFrame(view.ctx, L, cam, scene, t);

  const msg = !net.state.connected ? 'Reconnecting to the blob…' : '';
  if (statusEl.textContent !== msg) { statusEl.textContent = msg; statusEl.classList.toggle('show', !!msg); }
  requestAnimationFrame(frame);
}

loadFonts().then(() => requestAnimationFrame(frame));
