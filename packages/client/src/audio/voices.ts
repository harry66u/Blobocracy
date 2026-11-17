// Synth voices: every sound is built from oscillators, filtered noise and envelopes.
// Each function schedules one sound at time `t` into `out` and lets its nodes end on their own.

export interface Kit {
  ctx: BaseAudioContext;
  /** 2 s of white noise, shared by every noisy sound. */
  noise: AudioBuffer;
  /** Seeded randomness, for small human variations. */
  rng: () => number;
  /** Soft-clip curve used to give the death hit's sub some audible harmonics. */
  softClip: Float32Array<ArrayBuffer>;
}

export function makeKit(ctx: BaseAudioContext, rng: () => number): Kit {
  const len = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  let s = 0x2f6b1d3;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    d[i] = s / 2147483648 - 1;
  }
  const softClip = new Float32Array(1024);
  for (let i = 0; i < softClip.length; i++) {
    const x = (i / (softClip.length - 1)) * 2 - 1;
    softClip[i] = Math.tanh(2.6 * x) / Math.tanh(2.6);
  }
  return { ctx, noise, rng, softClip };
}

export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

const EPS = 0.0001;

function osc(k: Kit, type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
  const o = k.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function gain(k: Kit, value = 0): GainNode {
  const g = k.ctx.createGain();
  g.gain.value = value;
  return g;
}

function filter(k: Kit, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = k.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function noise(k: Kit, t: number, dur: number): AudioBufferSourceNode {
  const src = k.ctx.createBufferSource();
  src.buffer = k.noise;
  src.start(t, k.rng() * (k.noise.duration - dur - 0.05));
  src.stop(t + dur);
  return src;
}

function panner(k: Kit, pan: number): AudioNode {
  if (typeof k.ctx.createStereoPanner !== 'function') return gain(k, 1);
  const p = k.ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** Attack to `peak`, then an exponential decay that reaches silence at t + attack + decay. */
function perc(g: AudioParam, t: number, attack: number, peak: number, decay: number): number {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(Math.max(peak, EPS), t + attack);
  g.exponentialRampToValueAtTime(EPS, t + attack + decay);
  g.setValueAtTime(0, t + attack + decay);
  return t + attack + decay;
}

// ---- music voices -------------------------------------------------------------

export type MusicVoice = (k: Kit, out: AudioNode, t: number, freq: number, dur: number, vel: number) => void;

export const bassVoice: MusicVoice = (k, out, t, f, dur, vel) => {
  const end = t + dur + 0.35;
  const g = gain(k);
  const peak = 0.28 * vel;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.012);
  g.gain.setTargetAtTime(peak * 0.55, t + 0.012, 0.12);
  g.gain.setTargetAtTime(0, t + dur, 0.06);
  osc(k, 'sine', f, t, end).connect(g);
  // a little low-passed saw so the bass line still reads on phone and laptop speakers
  const edge = gain(k, 0.32);
  const saw = osc(k, 'sawtooth', f, t, end);
  saw.connect(filter(k, 'lowpass', 520, 0.6)).connect(edge).connect(g);
  g.connect(out);
};

export const pluckVoice: MusicVoice = (k, out, t, f, dur, vel) => {
  const g = gain(k);
  const end = perc(g.gain, t, 0.004, 0.3 * vel, 0.22 + Math.min(dur, 0.35));
  osc(k, 'triangle', f, t, end + 0.02).connect(g);
  const h = gain(k, 0.16);
  osc(k, 'sine', f * 2, t, end + 0.02).connect(h).connect(g);
  g.connect(out);
};

export const counterVoice: MusicVoice = (k, out, t, f, dur, vel) => {
  const g = gain(k);
  const peak = 0.13 * vel;
  const end = t + dur + 0.5;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.09);
  g.gain.setTargetAtTime(peak * 0.75, t + 0.09, 0.3);
  g.gain.setTargetAtTime(0, t + dur, 0.12);
  const o = osc(k, 'sine', f, t, end);
  // A gentle late vibrato makes it sing a little.
  o.detune.setValueAtTime(0, t);
  o.detune.linearRampToValueAtTime(0, t + 0.25);
  for (let i = 0, tt = t + 0.25; tt < t + dur; i++, tt += 0.09) o.detune.linearRampToValueAtTime(i % 2 ? -9 : 9, tt);
  o.connect(g);
  const h = gain(k, 0.12);
  osc(k, 'triangle', f * 2, t, end).connect(h).connect(g);
  g.connect(out);
};

export const padVoice: MusicVoice = (k, out, t, f, dur, vel) => {
  const g = gain(k);
  const peak = 0.035 * vel;
  const end = t + dur + 1.2;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.6);
  g.gain.setTargetAtTime(0, t + dur - 0.05, 0.25);
  for (const cents of [-8, 8]) {
    const o = osc(k, 'sawtooth', f, t, end);
    o.detune.value = cents;
    o.connect(g);
  }
  g.connect(out);
};

