import { describe, expect, test } from 'vitest';
import { computeLayout } from '../src/layout.ts';
import { HudView } from '../src/render/hud.ts';
import { ClipBook, clipHref, withClip } from '../src/share.ts';

/** A 2D context that draws nothing (measureText: 8 px a character). */
function fakeCtx(): CanvasRenderingContext2D {
  return new Proxy({}, {
    get: (_t, k) => (k === 'measureText' ? (s: string) => ({ width: s.length * 8 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
}
const card = { run: 4812, progress: 0.78, line: 'then the Big Press flattened it.', nearRecord: true, countdown: 3 };

describe('Share the clip', () => {
  test('a clip announced for the run on the card gives the card a button slot; others do not', () => {
    const book = new ClipBook();
    expect(withClip(card, book)).toBe(card);
    book.add({ t: 'clip', id: 'Qx7_ab', kind: 'near_miss', run: 4811 });
    expect(withClip(card, book)?.clip).toBeUndefined();
    book.add({ t: 'clip', id: 'Zz9', kind: 'near_miss', run: 4812 });
    expect(withClip(card, book)).toEqual({ ...card, clip: true });
    expect(withClip(null, book)).toBeNull();
    expect(book.forRun(4812)?.id).toBe('Zz9');
    expect(clipHref('Zz9')).toBe('/c/Zz9');
    for (let i = 0; i < 20; i++) book.add({ t: 'clip', id: `c${i}`, kind: 'record', run: 9000 + i });
    expect(book.forRun(4812)).toBeNull(); // only recent runs are kept
  });

  test('the card reserves room and reports where the button goes, inside the card, settling with it', () => {
    const L = computeLayout(390, 844, 2);
    const plain = new HudView();
    plain.update({} as never, card, 0, true);
    plain.drawDeathCard(fakeCtx(), L, 1);
    expect(plain.shareSlot).toBeNull();

    const hud = new HudView();
    hud.update({} as never, { ...card, clip: true }, 0, false);
    hud.drawDeathCard(fakeCtx(), L, 2); // settled
    const slot = hud.shareSlot!;
    expect(slot).not.toBeNull();
    expect(slot.x).toBeGreaterThan(L.w * 0.4);
    expect(slot.x).toBeLessThan(L.w * 0.6);
    expect(slot.y).toBeGreaterThan(150);
    expect(slot.w).toBeLessThan(L.w - 32);
    expect(slot.h).toBeGreaterThanOrEqual(40); // a comfortable touch target
    expect(slot.alpha).toBe(1);
    expect(slot.rotDeg).toBeCloseTo(-2, 0);
    // while the card is still dropping in, the slot is above its resting place
    const early = new HudView();
    early.update({} as never, { ...card, clip: true }, 0, false);
    early.drawDeathCard(fakeCtx(), L, 0.15);
    expect(early.shareSlot!.y).toBeLessThan(slot.y);
  });
});
