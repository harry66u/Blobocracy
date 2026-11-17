import { afterEach, describe, expect, test, vi } from 'vitest';
import { connect } from '../src/net';

/** Minimal stand-in for the browser WebSocket so reconnect logic can run under fake timers. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(d: unknown) { this.sent.push(d); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.all = []; });

describe('connect', () => {
  test('a socket that goes silent (no frames for 3 s) is dropped and reopened', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'performance'] });
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    FakeSocket.all[0]!.open();
    expect(c.state.connected).toBe(true);
    vi.advanceTimersByTime(3500);
    expect(c.state.connected).toBe(false); // shows "Reconnecting" right away
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all.length).toBe(2);
  });

  test('a healthy socket receiving messages is kept', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'performance'] });
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    const s = FakeSocket.all[0]!;
    s.open();
    for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(500); s.onmessage?.({ data: '{"t":"zone","run":1,"index":0,"name":"a"}' }); }
    expect(c.state.connected).toBe(true);
    expect(FakeSocket.all.length).toBe(1);
  });

  test('on reconnect it re-sends what the player is holding', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'performance'] });
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    FakeSocket.all[0]!.open();
    c.sendInput(2);
    FakeSocket.all[0]!.close();
    vi.advanceTimersByTime(1000);
    FakeSocket.all[1]!.open();
    expect(FakeSocket.all[1]!.sent.length).toBe(1);
  });
});
