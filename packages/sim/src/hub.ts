import uWS from 'uWebSockets.js';
import {
  Reservoir, decodeSummary, isControlText, parseControl, type RelayControl, type ServerEvent, type SimControl,
} from '@blobocracy/shared';
import type { AdminRequest, AdminResponse } from './admin';
import type { Voters } from './crowd';
import type { Relay } from './relay';

const TOPIC = 'relays';

export interface RelayInfo {
  id: number;
  name: string;
  claimsAlwaysOn: boolean;
  hourlyUsd: number | undefined;
  connectedAt: number;
  connections: number;
  watchers: number;
  summaries: number;
  stats: Record<string, unknown> | null;
}

interface LinkData { id: number }

export interface HubOptions {
  port: number;
  host?: string;
  /** Shared secret relays must present (header `x-relay-secret`); unset = trust the private network. */
  secret?: string;
  voters: Voters;
  admin: (req: AdminRequest) => AdminResponse;
  /** Egress bytes a relay reports (for the budget governor). */
  onBytes: (bytes: number) => void;
  /** Called when the set of relays changes, so policies can be recomputed and pushed. */
  onRelaysChanged: () => void;
  /** Sent to a relay as soon as it connects (policy, welcome, bans). */
  greet: (id: number) => SimControl[];
}

/**
 * The sim's side of the relay link (spec §4-5): an internal uWS WebSocket server for edge relays,
 * plus the sim's internal HTTP (health check, admin). Relays push input summaries; the sim
 * publishes each encoded state frame and event once, and uWS writes it to every relay.
 */
export function startHub(o: HubOptions): Promise<Relay & {
  port: number;
  relays(): RelayInfo[];
  send(id: number, c: SimControl): void;
  sendAll(c: SimControl): void;
  /** Edge-input → sim latency (ms), for inputs folded into summaries since the last call. */
  takeInputTimes(): number[];
  latency: Reservoir;
}> {
  const app = uWS.App();
  const relays = new Map<number, { ws: uWS.WebSocket<LinkData>; info: RelayInfo }>();
  let nextId = 1;
  let inputTimes: number[] = [];
  const latency = new Reservoir(8192);

  const sendTo = (ws: uWS.WebSocket<LinkData>, c: SimControl) => { ws.send(JSON.stringify(c), false); };

  app.ws<LinkData>('/relay', {
    compression: uWS.DISABLED,
    maxPayloadLength: 256 * 1024,
    maxBackpressure: 4 * 1024 * 1024,
    idleTimeout: 30,
    sendPingsAutomatically: true,
    upgrade: (res, req, context) => {
      if (o.secret && req.getHeader('x-relay-secret') !== o.secret) {
        res.writeStatus('401 Unauthorized').end('relay secret required');
        return;
      }
      res.upgrade<LinkData>({ id: nextId++ }, req.getHeader('sec-websocket-key'), req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'), context);
    },
    open: (ws) => {
      const id = ws.getUserData().id;
      relays.set(id, {
        ws,
        info: { id, name: `relay-${id}`, claimsAlwaysOn: false, hourlyUsd: undefined, connectedAt: Date.now(), connections: 0, watchers: 0, summaries: 0, stats: null },
      });
      ws.subscribe(TOPIC);
      for (const c of o.greet(id)) sendTo(ws, c);
      o.onRelaysChanged();
    },
    message: (ws, msg, isBinary) => {
      const r = relays.get(ws.getUserData().id);
      if (!r) return;
      if (isBinary) {
        const s = decodeSummary(msg);
        if (!s) return;
        r.info.connections = s.connections;
        r.info.watchers = s.watchers;
        r.info.summaries++;
        o.voters.setRelay(r.info.id, s);
        o.onBytes(s.bytesSent);
        if (s.oldestInputAt > 0) inputTimes.push(s.oldestInputAt);
        return;
      }
      const text = Buffer.from(msg).toString();
      if (!isControlText(text)) return;
      const c = parseControl(text) as RelayControl | null;
      if (!c) return;
      if (c.c === 'hello') {
        r.info.name = String(c.name).slice(0, 64);
        r.info.claimsAlwaysOn = c.alwaysOn === true;
        r.info.hourlyUsd = typeof c.hourlyUsd === 'number' && c.hourlyUsd >= 0 ? c.hourlyUsd : undefined;
        o.onRelaysChanged();
      } else if (c.c === 'stats') {
        r.info.stats = c.stats;
      } else if (c.c === 'admin') {
        const res = o.admin({ method: c.method, path: c.path, auth: c.auth, body: c.body });
        sendTo(ws, { c: 'adminRes', id: c.id, status: res.status, body: res.body });
      }
    },
    close: (ws) => {
      const id = ws.getUserData().id;
      relays.delete(id);
      o.voters.dropRelay(id);
      o.onRelaysChanged();
    },
  });

  const readBody = (res: uWS.HttpResponse, cb: (body: string) => void) => {
    let chunks: Buffer[] = [];
    let size = 0;
    res.onData((ab, last) => {
      size += ab.byteLength;
      if (size > 16 * 1024) { chunks = []; return; }
      chunks.push(Buffer.from(ab.slice(0)));
      if (last) cb(Buffer.concat(chunks).toString());
    });
  };

  app.get('/healthz', (res) => { res.writeHeader('content-type', 'application/json').end(JSON.stringify({ ok: true, relays: relays.size })); });
  app.any('/admin/*', (res, req) => {
    const method = req.getMethod(), path = req.getUrl(), auth = req.getHeader('authorization');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    readBody(res, (body) => {
      if (aborted) return;
      const out = o.admin({ method, path, auth, body });
      res.cork(() => {
        res.writeStatus(String(out.status)).writeHeader('content-type', 'application/json').end(JSON.stringify(out.body));
      });
    });
  });
  app.any('/*', (res) => { res.writeStatus('404 Not Found').end('not found'); });

  return new Promise((resolve, reject) => {
    app.listen(o.host ?? '0.0.0.0', o.port, (token) => {
      if (!token) return reject(new Error(`sim link could not listen on ${o.host ?? '0.0.0.0'}:${o.port}`));
      resolve({
        port: uWS.us_socket_local_port(token),
        broadcast: (frame) => { app.publish(TOPIC, frame, true); },
        broadcastEvent: (e: ServerEvent) => { app.publish(TOPIC, JSON.stringify(e), false); },
        send: (id, c) => { const r = relays.get(id); if (r) sendTo(r.ws, c); },
        sendAll: (c) => { app.publish(TOPIC, JSON.stringify(c), false); },
        relays: () => [...relays.values()].map((r) => r.info),
        takeInputTimes: () => { const t = inputTimes; inputTimes = []; return t; },
        latency,
        close: async () => {
          uWS.us_listen_socket_close(token);
          for (const r of relays.values()) r.ws.end(1001, 'sim shutting down');
          app.close();
        },
      });
    });
  });
}
