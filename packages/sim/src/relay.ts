import uWS from 'uWebSockets.js';
import { MAX_NAME_MESSAGE_BYTES, NameChangeLimiter, cleanName, decodeClient, encodePong, parseNameMessage, type EdgeNotice, type ServerEvent } from '@blobocracy/shared';
import type { AdminRequest, AdminResponse } from './admin';
import { mountApi, type ApiHandler } from './api';
import type { Voters } from './crowd';
import type { World } from './world';

/** Where state frames and events go: the in-process relay (dev) and the link to edge relays (hub.ts). */
export interface Relay {
  broadcast(frame: Uint8Array): void;
  broadcastEvent(e: ServerEvent): void;
  close(): Promise<void>;
}

const TOPIC = 'world';
const MAX_MESSAGE_BYTES = MAX_NAME_MESSAGE_BYTES;

interface SocketData { id: number; names: NameChangeLimiter }

/** Serves browsers directly from the sim process: single-process dev mode (`npm run dev`). */
export function startLocalRelay(opts: { port: number; voters: Voters; world: World; clock: () => number; api?: ApiHandler; admin?: (r: AdminRequest) => AdminResponse }):
  Promise<Relay & { port: number }> {
  const { voters, world, clock } = opts;
  let nextId = 1;
  const app = uWS.App();

  app.ws<SocketData>('/ws', {
    compression: uWS.DISABLED,
    maxPayloadLength: MAX_MESSAGE_BYTES, // bigger messages close the socket
    maxBackpressure: 2048, // ~20 frames: slow sockets skip frames instead of queueing stale ones
    idleTimeout: 12, // clients ping every 2 s; a silently dead phone loses its vote within ~12 s
    sendPingsAutomatically: true,
    upgrade: (res, req, context) => {
      res.upgrade<SocketData>(
        { id: nextId++, names: new NameChangeLimiter() },
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context,
      );
    },
    open: (ws) => {
      voters.join(ws.getUserData().id);
      ws.subscribe(TOPIC);
      ws.send(JSON.stringify(world.welcome(voters.size())), false);
    },
    message: (ws, msg, isBinary) => {
      if (!isBinary) {
        const n = parseNameMessage(Buffer.from(msg).toString());
        if (!n) return;
        const d = ws.getUserData();
        const clean = d.names.allow(Date.now()) ? cleanName(n.name) : null;
        if (clean !== null) voters.setName(d.id, clean);
        ws.send(JSON.stringify(clean !== null ? { t: 'name', ok: true, name: clean } satisfies EdgeNotice : { t: 'name', ok: false } satisfies EdgeNotice), false);
        return;
      }
      const m = decodeClient(msg);
      if (!m) return;
      if (m.type === 'input') voters.setInput(ws.getUserData().id, m.bits, clock());
      else ws.send(encodePong(m.t), true);
    },
    close: (ws) => {
      voters.leave(ws.getUserData().id);
    },
  });

  if (opts.api) { const api = opts.api; mountApi(app, () => api); }
  if (opts.admin) {
    // the admin API on the dev relay too (Bearer ADMIN_TOKEN), e.g. POST /admin/debug/win
    const admin = opts.admin;
    const route = (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
      const method = req.getMethod(), path = req.getUrl(), auth = req.getHeader('authorization');
      let aborted = false, size = 0;
      const chunks: Buffer[] = [];
      res.onAborted(() => { aborted = true; });
      res.onData((ab, last) => {
        size += ab.byteLength;
        if (size <= 16 * 1024) chunks.push(Buffer.from(ab.slice(0)));
        if (!last || aborted) return;
        const out = admin({ method, path, auth, body: Buffer.concat(chunks).toString() });
        res.cork(() => { res.writeStatus(String(out.status)).writeHeader('content-type', 'application/json').end(JSON.stringify(out.body)); });
      });
    };
    app.get('/admin/*', route);
    app.post('/admin/*', route);
  }
  // No session service in single-process dev: the client sees 404 on /session and connects without a token.
  app.any('/*', (res) => { res.writeStatus('404 Not Found').end('not found'); });

  return new Promise((resolve, reject) => {
    app.listen('0.0.0.0', opts.port, (token) => {
      if (!token) return reject(new Error(`could not listen on port ${opts.port}`));
      resolve({
        port: uWS.us_socket_local_port(token),
        broadcast: (frame) => { app.publish(TOPIC, frame, true); },
        broadcastEvent: (e) => { app.publish(TOPIC, JSON.stringify(e), false); },
        close: async () => { uWS.us_listen_socket_close(token); app.close(); },
      });
    });
  });
}
