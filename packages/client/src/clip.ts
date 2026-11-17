// The clip page (/c/<id>): plays a replay through the real renderer, looping, with the
// game's moments and sound; downloads it as a video (vertical or wide) and shares it.
// Dev: /clip.html?id=<id> fetches /api/clips/<id>; /clip.html?fixture=<name> loads
// /fixtures/<name>.replay.
import './fonts.css';
import { LEVEL1, unpackReplay, type Replay, type ServerEvent } from '@blobocracy/shared';
import { createGameAudio, type GameAudio } from './audio/index.ts';
import { clipLength, drawClipFrame, type ClipBrand } from './clip/draw.ts';
import { exportClip, exportSupport, type ExportResult } from './clip/export.ts';
import { clipLayout, exportLayout, FPS, type ClipAspect } from './clip/framing.ts';
import { ClipPlayback } from './clip/playback.ts';
import { resetRenderer } from './render/frame.ts';
import { loadReducedMotion } from './settings.ts';
import { loadFonts } from './view.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const page = $('page'), stage = $('stage'), canvas = $<HTMLCanvasElement>('clip');
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (p: number) => `${Math.round(p * 100)}%`;

// ---- which clip ----------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const pathId = location.pathname.match(/^\/c\/([A-Za-z0-9_-]{1,64})\/?$/)?.[1] ?? null;
const clipId = pathId ?? params.get('id');
const fixture = params.get('fixture');
const source = fixture && /^[a-z0-9-]{1,40}$/.test(fixture) ? `/fixtures/${fixture}.replay` : clipId && /^[A-Za-z0-9_-]{1,64}$/.test(clipId) ? `/api/clips/${clipId}` : null;
const shareUrl = clipId ? `${location.origin}/c/${clipId}` : location.href;

async function load(): Promise<Replay> {
  if (!source) throw new Error('missing');
  const res = await fetch(source);
  if (!res.ok) throw new Error(res.status === 404 ? 'missing' : `HTTP ${res.status}`);
  const r = await unpackReplay(new Uint8Array(await res.arrayBuffer()));
  if (!r) throw new Error('corrupt');
  if (r.levelId !== LEVEL1.id) throw new Error('level');
  return r;
}

// ---- words ---------------------------------------------------------------------------------
interface Story { kicker: string; yay: boolean; headline: string; sub: string; share: string }
function storyOf(r: Replay): Story {
  const welcome = r.events.find((e) => e.event.t === 'welcome')?.event as Extract<ServerEvent, { t: 'welcome' }> | undefined;
  const before = welcome?.record ?? null;
  const run = `Run ${fmt(r.run)}`;
  const deaths = `${fmt(r.deaths)} deaths so far.`;
  if (r.kind === 'win') {
    return { kicker: 'We did it!', yay: true, headline: `${run} beat the whole level.`, sub: `It took ${fmt(r.deaths)} deaths and everyone online steering one blob.`, share: `${run} beat Blobocracy after ${fmt(r.deaths)} deaths.` };
  }
  if (r.kind === 'record') {
    return {
      kicker: 'New record!', yay: true,
      headline: `${run} made it ${pct(r.progress)} of the way.`,
      sub: before ? `The old record was ${pct(before.progress)}. ${deaths}` : deaths,
      share: `${run} set a new Blobocracy record: ${pct(r.progress)}.`,
    };
  }
  return {
    kicker: 'So close.', yay: false,
    headline: `${run} made it ${pct(r.progress)} of the way.`,
    sub: before ? `The record is ${pct(before.progress)}. ${deaths}` : deaths,
    share: `So close. ${run} made it ${pct(r.progress)} in Blobocracy.`,
  };
}

// ---- small UI helpers ----------------------------------------------------------------------
const toastEl = $('toast');
let toastTimer = 0;
function toast(text: string, ms = 2600): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}
const announce = (text: string) => { $('announce').textContent = text; };

