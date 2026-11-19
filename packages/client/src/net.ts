import {
  decodeServer, encodeInput, encodePing, solvePow, type EdgeNotice, type ServerEvent, type StateFrame,
} from '@blobocracy/shared';

export interface NetState {
  /** Connected to the blob: the socket is open and its relay can reach the sim. */
  connected: boolean;
  latest: StateFrame | null;
  /** performance.now() when `latest` arrived. */
  latestAt: number;
  rttMs: number;
  welcome: ServerEvent | null;
  /** The edge said the game is full (budget cap reached); retried every 10 s. */
  packed: boolean;
  /** The relay dropped this connection after a long time without input; the next press reconnects. */
  idle: boolean;
}

/** Close codes from the edge (packages/edge/src/server.ts). */
export const CLOSE_IDLE = 4001;
export const CLOSE_PACKED = 4002;

const BACKOFF_MIN_MS = 500;
const BACKOFF_MAX_MS = 8000;
const PING_EVERY_MS = 2000;
/** Frames arrive 20 times a second; this much silence means the connection is dead even if no close came. */
const SILENCE_MS = 3000;
const PACKED_RETRY_MS = 10_000;
/** A socket must stay up this long before the backoff starts over (a flapping relay is not hammered). */
const STABLE_MS = 5000;
/** Proof-of-work tries per slice, so solving never blocks a frame for long. */
const POW_SLICE = 4096;
/** Reuse a session token while it has at least this long left. */
const TOKEN_MARGIN_MS = 30_000;

/** Pages served by an edge relay carry this marker: get a session token (§8) before opening the socket. */
function sessionMode(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector?.('meta[name="blobocracy-session"]');
}

class Packed extends Error {}

/** GET /session, solve the proof of work in slices between frames, POST it back for a token. */
async function fetchToken(httpBase: string): Promise<{ token: string; exp: number } | null> {
  const r = await fetch(`${httpBase}/session`, { cache: 'no-store' });
  if (r.status === 404) return null; // no session service (single-process dev): connect without a token
  if (r.status === 503) throw new Packed();
  if (!r.ok) throw new Error(`session ${r.status}`);
  const c = await r.json() as { challenge: string; bits: number };
  let nonce = -1;
  for (let start = 0; nonce < 0; start += POW_SLICE) {
    nonce = solvePow(c.challenge, c.bits, POW_SLICE, start);
    if (nonce < 0) await new Promise((res) => setTimeout(res, 0));
  }
  const t = await fetch(`${httpBase}/session`, { method: 'POST', body: JSON.stringify({ challenge: c.challenge, nonce }) });
  if (t.status === 503) throw new Packed();
  if (!t.ok) throw new Error(`session ${t.status}`);
  return await t.json() as { token: string; exp: number };
}

/**
 * Opens the game socket and keeps it open: reconnects with jittered backoff (0.5 s doubling to 8 s, ±50%).
 * On a page served by an edge it first earns a session token with a small proof of work.
 * While the relay cannot reach the sim it says so ({t:'sim', up:false}); `connected` is then
 * false (the page shows "Reconnecting to the blob…") but the socket stays open.
 */
