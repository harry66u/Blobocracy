import { makeEntity, type Wind } from '@blobocracy/shared';
import { describe, expect, test } from 'vitest';
import { windParticles, windStrength, windWarning } from '../src/render/entities.ts';

// A 12x6 region at (20, 4) gusting left for 1 s of every 3 s.
const wind = makeEntity({ kind: 'wind', w: 12, h: 6, push: -4, period: 3, gustS: 1 }, 0, 20, 4) as Wind;

describe('wind rendering', () => {
  test('strength follows the gust schedule and warns just before a gust', () => {
    expect(windStrength(wind, 0.5)).toBe(1);
    expect(windStrength(wind, 2)).toBe(0);
    expect(windWarning(wind, 2)).toBe(0);
    expect(windWarning(wind, 2.8)).toBeGreaterThan(0.5);
    expect(windWarning(wind, 0.5)).toBe(0);
  });

  test('streaks stay inside the region and point the way it blows', () => {
    const { streaks, leaves } = windParticles(wind, 0.5, 12.3, false);
    expect(streaks.length).toBeGreaterThan(3);
    expect(leaves.length).toBeGreaterThan(0);
    for (const s of streaks) {
      expect(s.dir).toBe(-1);
      expect(s.x).toBeGreaterThanOrEqual(20);
      expect(s.x).toBeLessThanOrEqual(32);
      expect(s.y).toBeGreaterThanOrEqual(4);
      expect(s.y).toBeLessThanOrEqual(10);
    }
  });

  test('a gust shows much more than a calm, and calm still hints the direction', () => {
    const sum = (t: number) => windParticles(wind, t, 5, false).streaks.reduce((a, s) => a + s.alpha, 0);
    expect(sum(0.5)).toBeGreaterThan(sum(2) * 3);
    expect(sum(2)).toBeGreaterThan(0);
    expect(windParticles(wind, 2, 5, false).leaves).toEqual([]);
  });

  test('streaks drift with wall time, but hold still with reduced motion (and no leaves)', () => {
    const a = windParticles(wind, 0.5, 1, false).streaks.map((s) => s.x);
    const b = windParticles(wind, 0.5, 1.2, false).streaks.map((s) => s.x);
    expect(a).not.toEqual(b);
    const ra = windParticles(wind, 0.5, 1, true);
    const rb = windParticles(wind, 0.5, 1.2, true);
    expect(ra.streaks).toEqual(rb.streaks);
    expect(ra.leaves).toEqual([]);
  });
});