export const hatVoice: MusicVoice = (k, out, t, _f, _dur, vel) => {
  const g = gain(k);
  const end = perc(g.gain, t, 0.0015, 0.11 * vel, 0.035 + 0.02 * vel);
  noise(k, t, end - t + 0.01).connect(g);
  g.connect(out);
};

export const arpVoice: MusicVoice = (k, out, t, f, _dur, vel) => {
  const g = gain(k);
  const end = perc(g.gain, t, 0.003, 0.085 * vel, 0.13);
  osc(k, 'triangle', f, t, end + 0.02).connect(g);
  g.connect(out);
};

export const heartVoice: MusicVoice = (k, out, t, _f, _dur, vel) => {
  const g = gain(k);
  const end = perc(g.gain, t, 0.004, 0.5 * vel, 0.24);
  const o = osc(k, 'sine', 92, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
  o.connect(g);
  g.connect(out);
};

// ---- sound effects -------------------------------------------------------------

/** A soft rising "bwip": hop (0) to full jump (1). */
export function jumpSound(k: Kit, out: AudioNode, t: number, strength: number): void {
  const s = Math.max(0, Math.min(1, strength));
  const base = 300 + k.rng() * 30;
  const top = base * (1.5 + 0.7 * s);
  const rise = 0.07 + 0.05 * s;
  const g = gain(k);
  const end = perc(g.gain, t, 0.006, 0.17 + 0.09 * s, 0.13 + 0.1 * s);
  const lp = filter(k, 'lowpass', 2600);
  const o = osc(k, 'sine', base * 0.9, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(top, t + rise);
  o.frequency.exponentialRampToValueAtTime(top * 0.94, end);
  o.connect(g);
  const tri = osc(k, 'triangle', base * 0.9, t, end + 0.02);
  tri.frequency.exponentialRampToValueAtTime(top, t + rise);
  const tg = gain(k, 0.3);
  tri.connect(tg).connect(g);
  g.connect(lp).connect(out);
}

/** A soft squishy thump. */
export function landSound(k: Kit, out: AudioNode, t: number, impact: number): void {
  const i = Math.max(0, Math.min(1, impact));
  const g = gain(k);
  const end = perc(g.gain, t, 0.004, 0.32 + 0.4 * i, 0.12 + 0.08 * i);
  const o = osc(k, 'sine', 150 + 30 * i, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(52, t + 0.12);
  o.connect(g);
  g.connect(out);
  // the squish: a short burst of muffled noise
  const ng = gain(k);
  const nend = perc(ng.gain, t, 0.003, 0.25 * (0.4 + 0.6 * i), 0.06 + 0.04 * i);
  noise(k, t, nend - t + 0.01).connect(filter(k, 'lowpass', 420 + 500 * i, 1.2)).connect(ng).connect(out);
}

/** A cartoon "boing". */
export function springSound(k: Kit, out: AudioNode, t: number): void {
  const g = gain(k);
  const end = perc(g.gain, t, 0.005, 0.26, 0.5);
  const o = osc(k, 'triangle', 170, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(520, t + 0.07);
  o.frequency.exponentialRampToValueAtTime(400, end);
  // wobble: detune swings that die away
  o.detune.setValueAtTime(0, t + 0.07);
  for (let n = 0, tt = t + 0.1; tt < end; n++, tt += 0.035) o.detune.linearRampToValueAtTime((n % 2 ? -1 : 1) * 160 * Math.exp(-(tt - t) * 6), tt);
  const s = gain(k, 0.5);
  const sine = osc(k, 'sine', 170, t, end + 0.02);
  sine.frequency.exponentialRampToValueAtTime(520, t + 0.07);
  sine.frequency.exponentialRampToValueAtTime(400, end);
  sine.connect(s).connect(g);
  o.connect(g);
  g.connect(filter(k, 'lowpass', 2400)).connect(out);
}

/** Crumbling: a few soft gritty ticks over a little tumble. */
export function crumbleSound(k: Kit, out: AudioNode, t: number): void {
  for (let n = 0; n < 5; n++) {
    const tt = t + n * 0.045 + k.rng() * 0.02;
    const g = gain(k);
    const end = perc(g.gain, tt, 0.002, 0.2 * (1 - n * 0.12), 0.05);
    noise(k, tt, end - tt + 0.01).connect(filter(k, 'bandpass', 700 + k.rng() * 900, 2.5)).connect(g).connect(out);
  }
  const g = gain(k);
  const end = perc(g.gain, t, 0.01, 0.16, 0.25);
  const o = osc(k, 'sine', 95, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(55, end);
  o.connect(g).connect(out);
}

/** The Big Press landing; softer and duller further away. */
export function pressSound(k: Kit, out: AudioNode, t: number, distanceTiles: number): void {
  const near = 1 / (1 + Math.max(0, distanceTiles) / 5);
  const g = gain(k);
  const end = perc(g.gain, t, 0.004, 0.6 * near, 0.32);
  const o = osc(k, 'sine', 78, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(36, t + 0.25);
  o.connect(g).connect(out);
  const mid = gain(k);
  const mend = perc(mid.gain, t, 0.003, 0.4 * near, 0.16);
  const m = osc(k, 'triangle', 210, t, mend + 0.02);
  m.frequency.exponentialRampToValueAtTime(95, t + 0.12);
  m.connect(filter(k, 'lowpass', 300 + 900 * near)).connect(mid).connect(out);
  const ng = gain(k);
  const nend = perc(ng.gain, t, 0.002, 0.55 * near, 0.13);
  noise(k, t, nend - t + 0.01).connect(filter(k, 'lowpass', 350 + 1400 * near, 0.9)).connect(ng).connect(out);
}

/** The one heavy hit on death: a woody cartoon "bonk" over a big soft-clipped sub thud. */
export function deathSound(k: Kit, out: AudioNode, t: number): void {
  // sub thud, soft-clipped so phone speakers still feel it
  const sub = gain(k);
  const subEnd = perc(sub.gain, t, 0.003, 1, 0.95);
  const so = osc(k, 'sine', 120, t, subEnd + 0.02);
  so.frequency.exponentialRampToValueAtTime(52, t + 0.12);
  so.frequency.exponentialRampToValueAtTime(34, t + 0.6);
  const shaper = k.ctx.createWaveShaper();
  shaper.curve = k.softClip;
  const post = gain(k, 0.42);
  so.connect(sub).connect(shaper).connect(filter(k, 'lowpass', 900, 0.6)).connect(post).connect(out);

  // body: a round mid thump that carries the weight on small speakers
  const body = gain(k);
  const bodyEnd = perc(body.gain, t, 0.002, 0.8, 0.42);
  const bo = osc(k, 'triangle', 240, t, bodyEnd + 0.02);
  bo.frequency.exponentialRampToValueAtTime(90, t + 0.22);
  bo.connect(filter(k, 'lowpass', 1100, 0.7)).connect(body).connect(out);

  // the bonk: two pitched partials dropping fast
  const bonk = gain(k);
  const bonkEnd = perc(bonk.gain, t, 0.002, 0.85, 0.3);
  const b1 = osc(k, 'sine', 420, t, bonkEnd + 0.02);
  b1.frequency.exponentialRampToValueAtTime(170, t + 0.16);
  b1.connect(bonk);
  const b2g = gain(k, 0.35);
  const b2 = osc(k, 'triangle', 420 * 2.76, t, bonkEnd + 0.02);
  b2.frequency.exponentialRampToValueAtTime(170 * 2.76, t + 0.1);
  b2.connect(b2g).connect(bonk);
  bonk.connect(filter(k, 'lowpass', 2200)).connect(out);

  // impact: a short muffled noise slap
  const ng = gain(k);
  const nend = perc(ng.gain, t, 0.001, 0.7, 0.08);
  noise(k, t, nend - t + 0.01).connect(filter(k, 'lowpass', 1700, 0.8)).connect(ng).connect(out);
}

function clap(k: Kit, out: AudioNode, t: number, level: number, pan: number): void {
  const g = gain(k);
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const tt = t + i * 0.011;
    g.gain.setValueAtTime(level, tt);
    g.gain.exponentialRampToValueAtTime(level * 0.12, tt + 0.009);
  }
  const tail = t + 0.034;
  g.gain.setValueAtTime(level * 0.8, tail);
  g.gain.exponentialRampToValueAtTime(EPS, tail + 0.09);
  g.gain.setValueAtTime(0, tail + 0.09);
  noise(k, t, 0.14).connect(filter(k, 'bandpass', 1000 + k.rng() * 800, 1.3)).connect(g).connect(panner(k, pan)).connect(out);
}

/** A crowd going "yaaay": many formant-filtered voices with rising glides, a breathy roar and claps. */
export function cheerSound(k: Kit, out: AudioNode, t: number, kind: 'zone' | 'record'): void {
  const big = kind === 'record';
  const r = k.rng;
  const bus = gain(k, 1);
  bus.connect(filter(k, 'lowpass', 4200, 0.5)).connect(out);

  const span = big ? 1.9 : 1.6;
  const lfos = [5.2, 6.1, 7.3].map((f) => {
    const o = osc(k, 'sine', f, t, t + span + 0.6);
    const d = gain(k, 20);
    o.connect(d);
    return d;
  });

  const voices = big ? 40 : 30;
  for (let i = 0; i < voices; i++) {
    const st = t + 0.3 * r() ** 1.6;
    const f0 = 118 * 2 ** (r() * 1.75);
    const rise = st + 0.15 + r() * 0.12;
    const end = st + span * (0.55 + r() * 0.4);
    const o = osc(k, 'sawtooth', f0 * 0.75, st, end + 0.05);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.2 + r() * 0.12), rise);
    o.frequency.exponentialRampToValueAtTime(f0 * (0.98 + r() * 0.12), end);
    lfos[i % 3]!.connect(o.detune);
    // "aah" sliding to "ay"; higher voices get slightly higher formants
    const fs = 1 + ((f0 - 118) / 300) * 0.18;
    const f1 = filter(k, 'bandpass', 780 * fs, 4);
    f1.frequency.setValueAtTime(780 * fs, st);
    f1.frequency.linearRampToValueAtTime(540 * fs, rise + 0.15);
    const f2 = filter(k, 'bandpass', 1200 * fs, 6);
    f2.frequency.setValueAtTime(1200 * fs, st);
    f2.frequency.linearRampToValueAtTime(1950 * fs, rise + 0.15);
    const vg = gain(k);
    const peak = (0.11 + r() * 0.07) * (big ? 0.9 : 1);
    vg.gain.setValueAtTime(0, st);
    vg.gain.linearRampToValueAtTime(peak, st + 0.05 + r() * 0.08);
    vg.gain.setTargetAtTime(peak * 0.65, rise, 0.25);
    vg.gain.exponentialRampToValueAtTime(EPS, end);
    vg.gain.setValueAtTime(0, end);
    const f2g = gain(k, 0.7);
    o.connect(f1).connect(vg);
    o.connect(f2).connect(f2g).connect(vg);
    vg.connect(panner(k, (r() * 2 - 1) * 0.85)).connect(bus);
  }

  // breathy roar under the voices
  const ng = gain(k);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(big ? 0.13 : 0.1, t + 0.2);
  ng.gain.setTargetAtTime(0.04, t + 0.35, 0.35);
  ng.gain.exponentialRampToValueAtTime(EPS, t + span);
  ng.gain.setValueAtTime(0, t + span);
  const nf = filter(k, 'bandpass', 900, 0.9);
  nf.frequency.setValueAtTime(900, t);
  nf.frequency.linearRampToValueAtTime(1500, t + 0.3);
  noise(k, t, span + 0.02).connect(nf).connect(ng).connect(bus);

  // claps, thinning out as the cheer fades
  const claps = big ? 22 : 15;
  for (let i = 0; i < claps; i++) {
    const ct = t + 0.1 + (span - 0.3) * r() ** 1.3;
    clap(k, bus, ct, 0.16 + r() * 0.1, (r() * 2 - 1) * 0.8);
  }

  // a "wheee-oo" whistle for beating the record
  if (big) {
    const wt = t + 0.25;
    const wg = gain(k);
    wg.gain.setValueAtTime(0, wt);
    wg.gain.linearRampToValueAtTime(0.05, wt + 0.05);
    wg.gain.setValueAtTime(0.05, wt + 0.5);
    wg.gain.exponentialRampToValueAtTime(EPS, wt + 0.75);
    wg.gain.setValueAtTime(0, wt + 0.75);
    const w = osc(k, 'sine', 1500, wt, wt + 0.8);
    w.frequency.exponentialRampToValueAtTime(2700, wt + 0.3);
    w.frequency.exponentialRampToValueAtTime(2100, wt + 0.72);
    w.connect(wg).connect(bus);
  }
}

// ---- the win -------------------------------------------------------------------

/** One brassy note: two detuned saws and a square through a lowpass that opens with the attack. */
function brass(k: Kit, out: AudioNode, t: number, f: number, dur: number, level: number, pan = 0): void {
  const end = t + dur + 0.25;
  const g = gain(k);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.025);
  g.gain.setTargetAtTime(level * 0.72, t + 0.03, 0.12);
  g.gain.setTargetAtTime(0, t + dur, 0.08);
  const lp = filter(k, 'lowpass', 900, 1.2);
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.linearRampToValueAtTime(3200, t + 0.05);
  lp.frequency.setTargetAtTime(1900, t + 0.06, 0.2);
  for (const [type, mul, det] of [['sawtooth', 1, -7], ['sawtooth', 1, 7], ['square', 0.5, 0]] as const) {
    const o = osc(k, type, f * mul, t, end);
    o.detune.value = det;
    // a little lip-buzz scoop into the note
    o.frequency.setValueAtTime(f * mul * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.04);
    const og = gain(k, type === 'square' ? 0.35 : 0.5);
    o.connect(og).connect(lp);
  }
  lp.connect(g).connect(panner(k, pan)).connect(out);
}

/** A timpani hit: a low sine with a pitch drop and a soft mallet click. */
function timpani(k: Kit, out: AudioNode, t: number, f: number, level: number): void {
  const g = gain(k);
  const end = perc(g.gain, t, 0.004, level, 1.1);
  const o = osc(k, 'sine', f * 1.5, t, end + 0.02);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  o.connect(g).connect(out);
  const ng = gain(k);
  const ne = perc(ng.gain, t, 0.001, level * 0.4, 0.06);
  noise(k, t, ne - t + 0.01).connect(filter(k, 'lowpass', 900, 0.7)).connect(ng).connect(out);
}

/** A cymbal swell into a crash. */
function cymbal(k: Kit, out: AudioNode, t: number, swell: number, level: number): void {
  const g = gain(k);
  g.gain.setValueAtTime(0, t - swell);
  g.gain.linearRampToValueAtTime(level * 0.5, t);
  g.gain.setValueAtTime(level, t + 0.005);
  g.gain.exponentialRampToValueAtTime(EPS, t + 1.8);
  g.gain.setValueAtTime(0, t + 1.8);
  noise(k, t - swell, swell + 1.82).connect(filter(k, 'highpass', 5200, 0.6)).connect(g).connect(out);
}

/** Bright little chimes sprinkled over the top. */
function chime(k: Kit, out: AudioNode, t: number, f: number, level: number, pan: number): void {
  const g = gain(k);
  const end = perc(g.gain, t, 0.003, level, 0.7);
  osc(k, 'triangle', f, t, end + 0.02).connect(g);
  const g2 = gain(k, 0.3);
  osc(k, 'sine', f * 3.01, t, end + 0.02).connect(g2).connect(g);
  g.connect(panner(k, pan)).connect(out);
}

/**
 * The win fanfare (about 3.5 s): timpani, a rising brass call "ta-ta-ta-taaa", an answer,
 * and a big held major chord over a cymbal crash, with chimes sparkling on top.
 */
export function fanfareSound(k: Kit, out: AudioNode, t: number): void {
  const bus = gain(k, 0.9);
  bus.connect(out);
  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, G4 = 392.0, E4 = 329.63, C4 = 261.63;
  timpani(k, bus, t, 98, 0.55);
  timpani(k, bus, t + 0.15, 98, 0.4);
  timpani(k, bus, t + 0.3, 98, 0.45);
  // call
  brass(k, bus, t, G4, 0.12, 0.16, -0.2);
  brass(k, bus, t + 0.15, C5, 0.12, 0.16, -0.1);
  brass(k, bus, t + 0.3, E5, 0.12, 0.16, 0.1);
  brass(k, bus, t + 0.45, G5, 0.42, 0.18, 0.2);
  // answer
  brass(k, bus, t + 0.95, E5, 0.12, 0.15, -0.1);
  brass(k, bus, t + 1.1, G5, 0.12, 0.15, 0.1);
  timpani(k, bus, t + 1.25, 131, 0.6);
  cymbal(k, bus, t + 1.25, 0.35, 0.12);
  // the big chord
  for (const [f, p] of [[C6, 0.25], [G5, 0.1], [E5, -0.1], [C5, -0.25], [G4, 0.2], [E4, -0.2], [C4, 0]] as const) brass(k, bus, t + 1.25, f, 1.9, 0.085, p);
  // chimes
  const arp = [C6, 1318.5, 1568, 2093, 1568, 2093, 2637];
  arp.forEach((f, i) => chime(k, bus, t + 1.35 + i * 0.11, f, 0.07, (i % 3 - 1) * 0.6));
}

/** "Level up": a rising whoosh into a bright chord stab and a chime run. */
export function levelUpSound(k: Kit, out: AudioNode, t: number): void {
  const bus = gain(k, 0.9);
  bus.connect(out);
  // whoosh
  const wg = gain(k);
  wg.gain.setValueAtTime(0, t);
  wg.gain.linearRampToValueAtTime(0.22, t + 0.5);
  wg.gain.exponentialRampToValueAtTime(EPS, t + 0.75);
  wg.gain.setValueAtTime(0, t + 0.75);
  const bp = filter(k, 'bandpass', 300, 2.5);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(4200, t + 0.6);
  noise(k, t, 0.8).connect(bp).connect(wg).connect(bus);
  // rising glide
  const sg = gain(k);
  const send = perc(sg.gain, t, 0.45, 0.07, 0.25);
  const so = osc(k, 'triangle', 220, t, send + 0.02);
  so.frequency.exponentialRampToValueAtTime(880, t + 0.6);
  so.connect(sg).connect(bus);
  // stab: D major, bright
  const s0 = t + 0.62;
  for (const [f, p] of [[587.33, -0.2], [739.99, 0], [880, 0.2], [1174.66, 0.1]] as const) brass(k, bus, s0, f, 0.55, 0.09, p);
  timpani(k, bus, s0, 147, 0.5);
  cymbal(k, bus, s0, 0.05, 0.08);
  [1174.66, 1479.98, 1760, 2349.3].forEach((f, i) => chime(k, bus, s0 + 0.12 + i * 0.09, f, 0.08, (i % 2 ? 0.5 : -0.5)));
}
