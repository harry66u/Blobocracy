import { describe, expect, test, vi } from 'vitest';
import { releaseWhenHidden } from '../src/lifecycle';

describe('releaseWhenHidden', () => {
  function setup() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const release = vi.fn();
    const stop = releaseWhenHidden(win, doc, release);
    return { win, doc, release, stop };
  }
  test('releases on blur, pagehide and becoming hidden', () => {
    const { win, doc, release } = setup();
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('pagehide'));
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(release).toHaveBeenCalledTimes(3);
  });
  test('becoming visible again does not release', () => {
    const { doc, release } = setup();
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(release).not.toHaveBeenCalled();
  });
  test('stop() removes the listeners', () => {
    const { win, release, stop } = setup();
    stop();
    win.dispatchEvent(new Event('blur'));
    expect(release).not.toHaveBeenCalled();
  });
});
