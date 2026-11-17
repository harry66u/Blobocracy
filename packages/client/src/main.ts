// The game page: connects to the shared world, sends this player's input, and draws
// the server's blob with a little prediction so it feels responsive. The big moments
// (death, new zone, passing the record, the win and the level-up) are choreographed by
// the Director and the CameraRig; sound comes from the synthesized GameAudio module.
import { createGameAudio } from './audio/index.ts';
import './fonts.css';
import { progressOf, zoneAt, type ServerEvent } from '@blobocracy/shared';
import { CameraRig } from './camera.ts';
import { Director } from './director.ts';
import { connect } from './net.ts';
import { keepDeathCard } from './hudstate.ts';
import { releaseWhenHidden, suspendWhenHidden } from './lifecycle.ts';
import { InputState, isGameKey } from './input.ts';
import { causeName, DEATH_SHAKE, levelUpFrame, swoopDuration } from './moments.ts';
import { hudLevelLabel, levelView, type LevelView } from './levels.ts';
import { LevelUpView } from './render/levelup.ts';
import { predict, smooth } from './predict.ts';
import { mountTouchControls } from './render/touch.ts';
import { deathCardShareSlot, renderFrame, resetRenderer, type Scene, type SceneDot } from './render/scene.ts';
import { winCardShareSlot } from './render/frame.ts';
import { ClipBook, mountShareButton, withClip } from './share.ts';
import { composeScene, sceneBlob, sceneDots } from './scenemap.ts';
import { loadMuted, loadReducedMotion, mountHudControls, saveMuted, saveReducedMotion } from './settings.ts';
import { createCanvasView, loadFonts } from './view.ts';

// The level being played: one SceneLevel per level for the whole session (the renderer caches
// level chunks per object), swapped when the world moves on after a win.
let lv: LevelView = levelView(1)!;
let level = lv.level;
let encore = false;

const statusEl = document.getElementById('status')!;
const announceEl = document.getElementById('announce')!;
const loadingEl = document.getElementById('loading');
const loadingDeathsEl = document.getElementById('loading-deaths');

let reduced = loadReducedMotion();
let muted = loadMuted();
const audio = createGameAudio();
audio.setMuted(muted);

const announce = (text: string) => { announceEl.textContent = text; };
const director = new Director(() => reduced, {
  announce,
  recordPassed: () => {
    audio.cheer('record');
  },
});
const rig = new CameraRig();
const clips = new ClipBook();
const levelUp = new LevelUpView();

/** Switch to the level with this id (a welcome or a level event). Returns whether it changed. */
function useLevel(id: number, isEncore: boolean): boolean {
  const v = levelView(id);
  encore = isEncore;
  if (!v || v === lv) return false;
  lv = v;
  level = v.level;
  pos = null;
  rig.snap();
  resetRenderer();
  return true;
}

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
      if (useLevel(e.levelId, e.encore ?? false) && !levelUp.ready) audio.setZone(0);
      director.welcome(e);
      deathCause = null;
      cardRun = null;
      if (loadingDeathsEl) loadingDeathsEl.textContent = `${e.deaths.toLocaleString('en-US')} deaths so far`;
      audio.setZone(e.zone);
      break;
    case 'win':
      director.onWin(e, now);
      deathCause = null;
      cardRun = null;
      audio.win();
      break;
    case 'level': {
      // the beaten level shrinks away as a snapshot; the new one slides in
      const old = lv;
      levelUp.capture(view.ctx.canvas, encore ? `Encore: ${old.name}` : `Level ${old.level.id}: ${old.name}`);
      useLevel(e.levelId, e.encore);
      director.onLevel(e, now);
      audio.levelUp();
      break;
    }
    case 'death':
      director.onDeath(e, now);
      deathCause = e.cause;
      cardRun = e.run;
      if (!reduced) rig.kick(DEATH_SHAKE.amp, DEATH_SHAKE.dur);
      announce(`${e.nearRecord ? 'So close. ' : ''}Run ${e.run.toLocaleString('en-US')} made it ${Math.round(e.progress * 100)}% of the way, then the ${causeName(e.cause)} got it. Deaths: ${e.deaths.toLocaleString('en-US')}.`);
      audio.death(); // one heavy hit, then the music stops
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
      audio.resetToStart(); // the music fades back in
      break;
    }
    case 'clip':
      clips.add(e);
      break;
    case 'zone':
      director.onZone(e.index, e.name, now);
      audio.setZone(e.index);
      audio.cheer('zone');
      break;
  }
}

const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const net = connect(`${proto}://${location.host}/ws`, onEvent);
const input = new InputState((bits) => net.sendInput(bits));

let onLayout = () => {};
const view = createCanvasView(document.getElementById('game') as HTMLCanvasElement, () => onLayout());
const controls = mountHudControls(document.body, {
  layout: () => view.layout,
  muted: () => muted,
  setMuted: (m) => {
    muted = m;
    saveMuted(m);
    audio.setMuted(m);
  },
  reduced: () => reduced,
  setReduced: (on) => { reduced = on; saveReducedMotion(on); },
});
onLayout = () => controls.place();

