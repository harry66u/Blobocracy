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
  onclose: ((ev?: { code: number }) => void) | null = null;
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

describe('edge relays', () => {
  test('"sim unreachable" from the relay shows reconnecting without dropping the socket, and is not a world event', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'performance'] });
    vi.stubGlobal('WebSocket', FakeSocket);
    const events: unknown[] = [];
    const c = connect('ws://x/ws', (e) => events.push(e));
    const s = FakeSocket.all[0]!;
    s.open();
    s.onmessage?.({ data: '{"t":"sim","up":false}' });
    expect(c.state.connected).toBe(false);
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(500); s.onmessage?.({ data: new Uint8Array([12, 0, 0, 0, 0]).buffer }); } // pongs
    expect(FakeSocket.all.length).toBe(1);
    s.onmessage?.({ data: '{"t":"sim","up":true}' });
    expect(c.state.connected).toBe(true);
    expect(events).toEqual([]);
  });

  test('on a page served by an edge it earns a session token with proof of work before connecting', async () => {
    const { createHash } = await import('node:crypto');
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('document', { querySelector: (q: string) => (q.includes('blobocracy-session') ? {} : null) });
    const posts: { challenge: string; nonce: number }[] = [];
    vi.stubGlobal('fetch', async (u: string, init?: { method?: string; body?: string }) => {
      expect(u).toBe('http://x/session');
      if (init?.method === 'POST') {
        posts.push(JSON.parse(init.body!));
        return { ok: true, status: 200, json: async () => ({ token: 'tok.en', exp: Date.now() + 600_000 }) };
      }
      return { ok: true, status: 200, json: async () => ({ challenge: 'c1.10.1.abc.sig', bits: 10 }) };
    });
    connect('ws://x/ws', () => {});
    for (let i = 0; i < 100 && FakeSocket.all.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(FakeSocket.all[0]!.url).toBe('ws://x/ws?t=tok.en');
    const h = createHash('sha256').update(`c1.10.1.abc.sig:${posts[0]!.nonce}`).digest();
    expect(h[0]).toBe(0);
    expect(h[1]! >> 6).toBe(0);
  });

  test('a packed edge is retried every 10 s and reported in state', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('document', { querySelector: () => ({}) });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, json: async () => ({ packed: true }) }));
    const c = connect('ws://x/ws', () => {});
    for (let i = 0; i < 50 && !c.state.packed; i++) await new Promise((r) => setTimeout(r, 5));
    expect(c.state.packed).toBe(true);
    expect(FakeSocket.all.length).toBe(0);
    c.close();
  });
});

const FAKE = { toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'performance'] } as Parameters<typeof vi.useFakeTimers>[0];

describe('reconnect backoff (M5)', () => {
  test('retries are jittered (±50%)', () => {
    vi.useFakeTimers(FAKE);
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    connect('ws://x/ws', () => {});
    FakeSocket.all[0]!.close(); // never opened: retry after 500 ms × ~1.5
    vi.advanceTimersByTime(700);
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(100);
    expect(FakeSocket.all.length).toBe(2);
    vi.mocked(Math.random).mockReturnValue(0);
    FakeSocket.all[1]!.close(); // 1000 ms × 0.5
    vi.advanceTimersByTime(510);
    expect(FakeSocket.all.length).toBe(3);
    vi.restoreAllMocks();
  });

  test('the backoff only resets once a socket stayed up for 5 s (a flapping relay is not hammered)', () => {
    vi.useFakeTimers(FAKE);
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no jitter
    connect('ws://x/ws', () => {});
    const flap = () => { const s = FakeSocket.all.at(-1)!; s.open(); vi.advanceTimersByTime(1000); s.onmessage?.({ data: '{"t":"zone","run":1,"index":0,"name":"a"}' }); s.close(); };
    flap();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all.length).toBe(2);
    flap();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all.length).toBe(2); // 1 s now, not 0.5 s again
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all.length).toBe(3);
    // stays up 6 s: the next drop retries quickly again
    const s = FakeSocket.all[2]!;
    s.open();
    for (let i = 0; i < 12; i++) { vi.advanceTimersByTime(500); s.onmessage?.({ data: '{"t":"zone","run":1,"index":0,"name":"a"}' }); }
    s.close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all.length).toBe(4);
    vi.restoreAllMocks();
  });
});

describe('budget and idle disconnects (I1)', () => {
  test('dropped as idle (4001): no automatic reconnect; the next input reconnects at once', () => {
    vi.useFakeTimers(FAKE);
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    const s = FakeSocket.all[0]!;
    s.open();
    s.readyState = 3;
    s.onclose?.({ code: 4001 });
    expect(c.state.idle).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBe(1);
    c.sendInput(0); // releasing a key is not coming back
    expect(FakeSocket.all.length).toBe(1);
    c.sendInput(2);
    expect(FakeSocket.all.length).toBe(2);
    expect(c.state.idle).toBe(false);
    FakeSocket.all[1]!.open();
    expect(FakeSocket.all[1]!.sent.length).toBe(1); // the press that woke it
  });

  test('shed because the budget is spent (4002): shows packed and retries every 10 s', () => {
    vi.useFakeTimers(FAKE);
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    const s = FakeSocket.all[0]!;
    s.open();
    s.readyState = 3;
    s.onclose?.({ code: 4002 });
    expect(c.state.packed).toBe(true);
    vi.advanceTimersByTime(9_000);
    expect(FakeSocket.all.length).toBe(1);
    vi.advanceTimersByTime(2_000);
    expect(FakeSocket.all.length).toBe(2);
    FakeSocket.all[1]!.open();
    expect(c.state.packed).toBe(false);
  });

  test('suspend closes the socket without retrying; resume opens a fresh one', () => {
    vi.useFakeTimers(FAKE);
    vi.stubGlobal('WebSocket', FakeSocket);
    const c = connect('ws://x/ws', () => {});
    FakeSocket.all[0]!.open();
    c.suspend();
    expect(FakeSocket.all[0]!.readyState).toBe(3);
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.all.length).toBe(1);
    c.resume();
    expect(FakeSocket.all.length).toBe(2);
    c.resume(); // already connecting: nothing more
    expect(FakeSocket.all.length).toBe(2);
  });
});
