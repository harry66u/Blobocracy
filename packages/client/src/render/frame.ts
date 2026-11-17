// Draws one frame from a Scene. Holds the renderer's persistent animation state
// (sky cross-fade, level chunk cache, crowd easing, blob squash, counter flip).
import { entityState } from '@blobocracy/shared';
import type { Layout } from '../layout.ts';
import { Background } from './background.ts';
import { BlobView, HALF_H } from './blob.ts';
import { CrowdView } from './crowd.ts';
import { DynamicTiles } from './dyntiles.ts';
import { chompCameraShift, drawChomp, drawEntitiesBack, drawEntitiesFront, solidOf, type EntityDrawCtx } from './entities.ts';
import { Confetti, drawBanner, drawOverlays, drawRecordFlag } from './fx.ts';
import { HudView, uiScale } from './hud.ts';
import { LevelLayer } from './level.ts';
import type { Scene } from './scene.ts';

let bg = new Background();
let levelLayer = new LevelLayer();
let crowd = new CrowdView();
let blobView = new BlobView();
let hudView = new HudView();
let dynTiles = new DynamicTiles();
let confetti = new Confetti();
let lastT = -1;
/** The world's animation clock: stands still during the hit-stop. */
let worldT = -1;
let lastBannerId = 0;
let hadRecordPop = false;

/** Where the death card wants its "Share the clip" button right now (CSS px), or null. */
export function deathCardShareSlot() {
  return hudView.shareSlot;
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
  worldT = worldT < 0 ? timeS : frozen ? worldT : worldT + dt;
  const wt = worldT;
  const wdt = frozen ? 0 : dt;
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
  levelLayer.draw(ctx, L, scene.level, camPxX, camPxY);
  const sx = (x: number) => (x - camX) * T;
  const sy = (y: number) => (y - camY) * T;
  // the record this run is chasing stands in the world as a flag (it moves only after a death)
  if (fx?.recordFlag) drawRecordFlag(ctx, T, sx, sy, scene.level, fx.recordFlag.x, fx.recordFlag.label, wt, L.w);

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
  crowd.draw(ctx, T, L.phone, bx, by, L.h);
  blobView.draw(ctx, T, bx, feetY, b, scene.paused, wt);
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
}

