// The game page: connects to the shared world, sends this player's input, and draws
// the server's blob with a little prediction so it feels responsive. The big moments
// (death, new zone, passing the record) are choreographed by the Director and the
// CameraRig; sound hooks are marked `// audio:` for the GameAudio module.
import './fonts.css';
import { DOT_EMPTY, DOT_LEFT, DOT_RIGHT, LEVEL1, progressOf, tileAt, zoneAt, type ServerEvent } from '@blobocracy/shared';
import { CameraRig } from './camera.ts';
import { Director } from './director.ts';
import { connect } from './net.ts';
import { keepDeathCard } from './hudstate.ts';
import { releaseWhenHidden } from './lifecycle.ts';
import { InputState, isGameKey } from './input.ts';
import { causeName, DEATH_SHAKE, swoopDuration } from './moments.ts';
import { predict, smooth } from './predict.ts';
import { mountTouchControls } from './render/touch.ts';
import { renderFrame, type Scene, type SceneDot, type SceneLevel } from './render/scene.ts';
import { loadMuted, loadReducedMotion, mountHudControls, saveMuted, saveReducedMotion } from './settings.ts';
import { createCanvasView, loadFonts } from './view.ts';

const level = LEVEL1;
// One SceneLevel object for the whole session: the renderer caches level chunks per object.
const sceneLevel: SceneLevel = {
  width: level.width,
  height: level.height,
  tileAt: (tx, ty) => tileAt(level, tx, ty),
  zones: level.zones,
  entities: level.entities,
};
const progressX = (p: number) => level.spawn.x + p * (level.goalX - level.spawn.x);

const statusEl = document.getElementById('status')!;
const announceEl = document.getElementById('announce')!;
const loadingEl = document.getElementById('loading');
const loadingDeathsEl = document.getElementById('loading-deaths');

let reduced = loadReducedMotion();
let muted = loadMuted();
// audio: audio.setMuted(muted)

const announce = (text: string) => { announceEl.textContent = text; };
const director = new Director(() => reduced, {
  announce,
  recordPassed: () => {
    // audio: audio.cheer()
  },
});
const rig = new CameraRig();

/** The death being shown: the cause picks the blob's pose; null when not dying. */
let deathCause: string | null = null;
/** Run of the death card, so a missed reset still clears it (keepDeathCard). */
let cardRun: number | null = null;
/** Progress the marker slides back from during the swoop. */
let swoopFromProgress = 0;

function onEvent(e: ServerEvent): void {
  const now = performance.now() / 1000;
  switch (e.t) {
    case 'welcome':
      director.welcome(e);
      deathCause = null;
      cardRun = null;
      if (loadingDeathsEl) loadingDeathsEl.textContent = `${e.deaths.toLocaleString('en-US')} deaths so far`;
      // audio: audio.setZone(e.zone)
      break;
    case 'death':
      director.onDeath(e, now);
      deathCause = e.cause;
      cardRun = e.run;
      if (!reduced) rig.kick(DEATH_SHAKE.amp, DEATH_SHAKE.dur);
      announce(`${e.nearRecord ? 'So close. ' : ''}Run ${e.run.toLocaleString('en-US')} made it ${Math.round(e.progress * 100)}% of the way, then the ${causeName(e.cause)} got it. Deaths: ${e.deaths.toLocaleString('en-US')}.`);
      // audio: audio.death(e.cause)   (one heavy hit, then the music stops)
      break;
    case 'record':
      director.onRecord(e);
      break;
    case 'reset': {
      swoopFromProgress = pos ? progressOf(level, pos.x) : 0;
      director.onReset(e.run, now);
      deathCause = null;
      cardRun = null;
      // fly the camera back to the start instead of cutting
      const from = pos ? pos.x : level.spawn.x;
      pos = null; // the blob itself snaps to the start
      rig.swoop(swoopDuration(from - level.spawn.x, reduced), reduced);
      // audio: audio.resetToStart()   (the music fades back in)
      break;
    }
    case 'zone':
      director.onZone(e.index, e.name, now);
      // audio: audio.setZone(e.index); audio.cheer()
      break;
  }
}

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const net = connect(`${proto}://${location.host}/ws`, onEvent);
const input = new InputState((bits) => net.sendInput(bits));

const view = createCanvasView(document.getElementById('game') as HTMLCanvasElement, () => controls.place());
const controls = mountHudControls(document.body, {
  layout: () => view.layout,
  muted: () => muted,
  setMuted: (m) => {
    muted = m;
    saveMuted(m);
    // audio: audio.setMuted(m)
  },
  reduced: () => reduced,
  setReduced: (on) => { reduced = on; saveReducedMotion(on); },
});

// Keyboard (not while the settings panel is open or a HUD button has focus)
const wantsKeys = (e: KeyboardEvent) => !controls.isOpen() && !(e.target instanceof HTMLElement && e.target.closest('.bl-hudbtn, .bl-modal'));
addEventListener('keydown', (e) => {
  // audio: audio.unlock()   (browsers need a key press or tap first)
  if (isGameKey(e.code) && wantsKeys(e)) { e.preventDefault(); input.key(e.code, true); }
});
addEventListener('keyup', (e) => { if (isGameKey(e.code)) { if (wantsKeys(e)) e.preventDefault(); input.key(e.code, false); } });
addEventListener('pointerdown', () => {
  // audio: audio.unlock()
}, { capture: true });
// Never leave a button "held" when the player switches away (review focus 1).
releaseWhenHidden(window, document, () => input.releaseAll());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { pos = null; rig.snap(); } // snap to the latest frame on return
});
mountTouchControls(document.body, input);

