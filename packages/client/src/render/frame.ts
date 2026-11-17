// Draws one frame from a Scene. Holds the renderer's persistent animation state
// (sky cross-fade, level chunk cache, crowd easing, blob squash, counter flip).
import type { Layout } from '../layout.ts';
import { Background } from './background.ts';
import { BlobView, HALF_H } from './blob.ts';
import { CrowdView } from './crowd.ts';
import { HudView } from './hud.ts';
import { LevelLayer } from './level.ts';
import type { Scene } from './scene.ts';

/** Options for renders that are not the live game view (share image, clip). */
export interface RenderOptions {
  /** Draw the HUD (counter, corners, progress bar) and the death card. Default true. */
  hud?: boolean;
}

/**
 * One renderer's persistent animation state. The live game uses the default instance;
 * the share image and clip make their own so they never disturb the game's animations.
 */
export class Renderer {
  private bg = new Background();
  private levelLayer = new LevelLayer();
  private crowd = new CrowdView();
  private blobView = new BlobView();
  private hudView = new HudView();
  private lastT = -1;

  /** CSS-px bottom edge of the most recent death card (0 before the first). */
  get deathCardBottom(): number { return this.hudView.cardBottom; }

  /**
   * Render a full frame. `cam` is the view's left/top edge in tiles (see layout.camera);
   * it is snapped to device pixels so static chunks and sprites move together.
   */
  render(ctx: CanvasRenderingContext2D, layout: Layout, cam: { x: number; y: number }, scene: Scene, timeS: number, opts: RenderOptions = {}): void {
    const { bg, levelLayer, crowd, blobView, hudView } = this;
    const lastT = this.lastT;
    const dt = lastT < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, timeS - lastT));
    this.lastT = timeS;
    const L = layout;
    const T = L.tile;
    const tilePx = T * L.dpr;
    const camPxX = Math.round(cam.x * tilePx);
    const camPxY = Math.round(cam.y * tilePx);
    const camX = camPxX / tilePx, camY = camPxY / tilePx;
    const b = scene.blob;

    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;

    bg.update(scene.zoneSky, timeS);
    blobView.update(b, scene.level, dt, timeS);
    crowd.update(scene.dots, scene.you, b.dead, dt, timeS);
    hudView.update(scene.hud, scene.deathCard, timeS);

    bg.draw(ctx, L, camX, camY, timeS);
    levelLayer.draw(ctx, L, scene.level, camPxX, camPxY);

    const sx = (x: number) => (x - camX) * T;
    const sy = (y: number) => (y - camY) * T;
    const bx = sx(b.x), by = sy(b.y);
    blobView.drawBehind(ctx, T, sx, sy);
    crowd.draw(ctx, T, L.phone, bx, by, L.h);
    blobView.draw(ctx, T, bx, sy(b.y + HALF_H), b, scene.paused, timeS);
    if (scene.you) crowd.drawOwn(ctx, T, L.phone, bx, by, L.w, L.h);

    if (opts.hud !== false) {
      hudView.draw(ctx, L, scene.hud, bg.pal, timeS);
      if (scene.deathCard) hudView.drawDeathCard(ctx, L, scene.deathCard, timeS);
    }
  }
}

let live = new Renderer();

/** Forget all animation state and cached level chunks (e.g. after the level changes). */
export function resetRenderer(): void {
  live = new Renderer();
}

/** The live game view's renderer (read-only use: e.g. where the death card sits). */
export function liveRenderer(): Renderer { return live; }

/** Render the live game view with the default renderer. */
export function renderFrame(ctx: CanvasRenderingContext2D, layout: Layout, cam: { x: number; y: number }, scene: Scene, timeS: number): void {
  live.render(ctx, layout, cam, scene, timeS);
}
