// The game's sound: a Web Audio graph with a lookahead music scheduler and synthesized SFX.
// Nothing happens until unlock() (browsers require a user gesture), and every public method
// is safe to call when Web Audio is missing: it then quietly does nothing.
import { glideBpm, layerTargets, planCrossfade, rampValue, type GainRamp } from './crossfade.ts';
import { clampZone, generatePattern, LAYERS, mulberry32, stepSeconds, zoneStyle, ZONE_COUNT, type Layer, type NoteEvent, type ZonePattern } from './patterns.ts';
import { browserStorage, loadMuted, saveMuted, type StorageLike } from './prefs.ts';
import { RateLimiter } from './ratelimit.ts';
import {
  arpVoice, bassVoice, cheerSound, counterVoice, crumbleSound, deathSound, fanfareSound, hatVoice, heartVoice, jumpSound, landSound, levelUpSound,
  makeKit, mtof, padVoice, pluckVoice, pressSound, springSound, type Kit, type MusicVoice,
} from './voices.ts';

export interface GameAudio {
  /** Call on every user gesture; the first one starts the audio. Safe to call repeatedly. */
  unlock(): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  /** 0..5: music layers, tempo and key follow the zone, crossfading over ~2 s. */
  setZone(index: number): void;
  /** A quiet crowd murmur that fills out with players; strain (0..1, tug of war) makes it and the music wobble. */
  setCrowd(online: number, strain: number): void;
  jump(strength: number): void;
  land(impact: number): void;
  spring(): void;
  crumble(): void;
  pressSlam(distanceTiles: number): void;
  /** 0..1, call every frame while a saw is around; silent at 0 and when calls stop. */
  sawNear(proximity: number): void;
  /** One heavy hit, then silence: the music stops at the hit. */
  death(): void;
  cheer(kind: 'zone' | 'record'): void;
  /** After the death hold: the music fades back in from zone 0. */
  resetToStart(): void;
  /** The world beat the level: the music ducks out under a fanfare and a huge cheer, then comes back. */
  win(): void;
  /** The next level unlocks: a rising "level up" sting, and the music starts over from zone 0. */
  levelUp(): void;
  /** Optional per-frame housekeeping (the scheduler also runs on its own timer). */
  tick(): void;
}

export interface GameAudioOptions {
  /** Use this context instead of creating one (e.g. an OfflineAudioContext for rendering tests). */
  context?: BaseAudioContext;
  /** Where the mute setting lives; defaults to localStorage, null for none. */
  storage?: StorageLike | null;
  /** Music seed: the same seed always plays the same tunes. */
  seed?: number;
  /** false: sound effects only (for tests). */
  music?: boolean;
  /** Run the scheduler on an internal timer; defaults to true for a real-time context. */
  timers?: boolean;
  /** Where the mix goes instead of the context's speakers (e.g. a MediaStream destination for recording). */
  destination?: AudioNode;
}

const VOLUME = 0.9;
const MUSIC_LEVEL = 0.22; // music sits well under the SFX
const FADE = 2; // zone crossfade, seconds
const LOOKAHEAD = 0.15; // seconds of music scheduled ahead
const PUMP_MS = 25;
const DEFAULT_SEED = 0xb10b;

const LAYER_SETUP: Record<Layer, { voice: MusicVoice; filter: BiquadFilterType; freq: number; send: number }> = {
  bass: { voice: bassVoice, filter: 'lowpass', freq: 650, send: 0 },
  pluck: { voice: pluckVoice, filter: 'lowpass', freq: 2600, send: 0.45 },
  hats: { voice: hatVoice, filter: 'highpass', freq: 6500, send: 0 },
  pad: { voice: padVoice, filter: 'lowpass', freq: 950, send: 0.2 },
  counter: { voice: counterVoice, filter: 'lowpass', freq: 2200, send: 0.4 },
  arp: { voice: arpVoice, filter: 'lowpass', freq: 1900, send: 0.35 },
  heart: { voice: heartVoice, filter: 'lowpass', freq: 320, send: 0 },
};

type Indexed = Partial<Record<Layer, NoteEvent[][]>>;
function indexPattern(p: ZonePattern): Indexed {
  const out: Indexed = {};
  const total = p.bars * p.stepsPerBar;
  for (const layer of LAYERS) {
    const notes = p.tracks[layer];
    if (!notes) continue;
    const by: NoteEvent[][] = Array.from({ length: total }, () => []);
    for (const n of notes) by[n.step]!.push(n);
    out[layer] = by;
  }
  return out;
}

