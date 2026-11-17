import { describe, expect, test } from 'vitest';
import { generatePattern, LAYERS, MAJOR, mulberry32, stepSeconds, zoneStyle, ZONE_COUNT } from '../src/audio/patterns';
import { RateLimiter } from '../src/audio/ratelimit';
import { loadMuted, MUTED_KEY, saveMuted, type StorageLike } from '../src/audio/prefs';
import { glideBpm, layerTargets, planCrossfade, rampValue } from '../src/audio/crossfade';
import { createGameAudio } from '../src/audio';

describe('music patterns', () => {
  test('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(7), b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  test('the same seed gives the same pattern; another seed gives a different one', () => {
    for (let z = 0; z < ZONE_COUNT; z++) {
      expect(generatePattern(z, 42)).toEqual(generatePattern(z, 42));
    }
    expect(generatePattern(3, 42)).not.toEqual(generatePattern(3, 43));
  });

  test('layer count rises with every zone, and each layer has notes', () => {
    let prev = 0;
    for (let z = 0; z < ZONE_COUNT; z++) {
      const style = zoneStyle(z);
      expect(style.layers.length).toBeGreaterThan(prev);
      prev = style.layers.length;
      const p = generatePattern(z, 1);
      expect(Object.keys(p.tracks).sort()).toEqual([...style.layers].sort());
      for (const layer of style.layers) expect(p.tracks[layer]!.length).toBeGreaterThan(0);
    }
    expect(zoneStyle(0).layers).toEqual(['bass', 'pluck']);
    expect(zoneStyle(5).layers).toContain('heart');
    expect(new Set(LAYERS).size).toBe(LAYERS.length);
  });

  test('tempo never drops and is clearly faster in the night zones; night turns minor', () => {
    for (let z = 1; z < ZONE_COUNT; z++) expect(zoneStyle(z).bpm).toBeGreaterThanOrEqual(zoneStyle(z - 1).bpm);
    expect(zoneStyle(5).bpm).toBeGreaterThan(zoneStyle(0).bpm + 15);
    expect(zoneStyle(0).mode).toBe('major');
    expect(zoneStyle(4).mode).toBe('minor');
    expect(zoneStyle(5).mode).toBe('minor');
  });

  test('out-of-range zones clamp', () => {
    expect(zoneStyle(-3)).toEqual(zoneStyle(0));
    expect(zoneStyle(99)).toEqual(zoneStyle(5));
    expect(zoneStyle(Number.NaN)).toEqual(zoneStyle(0));
    expect(zoneStyle(2.7)).toEqual(zoneStyle(2));
  });

  test('notes fit the loop, have sane pitch and velocity, and early zones stay diatonic', () => {
    for (let z = 0; z < ZONE_COUNT; z++) {
      const p = generatePattern(z, 9);
      const total = p.bars * p.stepsPerBar;
      for (const notes of Object.values(p.tracks)) {
        for (const n of notes!) {
          expect(Number.isInteger(n.step)).toBe(true);
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(total);
          expect(n.len).toBeGreaterThan(0);
          expect(n.midi).toBeGreaterThanOrEqual(24);
          expect(n.midi).toBeLessThanOrEqual(96);
          expect(n.vel).toBeGreaterThan(0);
          expect(n.vel).toBeLessThanOrEqual(1);
        }
      }
    }
    const p0 = generatePattern(0, 9);
    const root = zoneStyle(0).root;
    for (const n of [...p0.tracks.bass!, ...p0.tracks.pluck!]) {
      expect(MAJOR).toContain((((n.midi - root) % 12) + 12) % 12);
    }
  });

  test('swing lengthens on-beats and shortens off-beats but keeps pairs on the grid', () => {
    const base = 60 / 120 / 4;
    expect(stepSeconds(120, 0, 0)).toBeCloseTo(base);
    const on = stepSeconds(120, 0, 0.2), off = stepSeconds(120, 1, 0.2);
    expect(on).toBeGreaterThan(off);
    expect(on + off).toBeCloseTo(2 * base);
  });
});

