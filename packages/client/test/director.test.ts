import { describe, expect, test } from 'vitest';
import { Director } from '../src/director.ts';
import { DEATH_CARD_AT, DEATH_COUNTER_AT } from '../src/moments.ts';
import { flagGroundRow, flagSpot } from '../src/render/fx.ts';
import type { SceneLevel } from '../src/render/scene.ts';

function make() {
  const said: string[] = [];
  let passed = 0;
  const d = new Director(() => false, { announce: (t) => said.push(t), recordPassed: () => passed++ });
  d.welcome({ deaths: 41, record: { progress: 0.5, run: 30 }, run: 42 });
  return { d, said, passed: () => passed };
}

describe('Director: death beat', () => {
  test('the counter flips a beat after the impact and the card follows', () => {
    const { d } = make();
    d.frame(10, 42, 0.3, true);
    d.onDeath({ run: 42, cause: 'saw', progress: 0.31, deaths: 42, nearRecord: false }, 10);
    const early = d.frame(10 + DEATH_COUNTER_AT / 2, 42, 0.31, false);
    expect(early.deaths).toBe(41);
    expect(early.freeze).toBe(true);
    expect(early.card).toBeNull();
    const flipped = d.frame(10 + DEATH_COUNTER_AT + 0.01, 42, 0.31, false);
    expect(flipped.deaths).toBe(42);
    expect(flipped.deathsJustTicked).toBe(true);
    const card = d.frame(10 + DEATH_CARD_AT + 0.01, 42, 0.31, false).card;
    expect(card?.line).toMatch(/Saw/);
    expect(card?.countdown).toBe(3);
    expect(d.frame(13.4, 42, 0.31, false).card?.countdown).toBe(1);
  });
  test('the reset clears the card and the freeze', () => {
    const { d } = make();
    d.onDeath({ run: 42, cause: 'pit', progress: 0.2, deaths: 42, nearRecord: false }, 10);
    d.onReset(43, 13.5);
    const f = d.frame(13.6, 43, 0, true);
    expect(f.card).toBeNull();
    expect(f.freeze).toBe(false);
    expect(f.deaths).toBe(42);
  });
});

describe('Director: record', () => {
  test('passing the record mid-run pops once, cheers, announces, and the HUD shows it live', () => {
    const { d, said, passed } = make();
    d.frame(1, 42, 0.4, true);
    expect(d.frame(2, 42, 0.45, true).recordPop).toBeNull();
    const p = d.frame(3, 42, 0.52, true);
    expect(p.recordPop).toBe(0);
    expect(p.record).toEqual({ progress: 0.52, run: 42 });
    expect(p.recordLabel).toBe('this run!');
    const later = d.frame(4, 42, 0.6, true);
    expect(later.recordPop).toBe(1);
    expect(later.record?.progress).toBe(0.6);
    expect(passed()).toBe(1);
    expect(said.some((s) => s.startsWith('New record!'))).toBe(true);
    // the flag stays where the old record was until the run ends
    expect(later.flagProgress).toBe(0.5);
  });
  test('joining a run that is already past the record does not pop', () => {
    const { d, passed } = make();
    d.frame(1, 42, 0.7, true);
    expect(d.frame(2, 42, 0.75, true).recordPop).toBeNull();
    expect(passed()).toBe(0);
  });
  test('after the death the new record moves the flag for the next run', () => {
    const { d } = make();
    d.frame(1, 42, 0.4, true);
    d.frame(2, 42, 0.6, true);
    d.onDeath({ run: 42, cause: 'press', progress: 0.6, deaths: 42, nearRecord: true }, 3);
    d.onRecord({ run: 42, progress: 0.6 });
    d.onReset(43, 6.5);
    const f = d.frame(6.6, 43, 0, true);
    expect(f.flagProgress).toBe(0.6);
    expect(f.recordLabel).toBe('run 42');
  });
});

describe('Director: zone banner', () => {
  test('lasts about 2.2 s and is announced', () => {
    const { d, said } = make();
    d.onZone(2, 'The Grinder', 5);
    expect(d.frame(5.5, 42, 0.3, true).banner).toMatchObject({ index: 2, name: 'The Grinder' });
    expect(d.frame(7.5, 42, 0.3, true).banner).toBeNull();
    expect(said).toContain('Zone 3: The Grinder');
  });
  test('a death clears the banner so it never fights the death card', () => {
    const { d } = make();
    d.onZone(2, 'The Grinder', 5);
    d.onDeath({ run: 42, cause: 'press', progress: 0.3, deaths: 42, nearRecord: false }, 5.4);
    expect(d.frame(5.5, 42, 0.3, false).banner).toBeNull();
  });
});

describe('record flag ground', () => {
  const rows = [
    '........',
    '........',
    '........',
    '..###...',
    '..vvv...',
    '........',
    '.....-..',
    '########',
    '###..###',
  ];
  const codes: Record<string, number> = { '.': 0, '#': 1, '-': 2, '^': 3, v: 4 };
  const level: SceneLevel = { width: 8, height: rows.length, tileAt: (x, y) => codes[rows[y]?.[x] ?? '.'] ?? 0, zones: [], entities: [] };
  test('stands on the ground, not on top of a hanging spike block', () => {
    expect(flagGroundRow(level, 3.5)).toBe(7);
    expect(flagGroundRow(level, 0.5)).toBe(7);
  });
  test('stands on a one-way platform when that is the floor', () => {
    expect(flagGroundRow(level, 5.5)).toBe(6);
  });
  test('over a pit it stands at the lip of the ground before it', () => {
    const pit: SceneLevel = { ...level, tileAt: (x, y) => (y >= 7 && (x < 3 || x > 5) ? 1 : 0) };
    expect(flagSpot(pit, 4.2)).toEqual({ x: 2.7, row: 7 });
    expect(flagSpot(pit, 1.5)).toEqual({ x: 1.5, row: 7 });
  });
});
