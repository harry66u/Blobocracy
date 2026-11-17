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

/**
 * Closes the game connection after the page has been hidden for `afterMs` (default a minute) and
 * reopens it when the page is visible again (review I1): a forgotten background tab would
 * otherwise receive every frame forever, which costs egress and a seat on a relay.
 */
export function suspendWhenHidden(doc: EventTarget & { hidden: boolean }, net: { suspend(): void; resume(): void }, afterMs = 60_000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onVis = () => {
    clearTimeout(timer);
    if (doc.hidden) timer = setTimeout(() => net.suspend(), afterMs);
    else net.resume();
  };
  doc.addEventListener('visibilitychange', onVis);
  return () => { clearTimeout(timer); doc.removeEventListener('visibilitychange', onVis); };
}
