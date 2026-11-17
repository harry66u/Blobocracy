import { MSG_STATE, isControlText, parseControl, validSimControl, type RelayControl, type SimControl } from '@blobocracy/shared';

export interface SimLinkOptions {
  url: string;
  secret?: string;
  hello: () => RelayControl;
  onFrame: (frame: ArrayBuffer) => void;
  /** A world event as the exact JSON text players receive. */
  onEvent: (text: string) => void;
  onControl: (c: SimControl) => void;
  onUp: () => void;
  onDown: () => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** No message from the sim for this long means it is gone, even without a close. */
  silenceMs?: number;
}

/**
 * The relay's connection to the sim. Reconnects forever with jittered exponential backoff;
 * while it is down the relay keeps its players and tells them the blob is unreachable.
 */
export class SimLink {
  up = false;
  private ws: WebSocket | null = null;
  private backoff: number;
  private stopped = false;
  private lastHeard = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval>;

  constructor(private o: SimLinkOptions) {
    this.backoff = o.minBackoffMs ?? 250;
    this.watchdog = setInterval(() => {
      if (this.ws && this.up && Date.now() - this.lastHeard > (o.silenceMs ?? 5000)) this.drop();
    }, 500);
    this.open();
  }

  private open(): void {
    if (this.stopped) return;
    const headers: Record<string, string> = {};
    if (this.o.secret) headers['x-relay-secret'] = this.o.secret;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.o.url, { headers } as unknown as string[]);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.up = true;
      this.lastHeard = Date.now();
      this.backoff = this.o.minBackoffMs ?? 250;
      ws.send(JSON.stringify(this.o.hello()));
      this.o.onUp();
    };
    ws.onmessage = (m) => {
      this.lastHeard = Date.now();
      // an exception in a WebSocket event handler would end the relay process: never let one out
      try {
        if (typeof m.data !== 'string') {
          const buf = m.data as ArrayBuffer;
          if (buf.byteLength > 0 && new Uint8Array(buf, 0, 1)[0] === MSG_STATE) this.o.onFrame(buf);
          return;
        }
        if (isControlText(m.data)) {
          const c = parseControl(m.data);
          if (c && validSimControl(c)) this.o.onControl(c);
        } else {
          this.o.onEvent(m.data);
        }
      } catch (e) {
        console.warn(`[edge] bad message from the sim: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    ws.onclose = () => this.drop();
    ws.onerror = () => { /* onclose follows */ };
  }

  private drop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try { ws.close(); } catch { /* already gone */ }
    if (this.up) { this.up = false; this.o.onDown(); }
    this.retry();
  }

  private retry(): void {
    if (this.stopped) return;
    const wait = this.backoff * (0.8 + Math.random() * 0.4);
    this.backoff = Math.min(this.backoff * 2, this.o.maxBackoffMs ?? 5000);
    this.timer = setTimeout(() => this.open(), wait);
  }

  send(data: Uint8Array | string): boolean {
    if (!this.up || !this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(data);
    return true;
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch { /* gone */ } }
    this.up = false;
  }
}
