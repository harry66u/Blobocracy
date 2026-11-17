import uWS from 'uWebSockets.js';
import { decodeClient, encodePong, type ServerEvent } from '@blobocracy/shared';
import type { Voters } from './crowd';
import type { World } from './world';

/** Where state frames and events go. Milestone 4 adds remote edge relays behind this interface. */
export interface Relay {
  broadcast(frame: Uint8Array): void;
  broadcastEvent(e: ServerEvent): void;
  close(): Promise<void>;
}

const TOPIC = 'world';
const MAX_MESSAGE_BYTES = 64;

interface SocketData { id: number }

/** Serves browsers directly from the sim process (milestone 1 only). */
export function startLocalRelay(opts: { port: number; voters: Voters; world: World; clock: () => number }):
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
        { id: nextId++ },
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
      if (!isBinary) return;
      const m = decodeClient(msg);
      if (!m) return;
      if (m.type === 'input') voters.setInput(ws.getUserData().id, m.bits, clock());
      else ws.send(encodePong(m.t), true);
    },
    close: (ws) => {
      voters.leave(ws.getUserData().id);
    },
  });

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