// ---- player --------------------------------------------------------------------------------
const reduced = loadReducedMotion();
const host = location.host || 'blobocracy.com';
let replay: Replay;
let brand: ClipBrand;
let pb: ClipPlayback;
let total = 1;
let t = 0;
let playing = true;
let busy = false; // exporting: the renderer belongs to the exporter
let aspect: ClipAspect = 'vertical';
let ctx2d: CanvasRenderingContext2D;
let L = clipLayout(1, 1, 1);

// sound: off until asked for (and the first tap unlocks it)
let actx: AudioContext | null = null;
let audio: GameAudio | null = null;
let soundOn = false;
let audioDead = false;

function ensureAudio(): GameAudio | null {
  if (audio || audioDead) return audio;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) { audioDead = true; return null; }
    actx = new Ctor({ latencyHint: 'interactive' });
    audio = createGameAudio({ context: actx, storage: null });
    audio.setMuted(true);
    return audio;
  } catch {
    audioDead = true;
    return null;
  }
}

function setSound(on: boolean): void {
  const a = ensureAudio();
  if (!a) { toast('Sound is not available in this browser.'); return; }
  soundOn = on;
  a.unlock();
  a.setMuted(!on);
  if (on && actx?.state === 'suspended' && playing) void actx.resume();
  const btn = $('sound');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  $('sound-waves').setAttribute('d', on ? 'M15.5 8.5q2.5 3.5 0 7M18 6q4.5 6 0 12' : 'M15.5 9.5l5 5M20.5 9.5l-5 5');
}

function setPlaying(on: boolean): void {
  playing = on;
  stage.classList.toggle('paused', !on);
  $('tap').setAttribute('aria-label', on ? 'Pause' : 'Play');
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play');
  $('play-icon').setAttribute('d', on ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l10.5-6.5z');
  if (actx) void (on ? actx.resume() : actx.suspend()).catch(() => {});
}

function restart(): void {
  t = 0;
  pb.restart();
  resetRenderer();
  if (audio) audio.resetToStart(); // the clip opens with its own zone (welcome → setZone)
}

/** Fit the stage to the window: vertical on portrait screens, wide otherwise. */
function fit(): void {
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  aspect = vh > vw ? 'vertical' : 'wide';
  const ar = aspect === 'vertical' ? 9 / 16 : 16 / 9;
  const reserve = aspect === 'vertical' ? 178 : 210; // header + the row of buttons (phones) / the panel (desktop)
  let w = Math.min(vw - 32, aspect === 'wide' ? 1100 : 560);
  let h = w / ar;
  const maxH = Math.max(260, vh - reserve);
  if (h > maxH) { h = maxH; w = h * ar; }
  w = Math.floor(w); h = Math.floor(h);
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  const cssW = w - 8, cssH = h - 8; // inside the border
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  L = clipLayout(cssW, cssH, dpr);
  $('panel').style.maxWidth = `${Math.max(w, Math.min(vw - 32, 560))}px`;
}

let lastNow = 0;
let seenTitle = '';
function loop(now: number): void {
  const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
  lastNow = now;
  if (!busy) {
    if (playing) {
      t += dt;
      if (t >= total) restart();
    }
    drawClipFrame(ctx2d, L, pb, t, brand, soundOn && playing ? audio ?? undefined : undefined);
    audio?.tick();
    $('scrub').style.width = `${(t / total) * 100}%`;
  }
  requestAnimationFrame(loop);
}

// ---- export, download, share ---------------------------------------------------------------
let videos: Partial<Record<ClipAspect, { result: ExportResult; file: File }>> = {};
let abort: AbortController | null = null;

const fileName = (a: ClipAspect, ext: string) => `blobocracy-run-${replay.run}-${a}.${ext}`;

async function makeVideo(a: ClipAspect): Promise<{ result: ExportResult; file: File } | null> {
  const have = videos[a];
  if (have) return have;
  if (busy) return null;
  const sup = exportSupport();
  if (!sup.webcodecs && !sup.mediarecorder) { toast('This browser cannot make videos. Try Chrome or Safari.'); return null; }
  busy = true;
  abort = new AbortController();
  const wasPlaying = playing;
  if (actx) void actx.suspend().catch(() => {});
  stage.classList.add('exporting');
  const meter = $('meter'), note = $('busy-note');
  $('busy-title').textContent = a === 'vertical' ? 'Making your vertical video' : 'Making your wide video';
  note.textContent = sup.webcodecs ? '' : 'Recording in real time, keep this tab open.';
  announce('Making the video.');
  try {
    const result = await exportClip({
      replay, level: LEVEL1, aspect: a, brand, signal: abort.signal,
      audio: params.get('audio') === 'opus' ? 'aac-or-opus' : 'aac',
      method: params.get('export') === 'mediarecorder' ? 'mediarecorder' : 'auto',
      onProgress: (p, phase) => {
        meter.style.width = `${Math.round(p * 100)}%`;
        if (sup.webcodecs) note.textContent = phase === 'sound' ? 'Mixing the sound…' : phase === 'finishing' ? 'Almost there…' : `${Math.round(p * 100)}%`;
      },
    });
    const file = new File([result.blob], fileName(a, result.ext), { type: result.mime.split(';')[0] });
    videos[a] = { result, file };
    (window as unknown as { __lastExport?: ExportResult }).__lastExport = result;
    if (result.note) toast(result.note, 4200);
    announce('Video ready.');
    return videos[a]!;
  } catch (e) {
    if ((e as DOMException)?.name !== 'AbortError') { console.error(e); toast('The video could not be made on this device.'); }
    return null;
  } finally {
    stage.classList.remove('exporting');
    meter.style.width = '0';
    busy = false;
    abort = null;
    restart();
    setPlaying(wasPlaying);
  }
}

function download(v: { file: File }): void {
  const url = URL.createObjectURL(v.file);
  const a = document.createElement('a');
  a.href = url;
  a.download = v.file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const canShareFiles = () => {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array(1)], 'clip.mp4', { type: 'video/mp4' })] });
  } catch { return false; }
};
const isPhone = () => matchMedia('(pointer: coarse)').matches && canShareFiles();

