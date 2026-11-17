import { describe, expect, test } from 'vitest';
import { keepDeathCard } from '../src/hudstate';

describe('death card', () => {
  const card = { run: 7, progress: 0.4, cause: 'Pit', nearRecord: false };
  test('stays while the world is still dying on that run', () => {
    expect(keepDeathCard(card, { phase: 'dying', run: 7 })).toBe(true);
  });
  test('goes away once a later run is running, even if the reset event was missed', () => {
    expect(keepDeathCard(card, { phase: 'running', run: 8 })).toBe(false);
    expect(keepDeathCard(card, { phase: 'paused', run: 8 })).toBe(false);
  });
  test('no card stays no card', () => {
    expect(keepDeathCard(null, { phase: 'dying', run: 7 })).toBe(false);
  });
});
