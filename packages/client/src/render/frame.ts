// Draws one frame from a Scene. Holds the renderer's persistent animation state
// (sky cross-fade, level chunk cache, crowd easing, blob squash, counter flip).
import { entityState } from '@blobocracy/shared';
import type { Layout } from '../layout.ts';
import { Background } from './background.ts';
import { BlobView, HALF_H } from './blob.ts';
import { CrowdView } from './crowd.ts';
import { DynamicTiles } from './dyntiles.ts';
import { chompCameraShift, drawChomp, drawEntitiesBack, drawEntitiesFront, solidOf, type EntityDrawCtx } from './entities.ts';
import { CELEBRATE_S } from '@blobocracy/shared';
import { winFx } from '../moments.ts';
import { Confetti, drawBanner, drawOverlays, drawRecordFlag } from './fx.ts';
import { HudView, uiScale } from './hud.ts';
import { LevelLayer } from './level.ts';
import { BLOB, HAZARD, ONLINE, SWEAT } from './palette.ts';
import type { Scene, ShareSlot } from './scene.ts';
import { drawFlyingCrown, drawGoalCrown, drawRays, drawWinCard, drawWinFlash, Fireworks, GOLD, goalCrownSpot, goalFloorRow } from './win.ts';

const WIN_CONFETTI = ['#FFFFFF', BLOB, HAZARD, GOLD, SWEAT, ONLINE];
/** Confetti blasts during the celebration: [age, kind]. */
const WIN_BLASTS: readonly [number, 'top' | 'cannons'][] = [[0.8, 'cannons'], [1.0, 'top'], [5.5, 'cannons'], [10, 'top'], [14.5, 'cannons'], [19, 'top']];

let bg = new Background();
let levelLayer = new LevelLayer();
let crowd = new CrowdView();
let blobView = new BlobView();
let hudView = new HudView();
let dynTiles = new DynamicTiles();
let confetti = new Confetti();
let winConfetti = new Confetti(520, WIN_CONFETTI);
let fireworks = new Fireworks();
let lastWinAge = -1;
let winSlot: ShareSlot | null = null;
let lastT = -1;
/** The world's animation clock: stands still during the hit-stop. */
let worldT = -1;
let lastBannerId = 0;
let hadRecordPop = false;

/** Where the death card wants its "Share the clip" button right now (CSS px), or null. */
export function deathCardShareSlot() {
  return hudView.shareSlot;
}

/** Where the win card wants its "Share the clip" button right now (CSS px), or null. */
export function winCardShareSlot(): ShareSlot | null {
  return winSlot;
}

/** Forget all animation state and cached level chunks (e.g. after the level changes). */
export function resetRenderer(): void {
  bg = new Background();
  levelLayer = new LevelLayer();
  crowd = new CrowdView();
  blobView = new BlobView();
  hudView = new HudView();
  dynTiles = new DynamicTiles();
  confetti = new Confetti();
  winConfetti = new Confetti(520, WIN_CONFETTI);
  fireworks = new Fireworks();
  lastWinAge = -1;
  winSlot = null;
  lastT = -1;
  worldT = -1;
  lastBannerId = 0;
  hadRecordPop = false;
}

