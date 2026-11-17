// The short vertical clip (1080x1920, 30 fps, about 9 s): the last seconds before the death
// re-rendered with the HUD, the counter flipping, then an end card with the stats.
// Encoded with WebCodecs into MP4 (H.264 when the browser has it, else VP9); falls back to
// MediaRecorder where WebCodecs is missing. Loaded only when someone asks for a clip.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { TICK_HZ, type Level, type StateFrame } from '@blobocracy/shared';
import { camera, computeLayout } from '../layout.ts';
import { CREAM, FONT_TEXT, INK } from '../render/palette.ts';
import { Renderer, type SceneLevel } from '../render/scene.ts';
import { CLIP_H, CLIP_W, drawShareOverlay, makeCanvas } from './card.ts';
import { CLIP_AFTER_S, CLIP_BEFORE_S, frameAt, replayScene, type ReplayHud } from './replay.ts';
import type { DeathShare } from './words.ts';

const FPS = 30;
const END_CARD_S = 2.8;

export interface ClipInput {
  level: Level;
  sceneLevel: SceneLevel;
  frames: readonly StateFrame[];
  hud: ReplayHud;
  death: DeathShare;
  host: string;
}

export interface Clip { blob: Blob; mime: string; ext: 'mp4' | 'webm'; codec: string }

const yieldToGame = () => new Promise<void>((r) => setTimeout(r, 0));

/** Draws video frame `i` of the clip into ctx. Returns false once past the end. */
function makeDrawer(input: ClipInput, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const L = computeLayout(CLIP_W / 2, CLIP_H / 2, 2);
  const r = new Renderer();
  const { frames, hud } = input;
  const tDeath = hud.deathTick / TICK_HZ;
  const tStart = Math.max(frames[0]!.tick / TICK_HZ, tDeath - CLIP_BEFORE_S);
  const tEnd = Math.min(frames[frames.length - 1]!.tick / TICK_HZ, tDeath + CLIP_AFTER_S);
  const playN = Math.max(1, Math.round((tEnd - tStart) * FPS));
  const total = playN + Math.round(END_CARD_S * FPS);
  let cam: { x: number; y: number } | null = null;
  let still: HTMLCanvasElement | null = null;

  const brand = () => {
    // a small wordmark pill so every clip carries the way back
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const u = CLIP_W / 540;
    const text = input.host;
    ctx.font = `800 ${14 * u}px ${FONT_TEXT}`;
    const w = ctx.measureText(text).width + 28 * u, h = 28 * u;
    const x = (CLIP_W - w) / 2, y = 10 * u; // top edge: never covers the blob, even in a pit
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.lineWidth = 2.5 * u;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, CLIP_W / 2, y + h / 2 + u);
  };

  return {
    total,
    draw(i: number): boolean {
      if (i >= total) return false;
      if (i < playN) {
        const t = tStart + i / FPS;
        const s = frameAt(frames, t);
        cam = camera(L, s, cam, 1 / FPS);
        const scene = replayScene(input.level, input.sceneLevel, frames, t, hud);
        if (i === playN - 1) {
          // the end card sits on this last moment, drawn without the HUD and death card
          r.render(ctx, L, cam, scene, t, { hud: false });
          still = makeCanvas(CLIP_W, CLIP_H);
          still.getContext('2d')!.drawImage(canvas, 0, 0);
        }
        r.render(ctx, L, cam, scene, t);
        brand();
        return true;
      }
      // end card: the last frame dimmed, the card sliding up
      const k = Math.min(1, (i - playN) / (0.35 * FPS));
      const ease = 1 - Math.pow(1 - k, 3);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      if (still) ctx.drawImage(still, 0, 0);
      ctx.fillStyle = `rgba(42,27,61,${0.55 * ease})`;
      ctx.fillRect(0, 0, CLIP_W, CLIP_H);
      ctx.save();
      ctx.globalAlpha = ease;
      ctx.translate(0, (1 - ease) * 120);
      drawShareOverlay(ctx, CLIP_W, CLIP_H, input.death, input.host, input.level.zones.length, 'story');
      ctx.restore();
      return true;
    },
  };
}

const CODECS: [string, 'avc' | 'vp9'][] = [
  ['avc1.640028', 'avc'], // H.264 High 4.0: plays everywhere people share
  ['avc1.4d0028', 'avc'],
  ['avc1.42e028', 'avc'],
  ['vp09.00.40.08', 'vp9'],
];

async function pickCodec(): Promise<{ codec: string; kind: 'avc' | 'vp9'; hw: boolean } | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const [codec, kind] of CODECS) {
    try {
      const cfg: VideoEncoderConfig = { codec, width: CLIP_W, height: CLIP_H, bitrate: 6_000_000, framerate: FPS };
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { codec, kind, hw: false };
    } catch { /* try the next */ }
  }
  return null;
}

async function encodeWebCodecs(input: ClipInput, onProgress: (p: number) => void): Promise<Clip | null> {
  const pick = await pickCodec();
  if (!pick) return null;
  const canvas = makeCanvas(CLIP_W, CLIP_H);
  const drawer = makeDrawer(input, canvas);
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: pick.kind, width: CLIP_W, height: CLIP_H, frameRate: FPS },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure({
    codec: pick.codec, width: CLIP_W, height: CLIP_H, bitrate: 6_000_000, framerate: FPS,
    ...(pick.kind === 'avc' ? { avc: { format: 'avc' } } : {}),
  } as VideoEncoderConfig);
  for (let i = 0; drawer.draw(i); i++) {
    if (failure) throw failure;
    const vf = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    if (encoder.encodeQueueSize > 8 || i % 4 === 3) {
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      onProgress(i / drawer.total);
      await yieldToGame();
    }
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4', codec: pick.codec };
}

/** Real-time fallback: plays the clip into a MediaRecorder (MP4 on Safari, WebM elsewhere). */
async function encodeMediaRecorder(input: ClipInput, onProgress: (p: number) => void): Promise<Clip> {
  const canvas = makeCanvas(CLIP_W, CLIP_H);
  const drawer = makeDrawer(input, canvas);
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  drawer.draw(0);
  rec.start(500);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const i = Math.floor(((performance.now() - t0) / 1000) * FPS);
      if (!drawer.draw(Math.min(i, drawer.total))) { resolve(); return; }
      onProgress(i / drawer.total);
      setTimeout(tick, 1000 / FPS / 2);
    };
    tick();
  });
  rec.stop();
  await done;
  const type = rec.mimeType || mime || 'video/webm';
  onProgress(1);
  return { blob: new Blob(parts, { type }), mime: type, ext: type.includes('mp4') ? 'mp4' : 'webm', codec: type };
}

export async function renderClip(input: ClipInput, onProgress: (p: number) => void = () => {}): Promise<Clip> {
  try {
    const c = await encodeWebCodecs(input, onProgress);
    if (c) return c;
  } catch (e) {
    console.warn('WebCodecs clip failed, falling back to MediaRecorder', e);
  }
  return encodeMediaRecorder(input, onProgress);
}
