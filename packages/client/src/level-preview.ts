// Level overview: the whole of a level (default LEVEL1) drawn by the real renderer (ground chunks, dynamic
// tiles, entities) at a small tile size, cut into stacked rows with each zone's sky
// behind it and its name on top. Used by tools/level-preview.ts.
// Query params: ?level=<id, default 1>  &tile=<px per tile, default 14>  &rows=<row count>  &t=<run time for entities>
import { LEVEL1, LEVELS, tileAt as levelTileAt } from '@blobocracy/shared';
import './fonts.css';
import { DynamicTiles } from './render/dyntiles.ts';
import { drawChomp, drawEntitiesBack, drawEntitiesFront, solidOf, type EntityDrawCtx } from './render/entities.ts';
import { buildChunk, CHUNK_TILES, extendedTiles } from './render/level.ts';
import { BLOB, BLOB_SHADE, CREAM_HI, FONT_DISPLAY, FONT_TEXT, INK, SKIES } from './render/palette.ts';
import type { SceneLevel } from './render/scene.ts';
import { loadFonts } from './view.ts';

const P = new URLSearchParams(location.search);
const level = LEVELS.find((l) => l.id === Number(P.get('level') ?? 1)) ?? LEVEL1;
const T = Number(P.get('tile') ?? 14);
const runTime = Number(P.get('t') ?? 0);
const ROWS = Number(P.get('rows') ?? Math.max(1, Math.min(6, Math.round(level.width / 240))));
const H = level.height;
const rowCols = Math.ceil(level.width / ROWS);
const PAD = 24, LABEL = 46, GAP = 18;
const rowH = H * T;

const scene: SceneLevel = {
  width: level.width,
  height: level.height,
  tileAt: (x, y) => levelTileAt(level, x, y),
  zones: level.zones,
  entities: level.entities,
};

