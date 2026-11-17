// Video export: renders the clip offline, frame by frame, with the real renderer at
// 1080×1920 (vertical) or 1920×1080 (wide), 30 fps, encodes H.264 with WebCodecs and muxes
// MP4 with mp4-muxer. The game's synthesized sound is rendered through an
// OfflineAudioContext and encoded as AAC where the browser can (Safari, Chrome on
// Mac/Windows/Android); where it can't, the video is silent and the result says so.
// Without WebCodecs it falls back to MediaRecorder recording a real-time playback (WebM, or
// MP4 where MediaRecorder makes it), sound included.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Level, Replay } from '@blobocracy/shared';
import { createGameAudio } from '../audio/index.ts';
import type { Layout } from '../layout.ts';
import { resetRenderer } from '../render/frame.ts';
import { FONT_DISPLAY } from '../render/palette.ts';
import { clipLength, drawClipFrame, type ClipBrand } from './draw.ts';
import { EXPORT_SIZE, exportLayout, FPS, type ClipAspect } from './framing.ts';
import { ClipPlayback, type ClipAudioSink } from './playback.ts';

export type ExportPhase = 'sound' | 'video' | 'finishing';

export interface ExportOptions {
  replay: Replay;
  level: Level;
  aspect: ClipAspect;
  brand: ClipBrand;
  /** 0..1 progress (sound is the first ~10%). */
  onProgress?(p: number, phase: ExportPhase): void;
  signal?: AbortSignal;
  /** Audio codec choice: AAC only (default), AAC else Opus (an MP4 Opus track; not for Apple apps), or none. */
  audio?: 'aac' | 'aac-or-opus' | 'none';
  /** Force the MediaRecorder fallback (testing). */
  method?: 'auto' | 'mediarecorder';
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  ext: 'mp4' | 'webm';
  width: number;
  height: number;
  /** Seconds. */
  duration: number;
  method: 'webcodecs' | 'mediarecorder';
  videoCodec: string;
  audioCodec: 'aac' | 'opus' | null;
  /** Why there's no sound, when there isn't. */
  note?: string;
}

const AUDIO_RATE = 48000;
const AUDIO_TICK = 1 / 40;
const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032', 'avc1.4d0032'];

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** What this browser can do, for the UI (both are feature detections, not promises). */
export function exportSupport(): { webcodecs: boolean; mediarecorder: boolean } {
  const g = globalThis as unknown as Record<string, unknown>;
  return {
    webcodecs: typeof g.VideoEncoder === 'function' && typeof g.VideoFrame === 'function',
    mediarecorder: typeof g.MediaRecorder === 'function' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype,
  };
}

function abortIf(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

const nextTask = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * A canvas to draw the video on. OffscreenCanvas where it renders the page's web fonts
 * the same as a normal canvas (it does in Chrome; checked rather than assumed).
 */
function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: CanvasRenderingContext2D } {
  const html = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { canvas: c, ctx: c.getContext('2d', { alpha: false })! };
  };
  if (typeof OffscreenCanvas === 'undefined') return html();
  try {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { alpha: false }) as unknown as CanvasRenderingContext2D | null;
    if (!ctx) return html();
    const probe = document.createElement('canvas').getContext('2d')!;
    const font = `40px ${FONT_DISPLAY}`;
    probe.font = font;
    ctx.font = font;
    if (Math.abs(probe.measureText('Blobocracy 4,812').width - ctx.measureText('Blobocracy 4,812').width) > 0.5) return html();
    return { canvas: c, ctx };
  } catch {
    return html();
  }
}

async function pickVideoConfig(w: number, h: number): Promise<VideoEncoderConfig | null> {
  const bitrate = Math.round(w * h * FPS * 0.065); // ≈ 4 Mbit/s at 1080p30: flat cartoon colors compress well, and ~16 MB fits messaging apps
  for (const codec of VIDEO_CODECS) {
    const config: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: FPS, avc: { format: 'avc' }, latencyMode: 'quality' };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return s.config ?? config;
    } catch { /* try the next */ }
  }
  return null;
}

async function pickAudioCodec(want: ExportOptions['audio']): Promise<{ codec: 'aac' | 'opus'; config: AudioEncoderConfig } | null> {
  if (want === 'none' || typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null;
  const options: ['aac' | 'opus', string][] = want === 'aac-or-opus' ? [['aac', 'mp4a.40.2'], ['opus', 'opus']] : [['aac', 'mp4a.40.2']];
  for (const [name, codec] of options) {
    const config: AudioEncoderConfig = { codec, sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 128_000 };
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return { codec: name, config };
    } catch { /* next */ }
  }
  return null;
}

/** Plays the clip's sound into an OfflineAudioContext, driven exactly like the page does. */
export async function renderClipAudio(replay: Replay, level: Level, seconds: number): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  const ctx = new OfflineAudioContext(2, Math.ceil(AUDIO_RATE * seconds), AUDIO_RATE);
  const audio = createGameAudio({ context: ctx, storage: null, timers: false });
  audio.setMuted(false);
  audio.unlock();
  const pb = new ClipPlayback(replay, level);
  const L = exportLayout('wide');
  let outro = false;
  const at = (t: number) => {
    if (t < pb.duration) pb.frame(t, L, audio);
    else if (!outro) { outro = true; audio.resetToStart(); } // the music comes back for the end card
    audio.tick();
  };
  at(0);
  try {
    for (let i = 1; i * AUDIO_TICK < seconds - AUDIO_TICK; i++) {
      const t = i * AUDIO_TICK;
      void ctx.suspend(t).then(() => { at(t); void ctx.resume(); });
    }
  } catch {
    return null; // no suspend() on this OfflineAudioContext: no sound rather than wrong sound
  }
  return ctx.startRendering();
}