export function connect(url: string, onEvent: (e: ServerEvent) => void, onNameReply: (r: { ok: boolean; name?: string }) => void = () => {}) {
  const state: NetState = { connected: false, latest: null, latestAt: 0, rttMs: 80, welcome: null, packed: false, idle: false };
  let ws: WebSocket | null = null;
  let backoff = BACKOFF_MIN_MS;
  let closed = false;
  /** Not reconnecting on purpose: the tab is hidden (suspend) or the relay dropped us as idle. */
  let paused = false;
  let connecting = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let lastBits = 0;
  /** The name to give the relay on every (re)connect: a new socket is a new player to it. */
  let myName: string | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let lastHeard = 0;
  let token: { token: string; exp: number } | null = null;
  let simUp = true;
  const httpBase = url.replace(/^ws/, 'http').replace(/\/ws(\?.*)?$/, '');

  const open = () => {
    clearTimeout(retryTimer);
    if (closed || paused || ws) return;
    connecting = true;
    if (!sessionMode()) { openSocket(url); return; }
    if (token && token.exp - Date.now() > TOKEN_MARGIN_MS) { openSocket(`${url}?t=${encodeURIComponent(token.token)}`); return; }
    fetchToken(httpBase).then((t) => {
      state.packed = false;
      token = t;
      openSocket(t ? `${url}?t=${encodeURIComponent(t.token)}` : url);
    }, (e: unknown) => {
      connecting = false;
      if (closed) return;
      if (e instanceof Packed) { state.packed = true; retryTimer = setTimeout(open, PACKED_RETRY_MS); return; }
      retryLater();
    });
  };

  const openSocket = (u: string) => {
    connecting = false;
    if (closed || paused || ws) return;
    ws = new WebSocket(u);
    ws.binaryType = 'arraybuffer';
    simUp = true;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      state.connected = true;
      state.packed = false;
      lastHeard = performance.now();
      // the backoff starts over only once this socket has proved itself
      stableTimer = setTimeout(() => { backoff = BACKOFF_MIN_MS; }, STABLE_MS);
      if (lastBits) ws!.send(encodeInput(lastBits)); // resume what the player is holding
      if (myName) ws!.send(JSON.stringify({ c: 'name', name: myName }));
      pingTimer = setInterval(() => {
        // Phones on cellular can lose the connection without any close event; notice the silence.
        if (performance.now() - lastHeard > SILENCE_MS) { drop(); return; }
        if (ws?.readyState === 1) ws.send(encodePing(Math.floor(performance.now()) >>> 0));
      }, PING_EVERY_MS / 4);
    };
    ws.onmessage = (m) => {
      lastHeard = performance.now();
      if (typeof m.data === 'string') {
        let e: ServerEvent | EdgeNotice;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.t === 'sim') { simUp = e.up; state.connected = e.up; return; }
        if (e.t === 'name') { onNameReply(e); return; }
        if (e.t === 'welcome') state.welcome = e;
        onEvent(e);
        return;
      }
      const d = decodeServer(m.data as ArrayBuffer);
      if (!d) return;
      if ('tick' in d) { state.latest = d; state.latestAt = performance.now(); if (simUp) state.connected = true; }
      else state.rttMs = state.rttMs * 0.7 + ((Math.floor(performance.now()) >>> 0) - d.t) * 0.3;
    };
    const lost = (ev?: CloseEvent) => {
      if (ev?.code === 4003) closed = true; // banned: stop knocking
      if (!opened) token = null; // refused handshake: earn a fresh token next time
      if (ev?.code === CLOSE_IDLE) { state.idle = true; paused = true; } // back on the next press
      if (ev?.code === CLOSE_PACKED) { state.packed = true; drop(PACKED_RETRY_MS); return; } // shed: the budget is spent
      drop();
    };
    ws.onclose = lost;
    ws.onerror = () => lost();
  };

  const retryLater = (wait?: number) => {
    if (closed || paused) return;
    clearTimeout(retryTimer);
    // ±50% jitter, so thousands of clients dropped at once don't all come back in the same instant
    retryTimer = setTimeout(open, wait ?? backoff * (0.5 + Math.random()));
    if (wait === undefined) backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  };

  /** Forget the current socket (closed or silently dead) and schedule a fresh one (unless paused). */
  const drop = (wait?: number) => {
    if (!ws) return;
    const dead = ws;
    ws = null;
    dead.onopen = dead.onmessage = dead.onclose = dead.onerror = null;
    try { dead.close(); } catch { /* already gone */ }
    state.connected = false;
    clearInterval(pingTimer);
    clearTimeout(stableTimer);
    if (closed) return;
    retryLater(wait);
  };

  /** Reconnect now if paused (tab visible again, or the player pressed something after an idle drop). */
  const resume = () => {
    if (closed || !paused) return;
    paused = false;
    state.idle = false;
    backoff = BACKOFF_MIN_MS;
    if (!ws && !connecting) open();
  };
  open();

  return {
    state,
    /** Tells the relay the name this player chose (null: none). It is sent again after any reconnect. */
    sendName(name: string | null) {
      myName = name;
      if (name && ws?.readyState === 1) ws.send(JSON.stringify({ c: 'name', name }));
    },
    sendInput(bits: number) {
      lastBits = bits;
      if (bits && paused && state.idle) resume();
      if (ws?.readyState === 1) ws.send(encodeInput(bits));
    },
    /** Close the socket and stay closed until resume() (a hidden tab should not receive every frame). */
    suspend() {
      if (closed) return;
      paused = true;
      clearTimeout(retryTimer);
      drop();
    },
    resume,
    close() { closed = true; clearTimeout(retryTimer); drop(); },
  };
}