async function main(): Promise<void> {
  await loadFonts();
  const canvas = document.getElementById('strip') as HTMLCanvasElement;
  canvas.width = rowCols * T + PAD * 2;
  canvas.height = PAD + ROWS * (LABEL + rowH + GAP) + 30;
  const g = canvas.getContext('2d')!;
  g.fillStyle = INK;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.font = `700 13px ${FONT_TEXT}`;
  g.fillStyle = 'rgba(255,243,220,.6)';
  g.fillText(`LEVEL ${level.id} v${level.version} · ${level.width} columns · ${level.zones.length} zones · ${level.entities.length} entities · entities at t=${runTime}s`, PAD, canvas.height - 14);

  const code = extendedTiles(scene);
  const dyn = new DynamicTiles();
  const chunkCache = new Map<number, ReturnType<typeof buildChunk>>();
  const chunk = (c: number) => {
    let ch = chunkCache.get(c);
    if (!ch) { ch = buildChunk(code, c, T); chunkCache.set(c, ch); }
    return ch;
  };

  for (let r = 0; r < ROWS; r++) {
    const x0 = r * rowCols, x1 = Math.min(level.width, x0 + rowCols);
    if (x0 >= x1) break;
    const ox = PAD, oy = PAD + r * (LABEL + rowH + GAP) + LABEL;
    const wpx = (x1 - x0) * T;
    g.save();
    g.beginPath();
    g.roundRect(ox, oy, wpx, rowH, 10);
    g.clip();
    // zone skies
    for (const z of level.zones) {
      const a = Math.max(x0, z.startX), b = Math.min(x1, z.endX);
      if (a >= b) continue;
      const sky = SKIES[z.sky];
      const gr = g.createLinearGradient(0, oy, 0, oy + rowH);
      gr.addColorStop(0, sky.top);
      gr.addColorStop(1, sky.bot);
      g.fillStyle = gr;
      g.fillRect(ox + (a - x0) * T, oy, (b - a) * T, rowH);
      // a soft hill line so it reads as the game's backdrop
      g.fillStyle = sky.hillFar;
      g.beginPath();
      g.moveTo(ox + (a - x0) * T, oy + rowH);
      for (let x = a; x <= b; x += 0.5) g.lineTo(ox + (x - x0) * T, oy + rowH * (0.62 + 0.07 * Math.sin(x * 0.11) + 0.04 * Math.sin(x * 0.27)));
      g.lineTo(ox + (b - x0) * T, oy + rowH);
      g.fill();
    }
    // ground chunks
    for (let c = Math.floor(x0 / CHUNK_TILES); c <= Math.floor((x1 - 1) / CHUNK_TILES); c++) {
      const ch = chunk(c);
      if (ch.canvas) g.drawImage(ch.canvas as CanvasImageSource, ox + ch.left - x0 * T, oy + ch.top);
    }
    // moving parts
    const view = { x0, y0: 0, x1, y1: H };
    g.setTransform(T, 0, 0, T, ox - x0 * T, oy);
    for (const z of level.zones) {
      const a = Math.max(x0, z.startX), b = Math.min(x1, z.endX);
      if (a >= b) continue;
      g.save();
      g.beginPath();
      g.rect(a, 0, b - a, H);
      g.clip();
      const zv = { x0: a, y0: 0, x1: b, y1: H };
      const ed: EntityDrawCtx = { view: zv, runTime, chompStart: null, timeS: runTime, night: SKIES[z.sky].stars, focus: null };
      drawEntitiesBack(g, level.entities, ed);
      dyn.draw(g, scene, zv, null, runTime, [], runTime);
      drawEntitiesFront(g, level.entities, ed);
      for (const e of level.entities) if (e.kind === 'chomp') drawChomp(g, e, ed, { depth: 5, always: true, solid: solidOf(scene.tileAt) });
      g.restore();
    }
    // spawn blob and goal flag
    if (level.spawn.x >= x0 && level.spawn.x < x1) {
      g.beginPath();
      g.ellipse(level.spawn.x, level.spawn.y, 0.7, 0.6, 0, 0, Math.PI * 2);
      g.fillStyle = BLOB;
      g.fill();
      g.lineWidth = 0.12;
      g.strokeStyle = INK;
      g.stroke();
      g.fillStyle = BLOB_SHADE;
      g.fillRect(level.spawn.x - 0.1, level.spawn.y - 0.15, 0.2, 0.2);
    }
    if (level.goalX >= x0 && level.goalX < x1) {
      let gy = 0;
      while (gy < H && scene.tileAt(Math.floor(level.goalX), gy) !== 1) gy++;
      g.lineWidth = 0.12;
      g.strokeStyle = INK;
      g.beginPath();
      g.moveTo(level.goalX, gy);
      g.lineTo(level.goalX, gy - 3.4);
      g.stroke();
      g.fillStyle = BLOB;
      g.beginPath();
      g.moveTo(level.goalX, gy - 3.4);
      g.lineTo(level.goalX + 1.5, gy - 2.95);
      g.lineTo(level.goalX, gy - 2.5);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.restore();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,243,220,.25)';
    g.beginPath();
    g.roundRect(ox, oy, wpx, rowH, 10);
    g.stroke();

    // zone boundaries and names
    for (const z of level.zones) {
      const a = Math.max(x0, z.startX), b = Math.min(x1, z.endX);
      if (a >= b) continue;
      const lx = ox + (a - x0) * T;
      if (z.startX >= x0 && z.startX > 0) {
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        g.strokeStyle = CREAM_HI;
        g.beginPath();
        g.moveTo(lx, oy - 8);
        g.lineTo(lx, oy + rowH);
        g.stroke();
        g.setLineDash([]);
      }
      const cont = z.startX < x0;
      const label = `${z.index + 1}  ${z.name}${cont ? ' (cont.)' : ''}`;
      g.font = `${cont ? 18 : 22}px ${FONT_DISPLAY}`;
      const tw = g.measureText(label).width;
      if (tw + 24 > (b - a) * T) continue;
      g.fillStyle = CREAM_HI;
      g.beginPath();
      g.roundRect(lx + 6, oy - LABEL + 6, tw + 24, 32, 16);
      g.fill();
      g.fillStyle = INK;
      g.textBaseline = 'middle';
      g.fillText(label, lx + 18, oy - LABEL + 23);
      g.font = `700 12px ${FONT_TEXT}`;
      g.fillStyle = 'rgba(255,243,220,.7)';
      g.fillText(`x ${z.startX}–${z.endX}`, lx + tw + 40, oy - LABEL + 23);
    }
    // column ruler every 20 tiles
    g.font = `700 10px ${FONT_TEXT}`;
    g.fillStyle = 'rgba(255,243,220,.55)';
    g.textBaseline = 'top';
    for (let x = Math.ceil(x0 / 20) * 20; x < x1; x += 20) {
      g.fillRect(ox + (x - x0) * T, oy + rowH + 2, 1, 5);
      g.fillText(String(x), ox + (x - x0) * T + 3, oy + rowH + 3);
    }
    g.textBaseline = 'alphabetic';
  }
  (window as unknown as { __done: boolean }).__done = true;
}

main().catch((e) => {
  console.error(e);
  (window as unknown as { __error: string }).__error = String(e);
});
