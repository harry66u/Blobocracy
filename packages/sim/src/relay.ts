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
/** Close code telling the client the game is full; it shows the packed screen and retries later. */
export const CLOSE_PACKED = 4001;

interface SocketData { id: number; admitted: boolean }

export interface RelayOptions {
  port: number;
  voters: Voters;
  world: World;
  clock: () => number;
  /** How many players may be connected right now (budget level and MAX_PLAYERS). */
  capacity?: () => number;
  /** Bytes about to go out to players, for the spend estimate. */
  onBytes?: (n: number) => void;
  /** A player was turned away because the game is full. */
  onTurnedAway?: () => void;
  /** Registers HTTP routes on the same app (static files, analytics, status…). */
  routes?: (app: uWS.TemplatedApp) => void;
}

/** Serves browsers directly from the sim process (until milestone 4 splits out edge relays). */
export function startLocalRelay(opts: RelayOptions): Promise<Relay & { port: number; app: uWS.TemplatedApp; players(): number }> {
  const { voters, world, clock } = opts;
  const capacity = opts.capacity ?? (() => Infinity);
  const onBytes = opts.onBytes ?? (() => {});
  let nextId = 1;
  let players = 0;
  const app = uWS.App();

  app.ws<SocketData>('/ws', {
    compression: uWS.DISABLED,
    maxPayloadLength: MAX_MESSAGE_BYTES, // bigger messages close the socket
    maxBackpressure: 2048, // ~20 frames: slow sockets skip frames instead of queueing stale ones
    idleTimeout: 12, // clients ping every 2 s; a silently dead phone loses its vote within ~12 s
    sendPingsAutomatically: true,
    upgrade: (res, req, context) => {
      res.upgrade<SocketData>(
        { id: nextId++, admitted: false },
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context,
      );
    },
    open: (ws) => {
      const d = ws.getUserData();
      if (players >= capacity()) {
        // Full (MAX_PLAYERS or the budget cap): tell them why, with the live counter, and close.
        const msg = JSON.stringify({ t: 'packed', deaths: world.deaths, online: players } satisfies ServerEvent);
        onBytes(msg.length);
        ws.send(msg, false);
        ws.end(CLOSE_PACKED, 'packed');
        opts.onTurnedAway?.();
        return;
      }
      d.admitted = true;
      players++;
      voters.join(d.id);
      ws.subscribe(TOPIC);
      const welcome = JSON.stringify(world.welcome(voters.size()));
      onBytes(welcome.length);
      ws.send(welcome, false);
    },
    message: (ws, msg, isBinary) => {
      if (!isBinary || !ws.getUserData().admitted) return;
      const m = decodeClient(msg);
      if (!m) return;
      if (m.type === 'input') voters.setInput(ws.getUserData().id, m.bits, clock());
      else { onBytes(5); ws.send(encodePong(m.t), true); }
    },
    close: (ws) => {
      const d = ws.getUserData();
      if (!d.admitted) return;
      players--;
      voters.leave(d.id);
    },
  });

  opts.routes?.(app);

  return new Promise((resolve, reject) => {
    app.listen('0.0.0.0', opts.port, (token) => {
      if (!token) return reject(new Error(`could not listen on port ${opts.port}`));
      resolve({
        port: uWS.us_socket_local_port(token),
        app,
        players: () => players,
        broadcast: (frame) => { onBytes(frame.length * app.numSubscribers(TOPIC)); app.publish(TOPIC, frame, true); },
        broadcastEvent: (e) => {
          const s = JSON.stringify(e);
          onBytes(s.length * app.numSubscribers(TOPIC));
          app.publish(TOPIC, s, false);
        },
        close: async () => { uWS.us_listen_socket_close(token); app.close(); },
      });
    });
  });
}
