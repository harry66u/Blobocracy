// Draws one frame from a Scene. Holds the renderer's persistent animation state
// (sky cross-fade, level chunk cache, crowd easing, blob squash, counter flip).
import { entityState } from '@blobocracy/shared';
import type { Layout } from '../layout.ts';
import { Background } from './background.ts';
import { BlobView, HALF_H } from './blob.ts';
import { CrowdView } from './crowd.ts';
import { DynamicTiles } from './dyntiles.ts';
import { chompCameraShift, drawChomp, drawEntitiesBack, drawEntitiesFront, solidOf, type EntityDrawCtx } from './entities.ts';
import { HudView } from './hud.ts';
import { LevelLayer } from './level.ts';
import type { Scene } from './scene.ts';

let bg = new Background();
let levelLayer = new LevelLayer();
let crowd = new CrowdView();
let blobView = new BlobView();
let hudView = new HudView();
let dynTiles = new DynamicTiles();
let lastT = -1;

/** Forget all animation state and cached level chunks (e.g. after the level changes). */
export function resetRenderer(): void {
  bg = new Background();
  levelLayer = new LevelLayer();
  crowd = new CrowdView();
  blobView = new BlobView();
  hudView = new HudView();
  dynTiles = new DynamicTiles();
  lastT = -1;
}

/**
 * Render a full frame. `cam` is the view's left/top edge in tiles (see layout.camera);
 * it is snapped to device pixels so static chunks and sprites move together.
 */
export function renderFrame(ctx: CanvasRenderingContext2D, layout: Layout, cam: { x: number; y: number }, scene: Scene, timeS: number): void {
  const dt = lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, timeS - lastT));
  lastT = timeS;
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

  bg.update(scene.zoneSky, timeS);
  blobView.update(b, scene.level, { entities: scene.level.entities, runTime: scene.runTime, chompStart: scene.chompStart, crumbles: scene.crumbles }, dt, timeS);
  crowd.update(scene.dots, scene.you, b.dead, dt, timeS);
  hudView.update(scene.hud, scene.deathCard, timeS);

  bg.draw(ctx, L, camX, camY, timeS);
  levelLayer.draw(ctx, L, scene.level, camPxX, camPxY);

  // moving parts, in tile units
  const view = { x0: camX, y0: camY, x1: camX + L.w / T, y1: camY + L.h / T };
  const ents = scene.level.entities;
  const ed: EntityDrawCtx = { view, runTime: scene.runTime, chompStart: scene.chompStart, timeS, night: bg.pal.stars, focus: b.dead ? null : { x: b.x, y: b.y } };
  ctx.setTransform(tilePx, 0, 0, tilePx, -camPxX, -camPxY);
  drawEntitiesBack(ctx, ents, ed);
  dynTiles.draw(ctx, scene.level, view, b, scene.runTime, scene.crumbles, timeS);
  drawEntitiesFront(ctx, ents, ed);
  ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);

  const sx = (x: number) => (x - camX) * T;
  const sy = (y: number) => (y - camY) * T;
  const bx = sx(b.x), by = sy(b.y);
  blobView.drawBehind(ctx, T, sx, sy);
  crowd.draw(ctx, T, L.phone, bx, by, L.h);
  blobView.draw(ctx, T, bx, sy(b.y + HALF_H), b, scene.paused, timeS);
  if (scene.you) crowd.drawOwn(ctx, T, L.phone, bx, by, L.w, L.h);

  // the Big Chomp eats everything, so it goes over the blob and the crowd
  for (const e of ents) {
    if (e.kind !== 'chomp') continue;
    ctx.setTransform(tilePx, 0, 0, tilePx, -camPxX, -camPxY);
    drawChomp(ctx, e, ed, { depth: Infinity, solid: solidOf(scene.level.tileAt) });
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  }

  hudView.draw(ctx, L, scene.hud, bg.pal, timeS);
  if (scene.deathCard) hudView.drawDeathCard(ctx, L, scene.deathCard, timeS);
}
