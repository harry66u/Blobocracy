import { describe, expect, test } from 'vitest';
import {
  BANNER_S, bannerFrame, CAUSE_LINES, DEATH_CARD_AT, DEATH_COUNTER_AT, DEATH_FREEZE_S, deathFx, deathLine, flipFrame, FLIP_S,
  swoopDuration, swoopFrame,
} from '../src/moments.ts';

const CAUSES = ['spikes', 'ceiling spikes', 'pit', 'press', 'saw', 'chomp'] as const;

describe('death line', () => {
  test('every cause has at least three phrasings, each a "then ..." clause ending in a full stop', () => {
    for (const c of CAUSES) {
      const lines = CAUSE_LINES[c];
      expect(lines.length).toBeGreaterThanOrEqual(3);
      for (const l of lines) expect(l).toMatch(/^then .+\.$/);
      expect(new Set(lines).size).toBe(lines.length);
    }
  });
  test('the same run always gets the same line', () => {
    for (const c of CAUSES) expect(deathLine(c, 4812)).toBe(deathLine(c, 4812));
  });
  test('consecutive runs dying the same way do not all read the same', () => {
    for (const c of CAUSES) {
      const seen = new Set<string>();
      for (let run = 100; run < 112; run++) seen.add(deathLine(c, run));
      expect(seen.size).toBeGreaterThanOrEqual(3);
    }
  });
  test('two runs in a row never repeat the exact line', () => {
    for (const c of CAUSES) for (let run = 1; run < 300; run++) expect(deathLine(c, run)).not.toBe(deathLine(c, run + 1));
  });
  test('names the hazard the way the HUD and the spec do', () => {
    expect(CAUSE_LINES.press.some((l) => l === 'then the Big Press flattened it.')).toBe(true);
    expect(CAUSE_LINES.pit.some((l) => l === 'then the Pit swallowed it whole.')).toBe(true);
    expect(CAUSE_LINES.saw.some((l) => l === 'then a Saw got it.')).toBe(true);
    for (const l of CAUSE_LINES.chomp) expect(l).toContain('Big Chomp');
  });
  test('an unknown cause still makes a sentence', () => {
    expect(deathLine('lava', 3)).toMatch(/^then .+\.$/);
  });
});

describe('death timeline', () => {
  test('freezes for the first half second only', () => {
    expect(DEATH_FREEZE_S).toBe(0.5);
    expect(deathFx(0, false).freeze).toBe(true);
    expect(deathFx(0.49, false).freeze).toBe(true);
    expect(deathFx(0.51, false).freeze).toBe(false);
  });
  test('counter flips during the freeze, the card arrives as it ends', () => {
    expect(DEATH_COUNTER_AT).toBeGreaterThan(0);
    expect(DEATH_COUNTER_AT).toBeLessThan(DEATH_FREEZE_S);
    expect(DEATH_CARD_AT).toBeGreaterThanOrEqual(DEATH_FREEZE_S - 0.1);
  });
  test('flash is bright on impact and gone quickly', () => {
    expect(deathFx(0, false).flash).toBeGreaterThan(0.3);
    expect(deathFx(0.4, false).flash).toBe(0);
  });
  test('shake decays to nothing, and never happens with reduced motion', () => {
    expect(deathFx(0.02, false).shake).toBeGreaterThan(0);
    expect(deathFx(0.6, false).shake).toBe(0);
    for (const t of [0, 0.02, 0.1, 0.3]) expect(deathFx(t, true).shake).toBe(0);
  });
  test('reduced motion swaps the white flash for a softer one', () => {
    expect(deathFx(0, true).flash).toBeLessThan(deathFx(0, false).flash);
  });
  test('vignette fades in and holds through the death', () => {
    expect(deathFx(0, false).vignette).toBeLessThan(deathFx(1, false).vignette);
    expect(deathFx(3, false).vignette).toBeGreaterThan(0.3);
  });
});