// Keyboard (not while the settings panel is open or a HUD button has focus)
const wantsKeys = (e: KeyboardEvent) => !controls.isOpen() && !(e.target instanceof HTMLElement && e.target.closest('.bl-hudbtn, .bl-modal'));
addEventListener('keydown', (e) => {
  audio.unlock(); // browsers need a key press or tap first
  net.resume(); // dropped as idle: any key rejoins
  if (isGameKey(e.code) && wantsKeys(e)) { e.preventDefault(); input.key(e.code, true); }
});
addEventListener('keyup', (e) => { if (isGameKey(e.code)) { if (wantsKeys(e)) e.preventDefault(); input.key(e.code, false); } });
addEventListener('pointerdown', () => {
  audio.unlock();
  net.resume(); // dropped as idle: any tap rejoins
}, { capture: true });
// Never leave a button "held" when the player switches away (review focus 1).
releaseWhenHidden(window, document, () => input.releaseAll());
// A tab left in the background stops receiving frames after a minute and rejoins when shown (I1).
suspendWhenHidden(document, net);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { pos = null; rig.snap(); } // snap to the latest frame on return
});
mountTouchControls(document.body, input);
const share = mountShareButton(document.body);
const winShare = mountShareButton(document.body);

let pos: { x: number; y: number } | null = null;
let lastT = performance.now() / 1000;
const dots: SceneDot[] = [];

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
    const prevX = pos?.x;
    pos = pos ? smooth(pos, body, dt) : { x: body.x, y: body.y };
    // a jump across the level that isn't the swoop back to the start (e.g. the admin debug win): cut, don't crawl
    if (prevX !== undefined && Math.abs(pos.x - prevX) > 24 && rig.swoopK === null) { rig.snap(); resetRenderer(); }
    const dead = f.phase === 'dying';
    blob = sceneBlob(pos, body, f, deathCause);
    online = f.online;
    // World sounds: saws buzz when close, presses slam, crumbles crack, the crowd hums.
    lv.sounds.world(f, pos, runTime, audio);
    if (!keepDeathCard(cardRun === null ? null : { run: cardRun }, f)) { cardRun = null; deathCause = dead ? deathCause : null; }
    lv.sounds.body(f, body, audio);
  } else {
    pos = pos ?? { x: level.spawn.x, y: level.spawn.y };
    blob = { x: pos.x, y: pos.y, vx: 0, vy: 0, grounded: true, facing: 1, pull: 0, strain: 0, dead: false };
  }

  const running = f?.phase === 'running';
  const progress = progressOf(level, blob.x);
  const d = director.frame(t, f?.run ?? 0, progress, running);

  // camera: follow with look-ahead, or swoop back to the start after a death; framed for the party while celebrating
  rig.celebrate(f?.phase === 'celebrating', L.phone);
  let cam = rig.update(L, blob, dt, reduced);
  const swoopK = rig.swoopK;
  const shake = rig.shakeOffset();
  cam = { x: cam.x + shake.x, y: cam.y + shake.y };
  // during the swoop the progress marker slides back and the sky rewinds with the camera
  const viewCenterX = cam.x + (L.lookAhead);

  const bits = input.bits;
  const scene: Scene = composeScene({
    level, sceneLevel: lv.sceneLevel, frame: f, blob, runTime, online, muted, reduced, progress,
    levelLabel: hudLevelLabel(level.id, encore), encore, levelName: lv.name, nextLevel: encore ? null : lv.next,
    winClip: d.win ? clips.forRun(d.win.run) !== null : false,
    dots: f ? sceneDots(f.dots, f.dotJump, dots) : [],
    you: { dir: (bits & 1) && !(bits & 2) ? -1 : (bits & 2) && !(bits & 1) ? 1 : 0, jump: (bits & 4) !== 0 },
    director: d,
    showCard: cardRun !== null,
    swoopK, swoopFade: rig.swoopFade, viewCenterX, swoopFromProgress,
  });
  scene.deathCard = withClip(scene.deathCard, clips);

  // While the death card is up inputs don't count; fade the touch buttons so a pit death stays visible.
  // (the celebration ignores inputs too)
  document.body.classList.toggle('bl-dying', blob.dead || f?.phase === 'celebrating' || (d.levelUp !== null && d.levelUp.age < 3));

  if (d.levelUp && levelUp.ready) {
    const lf = levelUpFrame(d.levelUp.age, reduced);
    levelUp.draw(view.ctx, L, lf, d.levelUp, zoneAt(level, level.spawn.x).sky, reduced, t, (g) => renderFrame(g, L, cam, scene, t));
    if (lf.done) levelUp.end();
  } else {
    if (levelUp.ready) levelUp.end();
    renderFrame(view.ctx, L, cam, scene, t);
  }
  share.place(deathCardShareSlot(), cardRun !== null ? clips.forRun(cardRun) : null);
  winShare.place(d.win ? winCardShareSlot() : null, d.win ? clips.forRun(d.win.run) : null);
  audio.tick();

  const msg = net.state.idle ? 'You were away for a while. Press any key or tap to jump back in.'
    : net.state.packed ? 'Blobocracy is packed right now. You will rejoin as soon as there is room.'
    : !net.state.connected && loadingGone ? 'Reconnecting to the blob…' : '';
  if (statusEl.textContent !== msg) { statusEl.textContent = msg; statusEl.classList.toggle('show', !!msg); }
  requestAnimationFrame(frame);
}

loadFonts().then(() => requestAnimationFrame(frame));
