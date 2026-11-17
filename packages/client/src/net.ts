import { decodeServer, encodeInput, encodePing, type ServerEvent, type StateFrame } from '@blobocracy/shared';

export interface NetState {
  connected: boolean;
  latest: StateFrame | null;
  /** performance.now() when `latest` arrived. */
  latestAt: number;
  rttMs: number;
  welcome: ServerEvent | null;
}

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
const PING_EVERY_MS = 2000;
/** Frames arrive 20 times a second; this much silence means the connection is dead even if no close came. */
const SILENCE_MS = 3000;

/** Opens the game socket and keeps it open: reconnects with backoff (0.5 s doubling to 8 s). */
export function connect(url: string, onEvent: (e: ServerEvent) => void) {
  const state: NetState = { connected: false, latest: null, latestAt: 0, rttMs: 80, welcome: null };
  let ws: WebSocket | null = null;
  let backoff = BACKOFF_MIN_MS;
  let closed = false;
  let lastBits = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let lastHeard = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      state.connected = true;
      lastHeard = performance.now();
      backoff = BACKOFF_MIN_MS;
      if (lastBits) ws!.send(encodeInput(lastBits)); // resume what the player is holding
      pingTimer = setInterval(() => {
        // Phones on cellular can lose the connection without any close event; notice the silence.
        if (performance.now() - lastHeard > SILENCE_MS) { drop(); return; }
        if (ws?.readyState === 1) ws.send(encodePing(Math.floor(performance.now()) >>> 0));
      }, PING_EVERY_MS / 4);
    };
    ws.onmessage = (m) => {
      lastHeard = performance.now();
      if (typeof m.data === 'string') {
        let e: ServerEvent;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.t === 'welcome') state.welcome = e;
        onEvent(e);
        return;
      }
      const d = decodeServer(m.data as ArrayBuffer);
      if (!d) return;
      if ('tick' in d) { state.latest = d; state.latestAt = performance.now(); }
      else state.rttMs = state.rttMs * 0.7 + ((Math.floor(performance.now()) >>> 0) - d.t) * 0.3;
    };
    ws.onclose = () => drop();
  };

  /** Forget the current socket (closed or silently dead) and schedule a fresh one. */
  const drop = () => {
    if (!ws) return;
    const dead = ws;
    ws = null;
    dead.onopen = dead.onmessage = dead.onclose = null;
    try { dead.close(); } catch { /* already gone */ }
    state.connected = false;
    clearInterval(pingTimer);
    if (closed) return;
    setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  };
  open();

  return {
    state,
    sendInput(bits: number) {
      lastBits = bits;
      if (ws?.readyState === 1) ws.send(encodeInput(bits));
    },
    close() { closed = true; drop(); },
  };
}