let pos: { x: number; y: number } | null = null;
let lastT = performance.now() / 1000;
let prevGrounded = true;
let prevVy = 0;
const dots: SceneDot[] = [];

function sceneDots(d: Uint8Array, j: Uint8Array): SceneDot[] {
  dots.length = 0;
  for (let i = 0; i < d.length; i++) {
    const code = d[i]!;
    if (code === DOT_EMPTY) continue; // nobody in this slot
    dots.push({ slot: i, dir: code === DOT_LEFT ? -1 : code === DOT_RIGHT ? 1 : 0, jump: j[i] === 1 });
  }
  return dots;
}

let loadingGone = false;
function hideLoading(): void {
  if (loadingGone || !loadingEl) return;
  loadingGone = true;
  loadingEl.classList.add('gone');
  setTimeout(() => loadingEl.remove(), 700);
}

function frame(): void {
  const t = performance.now() / 1000;
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  const f = net.state.latest;
  const L = view.layout;
  if (f) hideLoading();

  let blob: Scene['blob'];
  let runTime = 0;
  let online = net.state.welcome && net.state.welcome.t === 'welcome' ? net.state.welcome.online : 0;
  if (f) {
    const ahead = (performance.now() - net.state.latestAt) / 1000 + net.state.rttMs / 2000;
    const body = predict(f, level, ahead);
    // Hazards keep moving between frames while the run is running.
    runTime = f.phase === 'running' ? f.runTime + Math.max(0, ahead) : f.runTime;
    pos = pos ? smooth(pos, body, dt) : { x: body.x, y: body.y };
    const dead = f.phase === 'dying';
    blob = { x: pos.x, y: pos.y, vx: body.vx, vy: body.vy, grounded: body.grounded, facing: body.facing, pull: f.pull, strain: f.strain, dead, deathCause: dead ? deathCause : null };
    online = f.online;
    if (!keepDeathCard(cardRun === null ? null : { run: cardRun }, f)) { cardRun = null; deathCause = dead ? deathCause : null; }
    if (!dead) {
      if (!prevGrounded && body.grounded && prevVy > 6) {
        // audio: audio.land(Math.min(1, prevVy / 22))
      }
      if (prevGrounded && !body.grounded && body.vy < -2) {
        // audio: audio.jump()
      }
    }
    prevGrounded = body.grounded;
    prevVy = body.vy;
  } else {
    pos = pos ?? { x: level.spawn.x, y: level.spawn.y };
    blob = { x: pos.x, y: pos.y, vx: 0, vy: 0, grounded: true, facing: 1, pull: 0, strain: 0, dead: false };
  }

  const running = f?.phase === 'running';
  const progress = progressOf(level, blob.x);
  const d = director.frame(t, f?.run ?? 0, progress, running);

  // camera: follow with look-ahead, or swoop back to the start after a death
  let cam = rig.update(L, blob, dt, reduced);
  const swoopK = rig.swoopK;
  const shake = rig.shakeOffset();
  cam = { x: cam.x + shake.x, y: cam.y + shake.y };
  // during the swoop the progress marker slides back and the sky rewinds with the camera
  const viewCenterX = cam.x + (L.lookAhead);
  const shownProgress = swoopK === null ? progress : swoopFromProgress + (progress - swoopFromProgress) * swoopK;
  const skyX = swoopK === null ? blob.x : viewCenterX;

  const bits = input.bits;
  const scene: Scene = {
    level: sceneLevel,
    blob,
    dots: f ? sceneDots(f.dots, f.dotJump) : [],
    you: { dir: (bits & 1) && !(bits & 2) ? -1 : (bits & 2) && !(bits & 1) ? 1 : 0, jump: (bits & 4) !== 0 },
    hud: {
      deaths: d.deaths,
      deathsJustTicked: d.deathsJustTicked,
      online,
      record: d.record,
      progress: shownProgress,
      recordLabel: d.recordLabel,
      recordPop: d.recordPop,
      muted,
    },
    deathCard: cardRun === null ? null : d.card,
    zoneSky: zoneAt(level, skyX).sky,
    paused: f?.phase === 'paused',
    runTime,
    chompStart: f?.chompStart ?? null,
    crumbles: f ? f.crumbles.map((c) => ({ tx: c.tile % level.width, ty: Math.floor(c.tile / level.width), at: c.at })) : [],
    fx: {
      reduced,
      freeze: d.freeze,
      flash: d.flash,
      vignette: d.vignette,
      fade: rig.swoopFade,
      banner: d.banner,
      recordFlag: d.flagProgress === null ? null : { x: progressX(d.flagProgress), label: `${Math.round(d.flagProgress * 100)}%` },
      skyRate: swoopK !== null ? (reduced ? 50 : 3.5) : reduced ? 0.6 : 1,
    },
  };

  // While the death card is up inputs don't count; fade the touch buttons so a pit death stays visible.
  document.body.classList.toggle('bl-dying', blob.dead);

  renderFrame(view.ctx, L, cam, scene, t);

  const msg = !net.state.connected && loadingGone ? 'Reconnecting to the blob…' : '';
  if (statusEl.textContent !== msg) { statusEl.textContent = msg; statusEl.classList.toggle('show', !!msg); }
  requestAnimationFrame(frame);
}

loadFonts().then(() => requestAnimationFrame(frame));
