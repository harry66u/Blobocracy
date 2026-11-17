/**
 * Calls `release` whenever the page stops being in front of the player: window blur,
 * pagehide, or the document becoming hidden (phone app switch). Returns a stop function.
 * A button must never stay "held" while the player is away (it would keep voting).
 */
export function releaseWhenHidden(win: EventTarget, doc: EventTarget & { hidden: boolean }, release: () => void): () => void {
  const onVis = () => { if (doc.hidden) release(); };
  win.addEventListener('blur', release);
  win.addEventListener('pagehide', release);
  doc.addEventListener('visibilitychange', onVis);
  return () => {
    win.removeEventListener('blur', release);
    win.removeEventListener('pagehide', release);
    doc.removeEventListener('visibilitychange', onVis);
  };
}
