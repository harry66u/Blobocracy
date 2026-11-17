import { describe, expect, test, vi } from 'vitest';
import { releaseWhenHidden, suspendWhenHidden } from '../src/lifecycle';

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

describe('suspendWhenHidden (I1: hidden tabs stop receiving frames)', () => {
  test('closes the connection after a minute hidden, reconnects when visible again', () => {
    vi.useFakeTimers();
    try {
      const doc = Object.assign(new EventTarget(), { hidden: false });
      const net = { suspend: vi.fn(), resume: vi.fn() };
      suspendWhenHidden(doc, net, 60_000);
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(59_000);
      expect(net.suspend).not.toHaveBeenCalled();
      doc.hidden = false;
      doc.dispatchEvent(new Event('visibilitychange')); // back in time: nothing was closed
      vi.advanceTimersByTime(5_000);
      expect(net.suspend).not.toHaveBeenCalled();
      doc.hidden = true;
      doc.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(61_000);
      expect(net.suspend).toHaveBeenCalledTimes(1);
      doc.hidden = false;
      doc.dispatchEvent(new Event('visibilitychange'));
      expect(net.resume).toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
