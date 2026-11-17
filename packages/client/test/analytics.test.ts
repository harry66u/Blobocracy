import { describe, expect, test } from 'vitest';
import { cleanTag, sourceOf, stripTags, visitBeacon } from '../src/analytics.ts';

describe('analytics client', () => {
  test('a ?via= tag wins, then the referring site, then direct', () => {
    expect(sourceOf('https://blobocracy.com/?via=WebGames', 'https://news.ycombinator.com/')).toBe('webgames');
    expect(sourceOf('https://blobocracy.com/', 'https://news.ycombinator.com/item?id=1')).toBe('hn');
    expect(sourceOf('https://blobocracy.com/', 'https://old.reddit.com/r/WebGames/')).toBe('reddit');
    expect(sourceOf('https://blobocracy.com/', 'https://t.co/abc')).toBe('x');
    expect(sourceOf('https://blobocracy.com/', 'https://www.some-blog.net/post')).toBe('some-blog.net');
    expect(sourceOf('https://blobocracy.com/', 'https://blobocracy.com/stats')).toBe('direct');
    expect(sourceOf('https://blobocracy.com/', '')).toBe('direct');
  });

  test('tags are short and can hold nothing personal-looking', () => {
    expect(cleanTag('Jane Doe <jane@x.com>')).toBe('jane-doe-jane-x.com');
    expect(cleanTag('a'.repeat(100))).toHaveLength(32);
  });

  test('tracking tags are removed from the address bar, everything else kept', () => {
    expect(stripTags('https://b.com/?via=hn')).toBe('/');
    expect(stripTags('https://b.com/?x=1&utm_source=y#h')).toBe('/?x=1#h');
    expect(stripTags('https://b.com/?x=1')).toBeNull();
  });

  test('first visit, same-day reload, next-day return, later return', () => {
    const a = visitBeacon(null, '2026-11-20', 'hn');
    expect(a.beacon).toMatchObject({ isNew: true, daily: true, cohort: '2026-11-20', firstSrc: 'hn', daysSince: 0, firstReturn: false });
    const b = visitBeacon(a.mem, '2026-11-20', 'direct');
    expect(b.beacon).toMatchObject({ isNew: false, daily: false, firstReturn: false });
    const c = visitBeacon(b.mem, '2026-11-21', 'share');
    expect(c.beacon).toMatchObject({ daily: true, daysSince: 1, firstReturn: true, firstSrc: 'hn', src: 'share' });
    const d = visitBeacon(c.mem, '2026-11-25', 'direct');
    expect(d.beacon).toMatchObject({ daily: true, daysSince: 5, firstReturn: false });
  });
});