async function share(): Promise<void> {
  const story = storyOf(replay);
  if (isPhone()) {
    const v = videos.vertical;
    if (!v) {
      // making the video takes longer than a tap's permission to share lasts, so it's two taps
      const made = await makeVideo('vertical');
      if (made) {
        $('share').classList.add('ready');
        $('share-label').textContent = 'Share video';
        toast('Your video is ready. Tap Share video.');
      }
      return;
    }
    try {
      const data: ShareData = { files: [v.file], title: 'Blobocracy', text: `${story.share} ${shareUrl}` };
      await navigator.share(data);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
      try { await navigator.share({ title: 'Blobocracy', text: story.share, url: shareUrl }); } catch { /* cancelled */ }
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    toast('Link copied. Paste it anywhere.');
  } catch {
    window.prompt('Copy this link:', shareUrl);
  }
}

// ---- boot ----------------------------------------------------------------------------------
function wire(): void {
  $('tap').addEventListener('click', () => setPlaying(!playing));
  $('play').addEventListener('click', () => setPlaying(!playing));
  $('sound').addEventListener('click', () => setSound(!soundOn));
  const dl = $<HTMLDialogElement>('dl');
  $('download').addEventListener('click', () => { if (!busy) dl.showModal(); });
  $('dl-cancel').addEventListener('click', () => dl.close());
  dl.addEventListener('click', (e) => { if (e.target === dl) dl.close(); });
  for (const b of dl.querySelectorAll<HTMLButtonElement>('[data-aspect]')) {
    b.addEventListener('click', async () => {
      dl.close();
      const v = await makeVideo(b.dataset.aspect as ClipAspect);
      if (v) download(v);
    });
  }
  $('share').addEventListener('click', () => { void share(); });
  $('cancel').addEventListener('click', () => abort?.abort());
  addEventListener('resize', fit);
  addEventListener('orientationchange', fit);
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLAnchorElement)) { e.preventDefault(); setPlaying(!playing); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && actx) void actx.suspend().catch(() => {}); else if (playing && actx && soundOn) void actx.resume().catch(() => {}); });
}

