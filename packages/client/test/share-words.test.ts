import { describe, expect, test } from 'vitest';
import { causeName, crowdPhrase, pct, shareText, siteHost, statsLine, type DeathShare } from '../src/share/words.ts';
import { freshStats, noteDeath, notePlayed } from '../src/stats.ts';

const stats = noteDeath(notePlayed(freshStats('2026-11-17'), '2026-11-17'), { run: 1233, progress: 0.63, deaths: 1233 });
const death: DeathShare = {
  death: 1234, run: 1234, progress: 0.416, cause: 'spikes', zoneIndex: 1, zoneName: 'Pointy Meadow',
  peak: 340, peakActive: 312, secs: 95, nearRecord: false, wasPart: true, stats,
};

describe('share words', () => {
  test('progress rounds down so 99.9% never claims 100%', () => {
    expect(pct(0.999)).toBe('99%');
    expect(pct(1)).toBe('100%');
    expect(pct(-1)).toBe('0%');
  });

  test('crowd phrase', () => {
    expect(crowdPhrase({ peak: 5, peakActive: 1 })).toBe('1 person steering');
    expect(crowdPhrase({ peak: 5, peakActive: 0 })).toBe('1 person steering');
    expect(crowdPhrase({ peak: 20000, peakActive: 12345 })).toBe('12,345 people steering');
  });

  test('cause names', () => {
    expect(causeName('ceiling spikes')).toBe('Ceiling Spikes');
    expect(causeName('something new')).toBe('Something New');
  });

  test('the text line is one short line with the death number, how far, the crowd, my tally and one link', () => {
    const t = shareText(death, 'https://blobocracy.com/');
    expect(t).toBe('Blobocracy death #1,234: 312 people steering got the blob 41% of the way, then the Spikes got it. '
      + "I've been there for 1 death. https://blobocracy.com/?via=share");
    expect(t).not.toMatch(/\n|#[a-z]/i); // no line breaks, no hashtags
    expect(t.length).toBeLessThan(220);
  });

  test('near misses open with "So close."; no tally before your first death', () => {
    const t = shareText({ ...death, nearRecord: true, stats: freshStats('2026-11-17') }, 'https://x.io');
    expect(t.startsWith('So close. Blobocracy death #1,234')).toBe(true);
    expect(t).not.toContain("I've been there");
  });

  test('stats line and host', () => {
    expect(statsLine(freshStats('2026-11-17'))).toBeNull();
    expect(statsLine(stats)).toBe('1 death · best run 63% · 1 day');
    expect(siteHost('https://www.blobocracy.com/')).toBe('blobocracy.com');
  });
});