describe('split-flap flip', () => {
  test('starts with the old digit whole and ends with the new digit whole', () => {
    const a = flipFrame(0, false);
    expect(a.top).toBe(1);
    expect(a.bottom).toBe(0);
    const z = flipFrame(FLIP_S + 1, false);
    expect(z.done).toBe(true);
    expect(z.bottom).toBe(1);
    expect(z.top).toBe(0);
    expect(z.bounce).toBe(0);
  });
  test('the top flap folds down first, then the bottom flap falls into place', () => {
    const q1 = flipFrame(FLIP_S * 0.25, false);
    expect(q1.top).toBeGreaterThan(0);
    expect(q1.top).toBeLessThan(1);
    expect(q1.bottom).toBe(0);
    const q3 = flipFrame(FLIP_S * 0.75, false);
    expect(q3.top).toBe(0);
    expect(q3.bottom).toBeGreaterThan(0);
    expect(q3.bottom).toBeLessThan(1);
  });
  test('the fold is monotonic', () => {
    let prevTop = 2, prevBottom = -1;
    for (let t = 0; t <= FLIP_S; t += FLIP_S / 40) {
      const f = flipFrame(t, false);
      expect(f.top).toBeLessThanOrEqual(prevTop);
      expect(f.bottom).toBeGreaterThanOrEqual(prevBottom);
      prevTop = f.top; prevBottom = f.bottom;
    }
  });
  test('it settles with a bounce, but not with reduced motion', () => {
    let maxBounce = 0;
    for (let t = FLIP_S; t < FLIP_S + 0.5; t += 0.01) maxBounce = Math.max(maxBounce, Math.abs(flipFrame(t, false).bounce));
    expect(maxBounce).toBeGreaterThan(0.03);
    for (let t = 0; t < FLIP_S + 0.5; t += 0.01) expect(flipFrame(t, true).bounce).toBe(0);
  });
  test('reduced motion crossfades instead of folding', () => {
    const f = flipFrame(FLIP_S * 0.5, true);
    expect(f.fade).toBeGreaterThan(0);
    expect(f.fade).toBeLessThan(1);
  });
});

describe('zone banner', () => {
  test('lasts about 2.2 s', () => {
    expect(BANNER_S).toBeCloseTo(2.2, 5);
    expect(bannerFrame(-0.01, false).visible).toBe(false);
    expect(bannerFrame(0.01, false).visible).toBe(true);
    expect(bannerFrame(BANNER_S + 0.01, false).visible).toBe(false);
  });
  test('drops in from above, overshoots, rests, then leaves upward', () => {
    expect(bannerFrame(0.02, false).y).toBeLessThan(-0.5);
    let overshoot = false;
    for (let t = 0; t < 0.7; t += 0.01) if (bannerFrame(t, false).y > 0.01) overshoot = true;
    expect(overshoot).toBe(true);
    expect(Math.abs(bannerFrame(1.2, false).y)).toBeLessThan(0.01);
    expect(bannerFrame(BANNER_S - 0.05, false).y).toBeLessThan(-0.3);
  });
  test('reduced motion fades in place', () => {
    for (const t of [0.05, 0.3, 1.2, 2.1]) expect(bannerFrame(t, true).y).toBe(0);
    expect(bannerFrame(0.05, true).alpha).toBeLessThan(1);
    expect(bannerFrame(1.2, true).alpha).toBe(1);
    expect(bannerFrame(2.15, true).alpha).toBeLessThan(1);
  });
});

describe('swoop back to the start', () => {
  test('longer trips take longer, within sane bounds', () => {
    expect(swoopDuration(5, false)).toBeLessThan(swoopDuration(300, false));
    expect(swoopDuration(0, false)).toBeGreaterThanOrEqual(0.5);
    expect(swoopDuration(10000, false)).toBeLessThanOrEqual(1.8);
  });
  test('eases from 0 to 1, moving fastest in the middle', () => {
    const d = 1.2;
    expect(swoopFrame(0, d, false).k).toBe(0);
    expect(swoopFrame(d, d, false).k).toBe(1);
    expect(swoopFrame(d * 2, d, false).done).toBe(true);
    const step = (t: number) => swoopFrame(t + 0.01, d, false).k - swoopFrame(t, d, false).k;
    expect(step(d / 2)).toBeGreaterThan(step(0.02));
    expect(step(d / 2)).toBeGreaterThan(step(d - 0.03));
  });
  test('reduced motion fades out, cuts, and fades back in', () => {
    const d = swoopDuration(200, true);
    expect(swoopFrame(0.01, d, true).k).toBe(0);
    expect(swoopFrame(d * 0.25, d, true).fade).toBeGreaterThan(0.3);
    expect(swoopFrame(d * 0.75, d, true).k).toBe(1);
    expect(swoopFrame(d, d, true).fade).toBe(0);
  });
});