function fail(reason: string): void {
  page.classList.add('failed');
  if (reason === 'level') $('oops-text').textContent = 'This clip is from a level that has since changed, so it can no longer be played back here.';
  document.title = 'Clip not found · Blobocracy';
}

async function boot(): Promise<void> {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return fail('canvas');
  ctx2d = ctx;
  let r: Replay;
  try {
    [r] = await Promise.all([load(), loadFonts()]);
  } catch (e) {
    return fail((e as Error).message);
  }
  replay = r;
  brand = { host, deaths: r.deaths };
  pb = new ClipPlayback(r, LEVEL1, { reduced });
  total = clipLength(pb);
  const story = storyOf(r);
  const kicker = $('kicker');
  kicker.textContent = story.kicker;
  kicker.classList.toggle('yay', story.yay);
  $('headline').textContent = story.headline;
  $('sub').textContent = story.sub;
  document.title = `${story.kicker} ${story.headline} · Blobocracy`;
  seenTitle = document.title;
  if (!isPhone()) $('share-label').textContent = 'Copy link'; // desktop: the link is what travels
  wire();
  fit();
  setPlaying(!reduced);
  requestAnimationFrame(loop);
  exposeForTests();
}

/**
 * Steps a fresh playback to `at` at 30 fps: moments and camera all the way, but only the last
 * two seconds through the renderer (enough for its own animations to be where they'd be).
 */
function warmTo(p: ClipPlayback, lay: typeof L, at: number, draw: (t: number) => void): void {
  const n = Math.round(at * FPS);
  for (let i = 0; i <= n; i++) {
    const tt = i === n ? at : i / FPS;
    if (tt < at - 2 && tt < p.duration - 0.01) p.frame(tt, lay);
    else draw(tt);
  }
}

/** Hooks for tools/clip-shots.ts (render a still, run an export). */
function exposeForTests(): void {
  const w = window as unknown as Record<string, unknown>;
  w.__clip = {
    ready: true,
    duration: total,
    title: seenTitle,
    /** Renders clip time `at` at full export resolution and returns a PNG data URL. */
    async still(at: number, a: ClipAspect): Promise<string> {
      busy = true;
      try {
        const lay = exportLayout(a);
        const c = document.createElement('canvas');
        c.width = Math.round(lay.w * lay.dpr);
        c.height = Math.round(lay.h * lay.dpr);
        const cx = c.getContext('2d', { alpha: false })!;
        const p = new ClipPlayback(replay, LEVEL1, { reduced });
        resetRenderer();
        warmTo(p, lay, at, (tt) => drawClipFrame(cx, lay, p, tt, brand));
        return c.toDataURL('image/png');
      } finally {
        resetRenderer();
        pb.restart();
        busy = false;
      }
    },
    /** Pauses the page player at clip time `at`. */
    seek(at: number): void {
      setPlaying(false);
      restart();
      warmTo(pb, L, at, (tt) => drawClipFrame(ctx2d, L, pb, tt, brand));
      t = at;
    },
    async exportVideo(a: ClipAspect): Promise<{ result: Omit<ExportResult, 'blob'>; base64: string } | null> {
      const v = await makeVideo(a);
      if (!v) return null;
      const buf = new Uint8Array(await v.result.blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const { blob: _blob, ...rest } = v.result;
      return { result: rest, base64: btoa(bin) };
    },
  };
}

void boot();