describe('RateLimiter', () => {
  test('allows a sound at most once per interval, per key', () => {
    const rl = new RateLimiter({ jump: 0.08 });
    expect(rl.allow('jump', 10)).toBe(true);
    expect(rl.allow('jump', 10.05)).toBe(false);
    expect(rl.allow('jump', 10.079)).toBe(false);
    expect(rl.allow('jump', 10.081)).toBe(true);
    expect(rl.allow('land', 10.081)).toBe(true); // independent key, default interval
  });
  test('refused calls do not extend the window', () => {
    const rl = new RateLimiter({ jump: 0.08 });
    rl.allow('jump', 0);
    for (let t = 0.01; t < 0.08; t += 0.01) rl.allow('jump', t);
    expect(rl.allow('jump', 0.0801)).toBe(true);
  });
  test('reset() forgets history', () => {
    const rl = new RateLimiter({ death: 1 });
    rl.allow('death', 5);
    rl.reset();
    expect(rl.allow('death', 5.1)).toBe(true);
  });
});

describe('mute persistence', () => {
  const fake = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  test('defaults to unmuted', () => {
    expect(loadMuted(fake())).toBe(false);
    expect(loadMuted(null)).toBe(false);
  });
  test('round-trips through the blob.muted key', () => {
    const s = fake();
    saveMuted(s, true);
    expect(MUTED_KEY).toBe('blob.muted');
    expect(s.data.get('blob.muted')).toBe('1');
    expect(loadMuted(s)).toBe(true);
    saveMuted(s, false);
    expect(loadMuted(s)).toBe(false);
  });
  test('a throwing storage never throws', () => {
    const bad: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(loadMuted(bad)).toBe(false);
    expect(() => saveMuted(bad, true)).not.toThrow();
  });
});

describe('zone crossfade', () => {
  test('targets are 1 for the zone layers and 0 for the rest', () => {
    const t0 = layerTargets(0);
    expect(t0.bass).toBe(1);
    expect(t0.pluck).toBe(1);
    expect(t0.hats).toBe(0);
    expect(t0.heart).toBe(0);
    expect(Object.values(layerTargets(5)).filter((v) => v === 1).length).toBe(zoneStyle(5).layers.length);
  });

  test('moving up a zone fades in only the new layers over the fade time', () => {
    const ramps = planCrossfade(layerTargets(0), 1, 10, 2);
    expect(ramps).toEqual([{ layer: 'hats', from: 0, to: 1, start: 10, end: 12 }]);
    const r = ramps[0]!;
    expect(rampValue(r, 9)).toBe(0);
    expect(rampValue(r, 11)).toBeCloseTo(0.5);
    expect(rampValue(r, 12)).toBe(1);
    expect(rampValue(r, 30)).toBe(1);
  });

  test('going back fades layers out, and an interrupted fade starts where it was', () => {
    const mid = { ...layerTargets(0), hats: 0.4 };
    const ramps = planCrossfade(mid, 0, 3, 2);
    expect(ramps).toEqual([{ layer: 'hats', from: 0.4, to: 0, start: 3, end: 5 }]);
    expect(planCrossfade(layerTargets(2), 2, 0, 2)).toEqual([]);
  });

  test('tempo glides linearly to the target over the fade time and never overshoots', () => {
    let bpm = 100;
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) { bpm = glideBpm(bpm, 120, 100, 0.1, 2); seen.push(bpm); }
    expect(seen[9]).toBeCloseTo(110); // half way after 1 s
    expect(seen[19]).toBeCloseTo(120);
    expect(Math.max(...seen)).toBe(120);
    expect(glideBpm(130, 120, 130, 1, 2)).toBeCloseTo(125); // also glides down
  });
});

describe('createGameAudio without Web Audio', () => {
  test('every call is a safe no-op, and mute is still remembered', () => {
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const data = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const audio = createGameAudio({ storage });
    expect(audio.muted).toBe(false);
    expect(() => {
      audio.unlock();
      audio.unlock();
      audio.setZone(3);
      audio.setCrowd(120, 0.5);
      audio.jump(1);
      audio.land(0.5);
      audio.spring();
      audio.crumble();
      audio.pressSlam(4);
      audio.sawNear(0.7);
      audio.cheer('record');
      audio.death();
      audio.resetToStart();
      audio.tick();
      audio.setMuted(true);
    }).not.toThrow();
    expect(audio.muted).toBe(true);
    expect(data.get('blob.muted')).toBe('1');
    expect(createGameAudio({ storage }).muted).toBe(true);
  });
});
