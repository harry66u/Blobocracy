// Pure, seeded music composition: each zone gets a style (tempo, key, layers) and an
// 8-bar loop of notes per layer. Deterministic per seed, so the loop sounds composed.

export const LAYERS = ['bass', 'pluck', 'hats', 'pad', 'counter', 'arp', 'heart'] as const;
export type Layer = (typeof LAYERS)[number];
export const ZONE_COUNT = 6;

export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];

export interface ZoneStyle {
  bpm: number;
  /** MIDI note of the key's root (C3 = 48). */
  root: number;
  mode: 'major' | 'minor';
  layers: Layer[];
  /** 0..~0.2: how much on-beat sixteenths are lengthened. */
  swing: number;
  /** Music bus low-pass cutoff in Hz: later zones get brighter. */
  brightness: number;
  /** Music bus gain multiplier: later zones push a little harder. */
  energy: number;
  /** Probability of a melody note on each eighth. */
  density: number;
}

const STYLES: ZoneStyle[] = [
  { bpm: 96, root: 48, mode: 'major', layers: ['bass', 'pluck'], swing: 0.14, brightness: 2400, energy: 0.9, density: 0.34 },
  { bpm: 100, root: 48, mode: 'major', layers: ['bass', 'pluck', 'hats'], swing: 0.14, brightness: 2800, energy: 0.93, density: 0.4 },
  { bpm: 104, root: 50, mode: 'major', layers: ['bass', 'pluck', 'hats', 'pad'], swing: 0.12, brightness: 3200, energy: 0.96, density: 0.42 },
  { bpm: 108, root: 50, mode: 'major', layers: ['bass', 'pluck', 'hats', 'pad', 'counter'], swing: 0.1, brightness: 3600, energy: 1, density: 0.46 },
  { bpm: 116, root: 50, mode: 'minor', layers: ['bass', 'pluck', 'hats', 'pad', 'counter', 'arp'], swing: 0.06, brightness: 4000, energy: 1.02, density: 0.5 },
  { bpm: 124, root: 50, mode: 'minor', layers: ['bass', 'pluck', 'hats', 'pad', 'counter', 'arp', 'heart'], swing: 0.04, brightness: 4400, energy: 1.06, density: 0.54 },
];

export function clampZone(zone: number): number {
  if (!Number.isFinite(zone)) return 0;
  return Math.max(0, Math.min(ZONE_COUNT - 1, Math.floor(zone)));
}

export function zoneStyle(zone: number): ZoneStyle {
  return STYLES[clampZone(zone)]!;
}

/** Small fast seeded PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seconds for one sixteenth at `bpm`; swing lengthens even steps and shortens odd ones. */
export function stepSeconds(bpm: number, step: number, swing: number): number {
  const base = 60 / bpm / 4;
  return step % 2 === 0 ? base * (1 + swing) : base * (1 - swing);
}

export interface NoteEvent {
  /** Sixteenth index within the loop. */
  step: number;
  midi: number;
  /** Length in sixteenths. */
  len: number;
  /** 0..1 */
  vel: number;
}

export interface ZonePattern {
  zone: number;
  bpm: number;
  bars: number;
  stepsPerBar: number;
  root: number;
  mode: 'major' | 'minor';
  /** Chord tones (MIDI, pad register) for each bar. */
  chords: number[][];
  tracks: Partial<Record<Layer, NoteEvent[]>>;
}

