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

/** Opens the game socket and keeps it open: reconnects with backoff (0.5 s doubling to 8 s). */
export function connect(url: string, onEvent: (e: ServerEvent) => void) {
  const state: NetState = { connected: false, latest: null, latestAt: 0, rttMs: 80, welcome: null };
  let ws: WebSocket | null = null;
  let backoff = BACKOFF_MIN_MS;
  let closed = false;
  let lastBits = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      state.connected = true;
      backoff = BACKOFF_MIN_MS;
      if (lastBits) ws!.send(encodeInput(lastBits)); // resume what the player is holding
      pingTimer = setInterval(() => ws?.readyState === 1 && ws.send(encodePing(Math.floor(performance.now()) >>> 0)), PING_EVERY_MS);
    };
    ws.onmessage = (m) => {
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
    ws.onclose = () => {
      state.connected = false;
      clearInterval(pingTimer);
      if (closed) return;
      setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    };
  };
  open();

  return {
    state,
    sendInput(bits: number) {
      lastBits = bits;
      if (ws?.readyState === 1) ws.send(encodeInput(bits));
    },
    close() { closed = true; ws?.close(); },
  };
}