/** Renders and encodes the clip. Throws (AbortError on cancel) if it can't. */
export async function exportClip(o: ExportOptions): Promise<ExportResult> {
  const sup = exportSupport();
  if (o.method !== 'mediarecorder' && sup.webcodecs) {
    const config = await pickVideoConfig(EXPORT_SIZE[o.aspect].w, EXPORT_SIZE[o.aspect].h);
    if (config) return exportWebCodecs(o, config);
  }
  if (sup.mediarecorder) return exportMediaRecorder(o);
  throw new Error('This browser cannot make videos.');
}

async function exportWebCodecs(o: ExportOptions, vconfig: VideoEncoderConfig): Promise<ExportResult> {
  const { w: W, h: H } = EXPORT_SIZE[o.aspect];
  const L = exportLayout(o.aspect);
  const pb = new ClipPlayback(o.replay, o.level);
  const total = clipLength(pb);
  const frames = Math.round(total * FPS);
  const progress = o.onProgress ?? (() => {});

  // sound first (fast): rendered offline, then encoded if the browser has an encoder for it
  let audioCodec: 'aac' | 'opus' | null = null;
  let note: string | undefined;
  let pcm: AudioBuffer | null = null;
  const acodec = await pickAudioCodec(o.audio ?? 'aac');
  if (acodec) {
    progress(0, 'sound');
    pcm = await renderClipAudio(o.replay, o.level, total).catch(() => null);
    if (pcm) audioCodec = acodec.codec;
    else note = 'This browser could not render the sound, so the video is silent.';
  } else if ((o.audio ?? 'aac') !== 'none') {
    note = 'This browser cannot encode AAC sound, so the video is silent.';
  }
  abortIf(o.signal);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    audio: audioCodec ? { codec: audioCodec, numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let failure: unknown = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  venc.configure(vconfig);

  if (pcm && acodec) {
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { failure = e; },
    });
    aenc.configure(acodec.config);
    const n = pcm.length, block = 1024;
    const l = pcm.getChannelData(0), r = pcm.getChannelData(1);
    for (let i = 0; i < n; i += block) {
      const len = Math.min(block, n - i);
      const data = new Float32Array(len * 2);
      data.set(l.subarray(i, i + len), 0);
      data.set(r.subarray(i, i + len), len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((i / AUDIO_RATE) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();
    aenc.close();
  }
  progress(0.1, 'video');

  const { canvas, ctx } = makeCanvas(W, H);
  resetRenderer();
  try {
    for (let i = 0; i < frames; i++) {
      abortIf(o.signal);
      if (failure) throw failure;
      drawClipFrame(ctx, L, pb, i / FPS, o.brand);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
      venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
      frame.close();
      // keep the encoder fed but not flooded, and the page responsive
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      if (i % 3 === 0) {
        progress(0.1 + 0.85 * (i / frames), 'video');
        await nextTask();
      }
    }
    progress(0.96, 'finishing');
    await venc.flush();
    if (failure) throw failure;
  } finally {
    if (venc.state !== 'closed') venc.close();
    resetRenderer();
  }
  muxer.finalize();
  progress(1, 'finishing');
  return {
    blob: new Blob([target.buffer], { type: 'video/mp4' }),
    mime: 'video/mp4', ext: 'mp4', width: W, height: H, duration: frames / FPS,
    method: 'webcodecs', videoCodec: vconfig.codec, audioCodec, note,
  };
}

/** Real-time fallback: plays the clip into a canvas and records it with sound. */
async function exportMediaRecorder(o: ExportOptions): Promise<ExportResult> {
  const { w: W, h: H } = EXPORT_SIZE[o.aspect];
  const L: Layout = exportLayout(o.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const pb = new ClipPlayback(o.replay, o.level);
  const total = clipLength(pb);
  const mimes = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const stream = canvas.captureStream(FPS);

  let actx: AudioContext | null = null;
  let sink: ClipAudioSink | undefined;
  if ((o.audio ?? 'aac') !== 'none') {
    try {
      actx = new AudioContext();
      const dest = actx.createMediaStreamDestination();
      const audio = createGameAudio({ context: actx, storage: null, destination: dest });
      audio.setMuted(false);
      audio.unlock();
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      sink = audio;
    } catch { actx = null; }
  }
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 5_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const stopped = new Promise<void>((r) => { rec.onstop = () => r(); });
  resetRenderer();
  drawClipFrame(ctx, L, pb, 0, o.brand, sink);
  rec.start(500);
  const t0 = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (o.signal?.aborted) { reject(new DOMException('Export cancelled', 'AbortError')); return; }
        const t = (performance.now() - t0) / 1000;
        drawClipFrame(ctx, L, pb, Math.min(t, total), o.brand, sink);
        o.onProgress?.(Math.min(1, t / total), 'video');
        if (t >= total) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    await stopped;
    void actx?.close();
    resetRenderer();
  }
  const type = rec.mimeType || mime || 'video/webm';
  const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  return {
    blob: new Blob(parts, { type }), mime: type, ext, width: W, height: H, duration: total,
    method: 'mediarecorder', videoCodec: type, audioCodec: !actx ? null : /opus/.test(type) || ext === 'webm' ? 'opus' : 'aac',
    note: actx ? undefined : 'Recorded without sound.',
  };
}
