// The game page: connects to the shared world, sends this player's input, and draws
// the server's blob with a little prediction so it feels responsive.
import './fonts.css';
import { DOT_EMPTY, DOT_LEFT, DOT_RIGHT, LEVEL1, progressOf, tileAt, zoneAt, type ServerEvent } from '@blobocracy/shared';
import { connect } from './net.ts';
import { keepDeathCard } from './hudstate.ts';
import { releaseWhenHidden } from './lifecycle.ts';
import { InputState, isGameKey } from './input.ts';
import { camera } from './layout.ts';
import { predict, smooth } from './predict.ts';
import { mountTouchControls } from './render/touch.ts';
import { renderFrame, type Scene, type SceneDot, type SceneLevel } from './render/scene.ts';
import { createCanvasView, loadFonts } from './view.ts';
import { startAnalytics } from './analytics.ts';
import { StatsStore, dayKey, noteDeath, notePlayed } from './stats.ts';
import { FrameRecorder } from './share/replay.ts';
import { ShareUI } from './share/ui.ts';
import { causeName } from './share/words.ts';
import { liveRenderer } from './render/scene.ts';

const level = LEVEL1;
// One SceneLevel object for the whole session: the renderer caches level chunks per object.
const sceneLevel: SceneLevel = {
  width: level.width,
  height: level.height,
  tileAt: (tx, ty) => tileAt(level, tx, ty),
  zones: level.zones,
};

const TICK_FLASH_S = 1.2;
/** Absolute site address for shared links (set SITE_URL at build time; see vite.config.ts). */
const SITE_URL: string = import.meta.env.VITE_SITE_URL || location.origin;

const analytics = startAnalytics();
const store = new StatsStore((() => { try { return localStorage; } catch { return null; } })());
const recorder = new FrameRecorder();
/** The run this browser last pressed something in: deaths of that run count as yours. */
let pressedRun = -1;

const hud = { deaths: 0, record: null as { progress: number; run: number } | null, tickedAt: -Infinity };
let deathCard: Scene['deathCard'] = null;
const statusEl = document.getElementById('status')!;
const announceEl = document.getElementById('announce')!;

const packedEl = document.getElementById('packed')!;
let packedTimer: ReturnType<typeof setInterval> | undefined;
function showPacked(deaths: number, online: number): void {
  packedEl.querySelector('[data-deaths]')!.textContent = deaths.toLocaleString('en-US');
  packedEl.querySelector('[data-online]')!.textContent = online.toLocaleString('en-US');
  if (!packedEl.hidden) return;
  packedEl.hidden = false;
  // keep the counter live from the cached status endpoint while waiting
  packedTimer = setInterval(() => {
    fetch('/api/status').then((r) => r.json()).then((s: { deaths: number; online: number }) => showPacked(s.deaths, s.online)).catch(() => {});
  }, 10_000);
}
function hidePacked(): void {
  packedEl.hidden = true;
  clearInterval(packedTimer);
}

function onEvent(e: ServerEvent): void {
  const now = performance.now() / 1000;
  switch (e.t) {
    case 'packed':
      hud.deaths = e.deaths; // the HUD behind the packed card agrees with it
      showPacked(e.deaths, e.online);
      break;
    case 'welcome':
      hidePacked();
      deathCard = null; // a fresh connection starts clean; the next death brings a new card
      hud.deaths = e.deaths;
      hud.record = e.record;
      break;
    case 'death': {
      const wasPart = pressedRun === e.run;
      if (wasPart) store.update((s) => noteDeath(s, e));
      const recordAfter = !hud.record || e.progress > hud.record.progress ? { progress: e.progress, run: e.run } : hud.record;
      deathCard = { run: e.run, progress: e.progress, cause: causeName(e.cause), nearRecord: e.nearRecord };
      share.onDeath(e, store.stats, wasPart, { deathsBefore: hud.deaths, recordBefore: hud.record, recordAfter, card: deathCard });
      hud.deaths = e.deaths;
      hud.tickedAt = now;
      announceEl.textContent = `Run ${e.run} made it ${Math.floor(e.progress * 100)}% of the way. Deaths: ${e.deaths}. Share button available.`;
      break;
    }
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
const net = connect(`${proto}://${location.host}/ws`, onEvent, (f) => {
  recorder.push(f);
  // Holding a key across a reset makes you part of the new run too.
  if (input.bits && f.phase === 'running') pressedRun = f.run;
});
const input = new InputState((bits) => {
  net.sendInput(bits);
  if (bits) {
    pressedRun = net.state.latest?.run ?? (net.state.welcome?.t === 'welcome' ? net.state.welcome.run : -1);
    store.update((s) => notePlayed(s, dayKey(new Date())));
    analytics.played();
  }
});
const share = new ShareUI({
  level, sceneLevel, recorder, siteUrl: SITE_URL,
  onShare: (kind, how) => analytics.share(kind, how),
  onOpen: () => input.releaseAll(),
});

// Keyboard (keys pressed on the share button or panel belong to them, not the blob)
addEventListener('keydown', (e) => {
  if (share.isOpen) return; // the panel's buttons own the keyboard while it is open
  if (isGameKey(e.code)) { e.preventDefault(); input.key(e.code, true); }
});
addEventListener('keyup', (e) => {
  if (!isGameKey(e.code)) return;
  if (!share.owns(e.target)) e.preventDefault(); // let Space activate share buttons
  input.key(e.code, false); // always release, so no key ever sticks
});
// Never leave a button "held" when the player switches away (review focus 1).
releaseWhenHidden(window, document, () => input.releaseAll());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { pos = null; cam = null; } // snap to the latest frame on return
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
    if (code === DOT_EMPTY) continue; // nobody in this slot
    dots.push({ slot: i, dir: code === DOT_LEFT ? -1 : code === DOT_RIGHT ? 1 : 0, jump: j[i] === 1 });
  }
  return dots;
}

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
    if (!keepDeathCard(deathCard, f)) deathCard = null;
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

  // While the death card is up inputs don't count; fade the touch buttons so a pit death stays visible.
  document.body.classList.toggle('bl-dying', blob.dead);

  cam = camera(L, pos, cam, dt);
  renderFrame(view.ctx, L, cam, scene, t);
  share.update(liveRenderer().deathCardBottom);

  const msg = !net.state.connected && packedEl.hidden ? 'Reconnecting to the blob…' : '';
  if (statusEl.textContent !== msg) { statusEl.textContent = msg; statusEl.classList.toggle('show', !!msg); }
  requestAnimationFrame(frame);
}

loadFonts().then(() => requestAnimationFrame(frame));
