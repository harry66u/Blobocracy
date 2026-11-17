// Offline render harness for the game audio (opened by tools/audio-render.ts).
// Drives the real engine through an OfflineAudioContext, calling tick() every 25 ms of
// audio time like the game loop would, and reports levels plus a 16-bit WAV per clip.
import { createGameAudio, type GameAudio } from './audio/index.ts';

type Action = [time: number, fn: (a: GameAudio) => void];

interface Clip {
  name: string;
  seconds: number;
  music: boolean;
  zone?: number;
  actions: Action[];
  /** Named time windows to measure, in seconds. */
  windows: Record<string, [number, number]>;
}

export interface ClipResult {
  name: string;
  seconds: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
  windows: Record<string, { rmsDb: number; peakDb: number }>;
  wav: string;
}

const SR = 44100;
const TICK = 0.025;
const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x));

const sawRamp: Action[] = [];
for (let t = 2.8; t < 3.8; t += 0.025) sawRamp.push([t, (a) => a.sawNear((t - 2.8) / 1)]);

const CLIPS: Clip[] = [
  { name: 'jump', seconds: 1.2, music: false, actions: [[0.1, (a) => a.jump(1)], [0.6, (a) => a.jump(0.3)]],
    windows: { full: [0.1, 0.4], hop: [0.6, 0.9] } },
  { name: 'land', seconds: 1.2, music: false, actions: [[0.1, (a) => a.land(1)], [0.6, (a) => a.land(0.4)]],
    windows: { hard: [0.1, 0.35], soft: [0.6, 0.85] } },
  { name: 'sfx-misc', seconds: 4.2, music: false,
    actions: [[0.1, (a) => a.spring()], [0.8, (a) => a.crumble()], [1.5, (a) => a.pressSlam(1)], [2.2, (a) => a.pressSlam(12)], ...sawRamp],
    windows: { spring: [0.1, 0.6], crumble: [0.8, 1.2], pressNear: [1.5, 1.9], pressFar: [2.2, 2.6], sawHalf: [3.2, 3.4], sawFull: [3.6, 3.8], sawStopped: [4.05, 4.2] } },
  { name: 'death', seconds: 4.5, music: true, actions: [[2.0, (a) => a.death()], [2.2, (a) => a.jump(1)]],
    windows: { music: [1.6, 2.0], hit: [2.0, 2.5], tail: [3.4, 4.5] } },
  { name: 'cheer-zone', seconds: 2.4, music: false, actions: [[0.1, (a) => a.cheer('zone')]], windows: { body: [0.2, 1.4] } },
  { name: 'cheer-record', seconds: 2.6, music: false, actions: [[0.1, (a) => a.cheer('record')]], windows: { body: [0.2, 1.6] } },
  { name: 'music-z0', seconds: 8, music: true, windows: { steady: [2, 8] }, actions: [] },
  { name: 'music-z5', seconds: 8, music: true, zone: 5, windows: { steady: [2, 8] }, actions: [] },
  { name: 'mix-z2', seconds: 8, music: true, zone: 2,
    actions: [[2, (a) => a.jump(1)], [2.5, (a) => a.land(0.8)], [3, (a) => a.jump(0.4)], [3.4, (a) => a.land(0.5)], [4.5, (a) => a.cheer('zone')], [6.5, (a) => a.spring()]],
    windows: { music: [1.5, 2], jump: [2, 2.25], land: [2.5, 2.7], cheer: [4.6, 5.8] } },
  { name: 'tour', seconds: 31, music: true,
    actions: [
      ...[1, 2, 3, 4, 5].map((z): Action => [z * 3.5, (a) => { a.setZone(z); a.cheer('zone'); }]),
      [12, (a) => a.setCrowd(300, 0)], [19, (a) => a.setCrowd(300, 0.9)], [20.5, (a) => a.setCrowd(300, 0)],
      [22, (a) => a.death()], [25, (a) => a.resetToStart()],
    ],
    windows: { z0: [1, 3.5], z5: [19.5, 22], afterDeath: [23.2, 25], back: [28, 31] } },
];

function stats(ch: Float32Array[], from: number, to: number) {
  const a = Math.max(0, Math.floor(from * SR)), b = Math.min(ch[0]!.length, Math.floor(to * SR));
  let sum = 0, peak = 0, n = 0;
  for (const c of ch) for (let i = a; i < b; i++) { const v = c[i]!; sum += v * v; peak = Math.max(peak, Math.abs(v)); n++; }
  return { rms: Math.sqrt(sum / Math.max(1, n)), peak };
}

function wavBase64(ch: Float32Array[]): string {
  const len = ch[0]!.length, nch = ch.length;
  const buf = new ArrayBuffer(44 + len * nch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + len * nch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true); v.setUint32(24, SR, true);
  v.setUint32(28, SR * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * nch * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) for (const c of ch) { v.setInt16(o, Math.max(-1, Math.min(1, c[i]!)) * 32767, true); o += 2; }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function renderClip(clip: Clip): Promise<ClipResult> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * clip.seconds), SR);
  const audio = createGameAudio({ context: ctx, storage: null, music: clip.music, timers: false });
  if (clip.zone !== undefined) audio.setZone(clip.zone);
  audio.unlock();
  const actions = [...clip.actions].sort((x, y) => x[0] - y[0]);
  let next = 0;
  const runUntil = (t: number) => { while (next < actions.length && actions[next]![0] <= t + 1e-9) actions[next++]![1](audio); };
  runUntil(0);
  audio.tick();
  for (let i = 1; i * TICK < clip.seconds - TICK; i++) {
    const t = i * TICK;
    void ctx.suspend(t).then(() => { runUntil(t); audio.tick(); void ctx.resume(); });
  }
  const out = await ctx.startRendering();
  const ch = [out.getChannelData(0), out.getChannelData(1)];
  const all = stats(ch, 0, clip.seconds);
  const windows: ClipResult['windows'] = {};
  for (const [k, [a, b]] of Object.entries(clip.windows)) {
    const s = stats(ch, a, b);
    windows[k] = { rmsDb: db(s.rms), peakDb: db(s.peak) };
  }
  return { name: clip.name, seconds: clip.seconds, peak: all.peak, peakDb: db(all.peak), rmsDb: db(all.rms), windows, wav: wavBase64(ch) };
}

async function renderAll(): Promise<ClipResult[]> {
  const log = document.getElementById('log')!;
  const results: ClipResult[] = [];
  for (const clip of CLIPS) {
    const r = await renderClip(clip);
    results.push(r);
    log.textContent += `${r.name}: peak ${r.peakDb.toFixed(1)} dBFS, rms ${r.rmsDb.toFixed(1)} dBFS\n`;
  }
  return results;
}

(window as unknown as { renderAll: typeof renderAll; audioTestReady: boolean }).renderAll = renderAll;
(window as unknown as { audioTestReady: boolean }).audioTestReady = true;