/** Ramp a param to `value` from wherever it is now, without a jump. */
function glideTo(param: AudioParam, t: number, value: number, timeConstant: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
  param.setTargetAtTime(value, t, timeConstant);
}

interface Graph {
  ctx: BaseAudioContext;
  kit: Kit;
  master: GainNode;
  glue: DynamicsCompressorNode;
  musicCut: GainNode;
  musicEnergy: GainNode;
  musicTone: BiquadFilterNode;
  delay: DelayNode;
  layerIn: Record<Layer, AudioNode>;
  layerFade: Record<Layer, GainNode>;
  sfx: GainNode;
  hit: GainNode;
  bed: GainNode;
  strainToTone: GainNode;
  strainToBed: GainNode;
  saw: { gain: GainNode; oscs: OscillatorNode[] } | null;
}

function buildGraph(ctx: BaseAudioContext, rng: () => number, muted: boolean, out: AudioNode = ctx.destination): Graph {
  const kit = makeKit(ctx, rng);
  const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; return n; };

  const master = g(muted ? 0 : VOLUME);
  master.connect(out);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.connect(master);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 10;
  glue.ratio.value = 3;
  glue.attack.value = 0.006;
  glue.release.value = 0.25;
  glue.connect(limiter);

  const musicTone = ctx.createBiquadFilter();
  musicTone.type = 'lowpass';
  musicTone.Q.value = 0.5;
  musicTone.frequency.value = zoneStyle(0).brightness;
  musicTone.connect(glue);
  const musicCut = g(0);
  musicCut.connect(musicTone);
  const musicEnergy = g(zoneStyle(0).energy);
  musicEnergy.connect(musicCut);
  const musicMix = g(MUSIC_LEVEL);
  musicMix.connect(musicEnergy);

  // A soft dotted-eighth echo for the melodic layers.
  const delaySend = g(1);
  const delay = ctx.createDelay(2);
  delay.delayTime.value = (60 / zoneStyle(0).bpm) * 0.75;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 1700;
  const feedback = g(0.3);
  const wet = g(0.25);
  delaySend.connect(delay).connect(delayTone).connect(feedback).connect(delay);
  delayTone.connect(wet).connect(musicEnergy);

  const layerIn = {} as Record<Layer, AudioNode>;
  const layerFade = {} as Record<Layer, GainNode>;
  for (const layer of LAYERS) {
    const s = LAYER_SETUP[layer];
    const f = ctx.createBiquadFilter();
    f.type = s.filter;
    f.frequency.value = s.freq;
    f.Q.value = 0.5;
    const fade = g(0);
    f.connect(fade).connect(musicMix);
    if (s.send > 0) fade.connect(g(s.send)).connect(delaySend);
    layerIn[layer] = f;
    layerFade[layer] = fade;
  }

  const sfx = g(1);
  sfx.connect(glue);
  const hit = g(1);
  hit.connect(limiter); // the death hit skips the glue so it lands at full weight

  // Crowd murmur bed: two vowel-ish noise bands, very quiet, wobbling with strain.
  const bed = g(0);
  const bedSrc = ctx.createBufferSource();
  bedSrc.buffer = kit.noise;
  bedSrc.loop = true;
  for (const [freq, q, lvl] of [[480, 2, 1], [1450, 3, 0.6]] as const) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    bedSrc.connect(f).connect(g(lvl)).connect(bed);
  }
  bed.connect(musicCut);
  bedSrc.start();
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 2.7;
  const strainToTone = g(0);
  const strainToBed = g(0);
  lfo.connect(strainToTone).connect(musicTone.frequency);
  lfo.connect(strainToBed).connect(bed.gain);
  lfo.start();

  return { ctx, kit, master, glue, musicCut, musicEnergy, musicTone, delay, layerIn, layerFade, sfx, hit, bed, strainToTone, strainToBed, saw: null };
}

