/**
 * Whether the death card should still show. It normally goes away on the server's
 * 'reset' event, but events can be missed (reconnects, dropped frames on slow links),
 * so once a later run is underway the card goes regardless.
 */
export function keepDeathCard(card: { run: number } | null, frame: { phase: string; run: number }): boolean {
  if (!card) return false;
  return frame.run === card.run;
}