type Chord = [offset: number, quality: 'M' | 'm'];
const MAJOR_PROGS: Chord[][] = [
  [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], // I V vi IV
  [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']], // I vi IV V
  [[0, 'M'], [5, 'M'], [9, 'm'], [7, 'M']], // I IV vi V
];
const MAJOR_TURN: Chord[] = [[5, 'M'], [7, 'M']]; // IV V at the end of the B half
const MINOR_PROGS: Chord[][] = [
  [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], // i VI III VII
  [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']], // i iv VI V
  [[0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']], // i VI iv V
];
const MINOR_TURN: Chord[] = [[5, 'm'], [7, 'M']]; // iv V: the tense turnaround

const BARS = 8;
const SPB = 16;

const pc = (n: number) => ((n % 12) + 12) % 12;

function chordPcs(key: number, [off, q]: Chord): number[] {
  return [0, q === 'M' ? 4 : 3, 7].map((i) => pc(key + off + i));
}

/** All MIDI notes in [lo, hi] whose pitch class is in `pcs`. */
function notesIn(pcs: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) if (pcs.includes(pc(n))) out.push(n);
  return out;
}

function nearest(pool: number[], target: number): number {
  let best = pool[0]!;
  for (const n of pool) if (Math.abs(n - target) < Math.abs(best - target)) best = n;
  return best;
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

export function generatePattern(zone: number, seed: number): ZonePattern {
  const z = clampZone(zone);
  const style = zoneStyle(z);
  // Mix the zone into the seed so zones that share a key still differ.
  const rng = mulberry32((seed ^ Math.imul(z + 1, 0x9e3779b1)) >>> 0);
  const key = style.root;
  const scale = style.mode === 'major' ? MAJOR : MINOR;
  const scalePcs = scale.map((s) => pc(key + s));

  const progA = pick(rng, style.mode === 'major' ? MAJOR_PROGS : MINOR_PROGS);
  const progB: Chord[] = [progA[0]!, progA[1]!, ...(style.mode === 'major' ? MAJOR_TURN : MINOR_TURN)];
  const prog = [...progA, ...progB];

  const tracks: Partial<Record<Layer, NoteEvent[]>> = {};
  const has = (l: Layer) => style.layers.includes(l);

  // Pad register chords (also used as the harmony reference for other layers).
  const chords = prog.map((c) => {
    const pcs = chordPcs(key, c);
    return notesIn(pcs, key + 2, key + 13).slice(0, 3);
  });

  // ---- bass ----------------------------------------------------------------
  {
    type Hit = [step: number, interval: 0 | 7 | 12, len: number];
    const sparse: Hit[][] = [
      [[0, 0, 7], [10, 7, 2], [12, 0, 4]],
      [[0, 0, 6], [8, 7, 6]],
    ];
    const busy: Hit[][] = [
      [[0, 0, 6], [6, 0, 2], [8, 7, 4], [12, 12, 3]],
      [[0, 0, 3], [3, 0, 3], [8, 7, 3], [11, 0, 2], [14, 7, 2]],
      [[0, 0, 5], [6, 7, 2], [8, 0, 4], [12, 7, 2], [14, 12, 2]],
    ];
    const motif = pick(rng, z < 2 ? sparse : busy);
    const notes: NoteEvent[] = [];
    prog.forEach((c, bar) => {
      const r = key - 12 + c[0];
      for (const [s, iv, len] of motif) {
        // Leave room for an approach note at the end of each 4-bar phrase.
        if ((bar === 3 || bar === 7) && s >= 12) continue;
        notes.push({ step: bar * SPB + s, midi: r + iv, len, vel: s === 0 ? 1 : 0.75 });
      }
      if (bar === 3 || bar === 7) {
        const next = prog[(bar + 1) % BARS]!;
        const target = key - 12 + next[0];
        const below = notesIn(scalePcs, target - 3, target - 1);
        notes.push({ step: bar * SPB + 12, midi: r + 7, len: 2, vel: 0.7 });
        notes.push({ step: bar * SPB + 14, midi: below[below.length - 1] ?? target, len: 2, vel: 0.8 });
      }
    });
    tracks.bass = notes;
  }

  // ---- pluck melody: a 2-bar motif, repeated with small variations ------------
  {
    const pool = notesIn(scalePcs, key + 12, key + 28);
    const makeRhythm = (): { step: number; move: number }[] => {
      const out: { step: number; move: number }[] = [];
      for (let s = 0; s < 2 * SPB; s += 2) {
        const strong = s % 8 === 0;
        if (s === 0 || rng() < style.density * (strong ? 1.5 : 1)) out.push({ step: s, move: pick(rng, [-2, -1, -1, 1, 1, 2, 0]) });
        // A sixteenth pickup now and then in the busier zones.
        if (z >= 3 && s % 8 === 6 && rng() < 0.25) out.push({ step: s + 1, move: pick(rng, [-1, 1]) });
      }
      return out;
    };
    const vary = (m: { step: number; move: number }[]) =>
      m.map((n) => (rng() < 0.3 ? { step: n.step, move: pick(rng, [-2, -1, 1, 2]) } : n));
    const motifA = makeRhythm();
    const motifs = [motifA, vary(motifA), motifA, vary(motifA)];
    const notes: NoteEvent[] = [];
    let idx = Math.floor(pool.length / 2);
    motifs.forEach((motif, half) => {
      motif.forEach((n, i) => {
        const step = half * 2 * SPB + n.step;
        const bar = Math.floor(step / SPB);
        const chordNotes = notesIn(chordPcs(key, prog[bar]!), key + 12, key + 28);
        idx = Math.max(0, Math.min(pool.length - 1, idx + n.move));
        let midi = pool[idx]!;
        if (step % 8 === 0) {
          midi = nearest(chordNotes, midi); // anchor strong beats on chord tones
          idx = pool.indexOf(midi);
        }
        const nextStep = motif[i + 1]?.step ?? 2 * SPB;
        const len = Math.max(1, Math.min(4, nextStep - n.step));
        notes.push({ step, midi, len, vel: step % 8 === 0 ? 0.95 : step % 4 === 0 ? 0.8 : 0.65 });
      });
    });
    tracks.pluck = notes;
  }

  // ---- hats ---------------------------------------------------------------
  if (has('hats')) {
    const notes: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      for (let s = 0; s < SPB; s += 2) {
        const off = s % 4 === 2;
        if (!off && rng() < 0.35) continue;
        notes.push({ step: bar * SPB + s, midi: 84, len: 1, vel: off ? 0.8 : 0.4 });
      }
      if (z >= 3) for (let s = 1; s < SPB; s += 2) if (rng() < 0.22) notes.push({ step: bar * SPB + s, midi: 84, len: 1, vel: 0.25 });
    }
    notes.sort((a, b) => a.step - b.step);
    tracks.hats = notes;
  }

  // ---- pad: one held chord per bar ------------------------------------------
  if (has('pad')) {
    tracks.pad = chords.flatMap((tones, bar) => tones.map((midi) => ({ step: bar * SPB, midi, len: SPB, vel: 0.8 })));
  }

  // ---- counter-melody: long soft notes on the chord's 3rd/5th ----------------
  if (has('counter')) {
    const offbeat = rng() < 0.5;
    const notes: NoteEvent[] = [];
    let prev = key + 16;
    prog.forEach((c, bar) => {
      const tones = notesIn(chordPcs(key, c), key + 7, key + 21).filter((n) => pc(n) !== pc(key + c[0]));
      for (const s of offbeat ? [4, 12] : [0, 8]) {
        const cand = tones.filter((n) => n !== prev);
        prev = nearest(cand.length ? cand : tones, prev + pick(rng, [-2, 0, 2]));
        notes.push({ step: bar * SPB + s, midi: prev, len: 7, vel: 0.85 });
      }
    });
    tracks.counter = notes;
  }

  // ---- arp: sixteenth arpeggios through the chord ------------------------------
  if (has('arp')) {
    const shape = pick(rng, [[0, 1, 2, 3], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3]]);
    const notes: NoteEvent[] = [];
    prog.forEach((c, bar) => {
      const tones = notesIn(chordPcs(key, c), key + 12, key + 26).slice(0, 4);
      for (let s = 0; s < SPB; s++) {
        if (s % 2 === 1 && rng() < 0.15) continue;
        const midi = tones[shape[s % shape.length]! % tones.length]!;
        notes.push({ step: bar * SPB + s, midi, len: 1, vel: s % 4 === 0 ? 0.9 : 0.55 });
      }
    });
    tracks.arp = notes;
  }

  // ---- heart: lub-dub twice a bar ----------------------------------------------
  if (has('heart')) {
    const notes: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      for (const [s, v] of [[0, 1], [2, 0.6], [8, 1], [10, 0.6]] as const) notes.push({ step: bar * SPB + s, midi: key - 12, len: 2, vel: v });
    }
    tracks.heart = notes;
  }

  return { zone: z, bpm: style.bpm, bars: BARS, stepsPerBar: SPB, root: key, mode: style.mode, chords, tracks };
}