export function createGameAudio(opts: GameAudioOptions = {}): GameAudio {
  const storage = opts.storage !== undefined ? opts.storage : browserStorage();
  const seed = opts.seed ?? DEFAULT_SEED;
  const musicEnabled = opts.music !== false;
  const rng = mulberry32(seed ^ 0x5fd);
  let muted = loadMuted(storage);

  let gr: Graph | null = null;
  let failed = false;
  let unlocked = false;
  let dead = false;
  let realtime = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const limiter = new RateLimiter({ jump: 0.08, land: 0.09, spring: 0.12, crumble: 0.09, press: 0.15, cheer: 0.6, death: 1, win: 5, levelUp: 2 });
  const patterns = Array.from({ length: ZONE_COUNT }, (_, z) => generatePattern(z, seed));
  const indexed = patterns.map(indexPattern);

  // ---- music scheduler state ----
  let musicOn = false;
  let targetZone = 0;
  let playingZone = 0;
  let pendingZone: number | null = null;
  let step = 0;
  let nextTime = 0;
  let bpm = zoneStyle(0).bpm, bpmFrom = bpm, bpmTarget = bpm;
  const ramps = {} as Record<Layer, GainRamp>;
  for (const l of LAYERS) ramps[l] = { layer: l, from: 0, to: 0, start: 0, end: 0 };
  const lastZoneFor: Partial<Record<Layer, number>> = {};

  let crowd = { online: 0, strain: 0 };
  let sawLast = -Infinity;
  let sawLevel = 0;

  function ensureGraph(): Graph | null {
    if (gr || failed) return gr;
    try {
      let ctx = opts.context ?? null;
      if (!ctx) {
        const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) { failed = true; return null; }
        ctx = new Ctor({ latencyHint: 'interactive' });
      }
      realtime = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext;
      gr = buildGraph(ctx, rng, muted, opts.destination);
      applyCrowd();
    } catch {
      failed = true;
      gr = null;
    }
    return gr;
  }

  /** Graph exists, the user has unlocked, and the context is running (or rendering offline). */
  function live(): Graph | null {
    if (!gr || !unlocked) return null;
    if (realtime && gr.ctx.state !== 'running') return null;
    return gr;
  }

  const now = () => (gr ? gr.ctx.currentTime : 0);

  function setLayersNow(z: number, t: number): void {
    if (!gr) return;
    const targets = layerTargets(z);
    for (const l of LAYERS) {
      const v = targets[l];
      ramps[l] = { layer: l, from: v, to: v, start: t, end: t };
      const p = gr.layerFade[l].gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(v, t);
    }
  }

  function applyZoneStyle(z: number, t: number, timeConstant: number): void {
    if (!gr) return;
    const st = zoneStyle(z);
    glideTo(gr.musicEnergy.gain, t, st.energy, timeConstant);
    glideTo(gr.musicTone.frequency, t, st.brightness, timeConstant);
    glideTo(gr.delay.delayTime, t, (60 / st.bpm) * 0.75, timeConstant);
  }

  function rememberLayers(z: number): void {
    for (const l of zoneStyle(z).layers) lastZoneFor[l] = z;
  }

  function startMusic(z: number, fadeIn: number): void {
    if (!gr || !musicEnabled) return;
    const t = now() + 0.05;
    playingZone = z;
    pendingZone = null;
    for (const l of LAYERS) delete lastZoneFor[l];
    rememberLayers(z);
    setLayersNow(z, t);
    applyZoneStyle(z, t, 0.01);
    bpm = bpmFrom = bpmTarget = zoneStyle(z).bpm;
    step = 0;
    nextTime = t + 0.05;
    const cut = gr.musicCut.gain;
    cut.cancelScheduledValues(t);
    cut.setValueAtTime(0, t);
    cut.linearRampToValueAtTime(1, t + fadeIn);
    musicOn = true;
    pump();
  }

  function applyZone(z: number, t: number): void {
    if (!gr) return;
    const current = {} as Record<Layer, number>;
    for (const l of LAYERS) current[l] = rampValue(ramps[l], t);
    for (const r of planCrossfade(current, z, t, FADE)) {
      ramps[r.layer] = r;
      const p = gr.layerFade[r.layer].gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(r.from, t);
      p.linearRampToValueAtTime(r.to, r.end);
    }
    playingZone = z;
    rememberLayers(z);
    bpmFrom = bpm;
    bpmTarget = zoneStyle(z).bpm;
    applyZoneStyle(z, t, FADE / 3);
  }

  function scheduleStep(s: number, t: number, sixteenth: number): void {
    if (!gr) return;
    for (const layer of LAYERS) {
      const r = ramps[layer];
      if (r.to < 1e-3 && rampValue(r, t) < 1e-3) continue;
      const z = zoneStyle(playingZone).layers.includes(layer) ? playingZone : lastZoneFor[layer];
      if (z === undefined) continue;
      const notes = indexed[z]![layer]?.[s];
      if (!notes) continue;
      for (const n of notes) LAYER_SETUP[layer].voice(gr.kit, gr.layerIn[layer], t, mtof(n.midi), n.len * sixteenth, n.vel);
    }
  }

  function pump(): void {
    if (!gr) return;
    const t0 = gr.ctx.currentTime;
    // The saw buzz fades out by itself when the game stops reporting it.
    if (sawLevel > 0 && t0 - sawLast > 0.12) setSaw(0);
    if (!musicOn) return;
    if (nextTime < t0 - 0.3) nextTime = t0 + 0.03; // fell behind (stalled tab): skip ahead, don't burst
    const total = patterns[0]!.bars * patterns[0]!.stepsPerBar;
    while (nextTime < t0 + LOOKAHEAD) {
      if (pendingZone !== null && step % 8 === 0) {
        applyZone(pendingZone, nextTime);
        pendingZone = null;
      }
      const dur = stepSeconds(bpm, step, zoneStyle(playingZone).swing);
      scheduleStep(step, nextTime, 60 / bpm / 4);
      nextTime += dur;
      bpm = glideBpm(bpm, bpmTarget, bpmFrom, dur, FADE);
      step = (step + 1) % total;
    }
  }

  function applyCrowd(): void {
    if (!gr) return;
    const t = now();
    const fullness = crowd.online <= 1 ? 0 : Math.min(1, Math.log10(crowd.online) / Math.log10(500));
    const s = Math.max(0, Math.min(1, crowd.strain));
    const level = 0.08 * fullness;
    gr.bed.gain.setTargetAtTime(level, t, 0.4);
    gr.strainToBed.gain.setTargetAtTime(level * 0.6 * s, t, 0.15);
    gr.strainToTone.gain.setTargetAtTime(700 * s, t, 0.15);
  }

  function setSaw(p: number): void {
    if (!gr) return;
    const t = now();
    if (!gr.saw) {
      if (p <= 0) return;
      const { ctx } = gr;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      lp.Q.value = 2;
      const am = ctx.createGain();
      am.gain.value = 0.6;
      const amLfo = ctx.createOscillator();
      amLfo.frequency.value = 26;
      const amDepth = ctx.createGain();
      amDepth.gain.value = 0.4;
      amLfo.connect(amDepth).connect(am.gain);
      const oscs = [1, 1.013].map((m) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 115 * m;
        o.connect(lp);
        o.start();
        return o;
      });
      amLfo.start();
      lp.connect(am).connect(gain).connect(gr.sfx);
      gr.saw = { gain, oscs };
    }
    sawLevel = p;
    gr.saw.gain.gain.setTargetAtTime(p <= 0.001 ? 0 : 0.11 * p ** 1.5, t, p <= 0.001 ? 0.025 : 0.05);
    gr.saw.oscs.forEach((o, i) => o.frequency.setTargetAtTime((105 + 55 * p) * (i ? 1.013 : 1), t, 0.08));
  }

  function startTimer(): void {
    if (timer || !(opts.timers ?? realtime)) return;
    timer = setInterval(() => { try { pump(); } catch { /* keep the game running */ } }, PUMP_MS);
  }

  function watchVisibility(): void {
    if (!realtime || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      try {
        const ctx = gr?.ctx as AudioContext | undefined;
        if (!ctx) return;
        if (document.hidden) void ctx.suspend().catch(() => {});
        else if (unlocked) void ctx.resume().catch(() => {});
      } catch { /* ignore */ }
    });
  }

  /** Runs `fn` only on a live graph; never lets an audio error reach the game. */
  const guard = <A extends unknown[]>(fn: (g: Graph, ...a: A) => void) => (...a: A): void => {
    try {
      const g = live();
      if (g) fn(g, ...a);
    } catch { /* sound is never worth a crash */ }
  };

  /** Plays an SFX if allowed: unmuted, not in the death hold, and not rate-limited. */
  const sfx = <A extends unknown[]>(key: string, fn: (g: Graph, t: number, ...a: A) => void) =>
    guard<A>((g, ...a) => {
      if (muted || dead) return;
      const t = g.ctx.currentTime + 0.005;
      if (!limiter.allow(key, t)) return;
      fn(g, t, ...a);
    });

  return {
    get muted() { return muted; },

    unlock() {
      try {
        const g = ensureGraph();
        if (!g) return;
        if (realtime) {
          const ctx = g.ctx as AudioContext;
          const hidden = typeof document !== 'undefined' && document.hidden;
          if (ctx.state !== 'running' && !hidden) void ctx.resume().catch(() => {});
          if (!unlocked) {
            // iOS wants a sound started inside the gesture itself.
            const b = ctx.createBufferSource();
            b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
            b.connect(ctx.destination);
            b.start();
          }
        }
        if (unlocked) return;
        unlocked = true;
        if (!dead) startMusic(targetZone, 1.5);
        startTimer();
        watchVisibility();
      } catch { /* no sound */ }
    },

    setMuted(m: boolean) {
      muted = !!m;
      saveMuted(storage, muted);
      try {
        if (gr) glideTo(gr.master.gain, now(), muted ? 0 : VOLUME, 0.03);
      } catch { /* ignore */ }
    },

    setZone(index: number) {
      const z = clampZone(index);
      if (z === targetZone) return;
      targetZone = z;
      if (!musicOn || dead) return;
      pendingZone = z === playingZone ? null : z;
    },

    setCrowd(online: number, strain: number) {
      crowd = { online: Number.isFinite(online) ? online : 0, strain: Number.isFinite(strain) ? strain : 0 };
      try { applyCrowd(); } catch { /* ignore */ }
    },

    jump: sfx('jump', (g, t, strength: number) => jumpSound(g.kit, g.sfx, t, strength)),
    land: sfx('land', (g, t, impact: number) => { if (impact >= 0.04) landSound(g.kit, g.sfx, t, impact); }),
    spring: sfx('spring', (g, t) => springSound(g.kit, g.sfx, t)),
    crumble: sfx('crumble', (g, t) => crumbleSound(g.kit, g.sfx, t)),
    pressSlam: sfx('press', (g, t, d: number) => { if (d < 30) pressSound(g.kit, g.sfx, t, d); }),
    cheer: sfx('cheer', (g, t, kind: 'zone' | 'record') => cheerSound(g.kit, g.sfx, t, kind)),

    sawNear: guard((_g, proximity: number) => {
      const p = dead || muted ? 0 : Math.max(0, Math.min(1, Number.isFinite(proximity) ? proximity : 0));
      sawLast = now();
      if (p > 0 || sawLevel > 0) setSaw(p);
    }),

    death() {
      try {
        const g = gr;
        // Works while the context is suspended too (hidden tab): the state still changes, just no hit.
        if (!g || !unlocked || dead) return;
        const t = g.ctx.currentTime + 0.005;
        if (!limiter.allow('death', t)) return;
        dead = true;
        if (!muted && live()) deathSound(g.kit, g.hit, t);
        // The music (and every other sound) stops at the hit.
        musicOn = false;
        pendingZone = null;
        glideTo(g.musicCut.gain, t, 0, 0.004);
        glideTo(g.sfx.gain, t, 0, 0.004);
        // Safety net: other SFX come back on their own if resetToStart never arrives.
        g.sfx.gain.setTargetAtTime(1, t + 4, 0.05);
        setSaw(0);
      } catch { /* ignore */ }
    },

    resetToStart() {
      try {
        targetZone = 0;
        const g = gr;
        if (!g || !unlocked) { dead = false; return; }
        if (!dead && musicOn) { pendingZone = playingZone === 0 ? null : 0; return; }
        dead = false;
        limiter.reset();
        glideTo(g.sfx.gain, now(), 1, 0.05);
        startMusic(0, 2.5);
      } catch { /* ignore */ }
    },

    win: guard((g) => {
      if (muted) return;
      const t = g.ctx.currentTime + 0.005;
      if (!limiter.allow('win', t)) return;
      dead = false;
      // the music steps aside for the fanfare, then comes back under the party
      const cut = g.musicCut.gain;
      cut.cancelScheduledValues(t);
      cut.setValueAtTime(cut.value, t);
      cut.linearRampToValueAtTime(0, t + 0.25);
      cut.setValueAtTime(0, t + 4);
      cut.linearRampToValueAtTime(1, t + 7);
      setSaw(0);
      fanfareSound(g.kit, g.sfx, t);
      cheerSound(g.kit, g.sfx, t + 0.15, 'record');
      cheerSound(g.kit, g.sfx, t + 1.35, 'record');
      cheerSound(g.kit, g.sfx, t + 2.9, 'zone');
    }),

    levelUp: guard((g) => {
      const t = g.ctx.currentTime + 0.005;
      if (!limiter.allow('levelUp', t)) return;
      dead = false;
      targetZone = 0;
      if (!muted) levelUpSound(g.kit, g.sfx, t);
      glideTo(g.sfx.gain, t, 1, 0.05);
      startMusic(0, 3);
    }),

    tick() {
      try { if (live()) pump(); } catch { /* ignore */ }
    },
  };
}