/**
 * Render a full frame. `cam` is the view's left/top edge in tiles (see layout.camera);
 * it is snapped to device pixels so static chunks and sprites move together.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, layout: Layout, cam: { x: number; y: number }, scene: Scene, timeS: number): void {
  const dt = lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, timeS - lastT));
  lastT = timeS;
  const fx = scene.fx;
  const reduced = fx?.reduced ?? false;
  const frozen = fx?.freeze ?? false;
  const slow = fx?.timeScale ?? 1;
  worldT = worldT < 0 ? timeS : frozen ? worldT : worldT + dt * slow;
  const wt = worldT;
  const wdt = frozen ? 0 : dt * slow;
  const win = scene.win ?? null;
  const wf = win ? winFx(win.age, reduced) : null;
  if (win && win.age < lastWinAge - 0.25) { fireworks.reset(); winConfetti.clear(); } // a clip went back
  const prevWinAge = win ? lastWinAge : -1;
  lastWinAge = win ? win.age : -1;
  const L = layout;
  const T = L.tile;
  const tilePx = T * L.dpr;
  // frame the Big Chomp when it is right behind the blob (narrow phone views mostly)
  for (const e of scene.level.entities) {
    if (e.kind !== 'chomp' || scene.chompStart === null) continue;
    const front = entityState(e, scene.runTime, scene.chompStart).x;
    const shift = chompCameraShift(L.w / T, scene.blob.x - cam.x, scene.blob.x - front);
    if (shift > 0) cam = { x: cam.x - shift, y: cam.y };
  }
  const camPxX = Math.round(cam.x * tilePx);
  const camPxY = Math.round(cam.y * tilePx);
  const camX = camPxX / tilePx, camY = camPxY / tilePx;
  const b = scene.blob;

  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;

  bg.update(scene.zoneSky, timeS, fx?.skyRate ?? 1);
  blobView.update(b, scene.level, { entities: scene.level.entities, runTime: scene.runTime, chompStart: scene.chompStart, crumbles: scene.crumbles }, wdt, wt);
  crowd.update(scene.dots, scene.you, b.dead, wdt, wt);
  hudView.update(scene.hud, scene.deathCard, timeS, reduced);

  bg.draw(ctx, L, camX, camY, wt);
  // fireworks fill the sky behind the world while the internet celebrates
  if (win && wf) fireworks.schedule(win.age, wf.fireworks, L);
  if (fireworks.active) {
    fireworks.update(dt, L);
    fireworks.draw(ctx, L);
  }
  levelLayer.draw(ctx, L, scene.level, camPxX, camPxY);
  const sx = (x: number) => (x - camX) * T;
  const sy = (y: number) => (y - camY) * T;
  // the record this run is chasing stands in the world as a flag (it moves only after a death)
  if (fx?.recordFlag && !win) drawRecordFlag(ctx, T, sx, sy, scene.level, fx.recordFlag.x, fx.recordFlag.label, wt, L.w);
  // the golden crown floats over the goal (until the winner wears it)
  drawGoalCrown(ctx, T, sx, sy, scene.level, wt, L.w, { taken: (b.crown ?? 0) > 0, glow: wf?.glow ?? 0 });

  // moving parts, in tile units
  const view = { x0: camX, y0: camY, x1: camX + L.w / T, y1: camY + L.h / T };
  const ents = scene.level.entities;
  const ed: EntityDrawCtx = { view, runTime: scene.runTime, chompStart: scene.chompStart, timeS: wt, night: bg.pal.stars, focus: b.dead ? null : { x: b.x, y: b.y } };
  ctx.setTransform(tilePx, 0, 0, tilePx, -camPxX, -camPxY);
  drawEntitiesBack(ctx, ents, ed);
  dynTiles.draw(ctx, scene.level, view, b, scene.runTime, scene.crumbles, wt);
  drawEntitiesFront(ctx, ents, ed);
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);

  const bx = sx(b.x), by = sy(b.y);
  let feetY = sy(b.y + HALF_H);
  // a pit death is drawn at the bottom of the view, waving, before it falls away
  if (b.dead && b.deathCause === 'pit') feetY = Math.min(feetY, L.h - T * (L.phone ? 3.6 : 1.4));
  blobView.drawBehind(ctx, T, sx, sy);
  // the winner glows: light rays behind the blob as the crown lands
  if (win && wf && win.age > 0.6 && win.age < 6) {
    const k = Math.min(1, (win.age - 0.6) / 0.4) * Math.min(1, (6 - win.age) / 1.5);
    drawRays(ctx, bx, feetY - T * 0.9, T * (reduced ? 2.6 : 3.4), wt, 0.75 * k, 16);
  }
  crowd.draw(ctx, T, L.phone, bx, by, L.h);
  blobView.draw(ctx, T, bx, feetY, b, scene.paused, wt);
  const crownK = b.crown ?? 0;
  if (crownK > 0 && crownK < 1) {
    const spot = goalCrownSpot(scene.level, wt);
    if (spot) drawFlyingCrown(ctx, T, { x: sx(spot.x), y: sy(spot.base) }, { x: bx, y: feetY - T * 1.5 }, crownK);
  }
  if (scene.you) crowd.drawOwn(ctx, T, L.phone, bx, by, L.w, L.h);

  // the Big Chomp eats everything, so it goes over the blob and the crowd
  for (const e of ents) {
    if (e.kind !== 'chomp') continue;
    ctx.setTransform(tilePx, 0, 0, tilePx, -camPxX, -camPxY);
    drawChomp(ctx, e, ed, { depth: Infinity, solid: solidOf(scene.level.tileAt) });
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  }
  if (b.dead && b.deathCause === 'chomp') blobView.drawGulp(ctx, T, bx, feetY, wt);

  if (fx) drawOverlays(ctx, L, fx);
  if (wf) drawWinFlash(ctx, L, wf.flash, bx, feetY - T);
  hudView.draw(ctx, L, scene.hud, bg.pal, timeS);

  // new zone: banner + confetti from the top edge
  const s = uiScale(L);
  const banner = fx?.banner ?? null;
  if (banner && banner.id !== lastBannerId) {
    lastBannerId = banner.id;
    confetti.burstTop(L, reduced, banner.id);
  }
  if (banner) drawBanner(ctx, L, banner, reduced, sy(b.y - HALF_H) - T * 0.3);
  // passing the record: a pop of confetti from the record text
  const pop = scene.hud.recordPop;
  const popping = pop !== null && pop !== undefined && pop >= 0 && pop < 0.5;
  if (popping && !hadRecordPop) confetti.burstAt(L.w - (L.phone ? 60 : 90) * s, (L.phone ? 70 : 52) * s, s, reduced, Math.floor(timeS * 1000));
  hadRecordPop = popping;

  hudView.drawDeathCard(ctx, L, timeS);
  confetti.update(dt, L.h);
  confetti.draw(ctx, s);

  // the win: huge confetti from the top and from cannons in the bottom corners, then the card
  if (win) {
    for (const [at, kind] of WIN_BLASTS) {
      if (prevWinAge >= at || win.age < at || win.age > at + 1) continue;
      const seed = Math.round(at * 100) + win.run;
      if (kind === 'top') winConfetti.burstTop(L, reduced, seed, 1.9);
      else {
        winConfetti.burstCannon(-6, L.h + 6, -Math.PI / 2 + 0.55, s, reduced, seed, L.phone ? 60 : 110);
        winConfetti.burstCannon(L.w + 6, L.h + 6, -Math.PI / 2 - 0.55, s, reduced, seed + 1, L.phone ? 60 : 110);
      }
    }
  }
  if (winConfetti.active) {
    winConfetti.update(dt, L.h);
    winConfetti.draw(ctx, s);
  }
  // the card stays above the crowned blob hopping on the goal floor
  const avoidY = scene.level.goalX !== undefined ? sy(goalFloorRow(scene.level, scene.level.goalX)) - T * 3.1 : Infinity;
  winSlot = win ? drawWinCard(ctx, L, win, reduced, CELEBRATE_S, avoidY) : null;
}

