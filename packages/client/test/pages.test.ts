import { describe, expect, test } from 'vitest';
import { nearestIndex, niceTicks, plotRect, recordSteps, runAt, xOf, yOf, type Point } from '../src/pages/chart.ts';
import { duration, flipChars, killerName, pageList, relTime } from '../src/pages/format.ts';
import { hazardIcon } from '../src/pages/icons.ts';

const NOW = Date.UTC(2026, 10, 17, 12);

describe('history page formatting', () => {
  test('durations', () => {
    expect(duration(4_000)).toBe('0:04');
    expect(duration(134_400)).toBe('2:14');
    expect(duration(3_729_000)).toBe('1:02:09');
    expect(duration(-5)).toBe('0:00');
  });
  test('relative times', () => {
    expect(relTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relTime(NOW - 60_000, NOW)).toBe('a minute ago');
    expect(relTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(relTime(NOW - 3 * 3600_000, NOW)).toBe('3 hours ago');
    expect(relTime(NOW - 26 * 3600_000, NOW)).toBe('yesterday');
    expect(relTime(NOW - 4 * 86400_000, NOW)).toBe('4 days ago');
    expect(relTime(Date.UTC(2026, 0, 3, 12), NOW)).toBe('Jan 3');
    expect(relTime(Date.UTC(2025, 0, 3, 12), NOW)).toBe('Jan 3, 2025');
  });
  test('killers and flip cards', () => {
    expect(killerName('press')).toBe('Big Press');
    expect(killerName('ceiling spikes')).toBe('Ceiling Spikes');
    expect(killerName('win')).toBe('The finish!');
    expect(flipChars(4812)).toEqual(['4', ',', '8', '1', '2']);
  });
  test('page numbers around the current page', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 80)).toEqual([1, 2, null, 80]);
    expect(pageList(6, 80)).toEqual([1, null, 5, 6, 7, null, 80]);
    expect(pageList(3, 80)).toEqual([1, 2, 3, 4, null, 80]); // no "…" standing in for one page
    expect(pageList(80, 80, 2)).toEqual([1, null, 78, 79, 80]);
  });
  test('every cause has an icon in the hazard language, labelled', () => {
    for (const c of ['spikes', 'ceiling spikes', 'pit', 'press', 'saw', 'chomp', 'win', 'mystery']) {
      const svg = hazardIcon(c, `killed by ${c}`);
      expect(svg).toMatch(/^<svg class="hz"/);
      expect(svg).toContain(`aria-label="killed by ${c}"`);
    }
    expect(hazardIcon('press', '')).toContain('#FF3B7A');
  });
});

describe('the chart', () => {
  test('nice ticks', () => {
    expect(niceTicks(1, 2000, 7)).toEqual([500, 1000, 1500, 2000]);
    expect(niceTicks(0, 1000, 4)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(1, 10, 3)).toEqual([5, 10]);
    expect(niceTicks(5, 5, 3)).toEqual([5]);
  });
  test('the record staircase goes flat, then up, and runs on to the latest run', () => {
    const recs: Point[] = [[1, 0.1, 0], [5, 0.3, 0], [9, 0.32, 0]];
    expect(recordSteps(recs, 20)).toEqual([[1, 0.1], [5, 0.1], [5, 0.3], [9, 0.3], [9, 0.32], [20, 0.32]]);
    expect(recordSteps([], 20)).toEqual([]);
  });
  test('nearest point to a run', () => {
    const s: Point[] = [[1, 0, 0], [4, 0, 0], [10, 0, 0]];
    expect(nearestIndex(s, 0)).toBe(0);
    expect(nearestIndex(s, 6)).toBe(1);
    expect(nearestIndex(s, 8)).toBe(2);
    expect(nearestIndex(s, 99)).toBe(2);
    expect(nearestIndex([], 3)).toBe(-1);
  });
  test('scales map runs and progress into the plot, and back', () => {
    const r = plotRect(1000, 360, false);
    expect(xOf(r, 1, 2001)).toBe(r.x);
    expect(xOf(r, 2001, 2001)).toBeCloseTo(r.x + r.w);
    expect(yOf(r, 1)).toBe(r.y);
    expect(yOf(r, 0)).toBe(r.y + r.h);
    expect(runAt(r, xOf(r, 777, 2001), 2001)).toBeCloseTo(777);
    expect(plotRect(390, 270, true).x).toBeLessThan(r.x); // phones keep only zone numbers in the gutter
  });
});
