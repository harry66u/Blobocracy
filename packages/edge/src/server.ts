import { randomBytes } from 'node:crypto';
import uWS from 'uWebSockets.js';
import {
  DEFAULT_LINK_SAMPLE, Reservoir, decodeClient, encodePong, encodeSummary,
  type EdgeNotice, type ServerEvent, type SimControl,
} from '@blobocracy/shared';
import { gzipSync } from 'node:zlib';
import { ApiProxy, absolutizeMeta, clipPreview, originOf, simHttpBase, withPreview, type ClipMetaJson } from './api';
import { FrameGate, LoadMonitor, admit, DEFAULT_LOAD, type AdmitPolicy, type LoadThresholds } from './gate';
import { BanList, clientIp, ipKey } from './ip';
import { SimLink } from './link';
import { EdgeCrowd } from './players';
import { LocalAbuseShare, type AbuseShare } from './shared';
import { loadStatic, packedPage, placeholderPage, type StaticFile } from './static';
import { SessionAuthority } from './token';

export interface EdgeOptions {
  port: number;
  host?: string;
  /** The sim's relay link, e.g. ws://blobocracy.internal:8081/relay on Fly. */
  simUrl: string;
  relaySecret?: string;
  sessionSecret: string;
  /** Proof-of-work difficulty in leading zero bits (default 14 ≈ 50-150 ms on a phone; 0 = off). */
  powBits: number;
  tokenTtlS?: number;
  /** Votes all connections from one IP may weigh together (default 4). */
  ipVoteCap?: number;
  /** Sockets per IP (default 32). */
  ipConnCap?: number;
  /** Input changes per second per socket (default 20). */
  rateLimit?: number;
  /** The built client (packages/client/dist). */
  staticDir?: string;
  /** Honor `x-test-ip` (load tests only; NEVER in production). */
  trustTestIpHeader?: boolean;
  name?: string;
  /** This relay is one of the always-on ones (otherwise the sim picks the first to connect). */
  alwaysOn?: boolean;
  /** This machine's $/hour, reported to the budget governor. */
  hourlyUsd?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** Bytes of WebSocket + TLS + TCP/IP overhead counted per message sent, for the egress estimate. */
  egressOverheadBytes?: number;
  /** Treat ping timestamps as epoch ms and record client → edge latency (load tests on one machine). */
  latencyProbe?: boolean;
  load?: Partial<LoadThresholds>;
  summaryHz?: number;
  /** The sim's internal HTTP (the read API); default derived from simUrl (same host and port). */
  simHttpUrl?: string;
  /** Public origin for link previews, e.g. https://blobocracy.com (default: the request's Host). */
  publicUrl?: string;
  /** Per-IP counts and flags shared with the other relays (Redis); default: this relay only. */
  abuse?: AbuseShare;
}

interface PlayerData { id: number; ip: string; ipk: string; sid: string; watcher: boolean; idx: number }
type Sock = uWS.WebSocket<PlayerData>;

const SIM_DOWN = JSON.stringify({ t: 'sim', up: false } satisfies EdgeNotice);
const SIM_UP = JSON.stringify({ t: 'sim', up: true } satisfies EdgeNotice);
const MAX_MESSAGE_BYTES = 64;

/**
 * An edge relay (spec §4): serves the client and /session, holds player sockets, enforces the
 * abuse defenses (§8), merges inputs into one summary per tick for the sim, and fans the sim's
 * frames out byte-for-byte with uWS publish. Stateless: kill it any time, players reconnect.
 */
export async function startEdge(o: EdgeOptions) {
  const app = uWS.App();
  const auth = new SessionAuthority({ secret: o.sessionSecret, powBits: o.powBits, tokenTtlS: o.tokenTtlS });
  const abuse = o.abuse ?? new LocalAbuseShare();
  const crowd = new EdgeCrowd({
    ipVoteCap: o.ipVoteCap ?? 4, rateLimit: o.rateLimit ?? 20, sampleQuota: DEFAULT_LINK_SAMPLE,
    onFlag: (sid, reason) => abuse.flag(sid, reason),
  });
  const api = new ApiProxy(o.simHttpUrl ?? simHttpBase(o.simUrl));
  const bans = new BanList();
  const gate = new FrameGate();
  const load = new LoadMonitor({ ...DEFAULT_LOAD, ...o.load });
  const files = loadStatic(o.staticDir);
  const ipConnCap = o.ipConnCap ?? 32;
  const overhead = o.egressOverheadBytes ?? 80;
  const name = o.name ?? `edge-${randomBytes(3).toString('hex')}`;

  let policy: AdmitPolicy & { frameHz: number; sampleQuota: number } = { tier: 0, alwaysOn: true, capacity: 3000, frameHz: 20, sampleQuota: DEFAULT_LINK_SAMPLE };
  let welcomeText: string | null = null;
  let welcome: Extract<ServerEvent, { t: 'welcome' }> | null = null;
  let resync = false;
  let lastOnline = 0;
  let nextId = 1;
  const sockets: Sock[] = [];
  const bySid = new Map<string, Sock>();
  const ipConns = new Map<string, number>();
  let bytesUnreported = 0;
  let bytesTotal = 0;
  const counters = {
    framesIn: 0, framesPlay: 0, framesWatch: 0, sessionsIssued: 0, replaced: 0,
    rejected: { banned: 0, token: 0, ipCap: 0, packed: 0, pow: 0 },
  };
  const clientToEdge = new Reservoir(8192);
  let cpu = 0, rssMb = 0, backpressure = 0;

  const countSend = (len: number, n: number) => { const b = (len + overhead) * n; bytesUnreported += b; bytesTotal += b; };
  const publish = (topic: string, msg: ArrayBuffer | string, binary: boolean) => {
    const len = typeof msg === 'string' ? Buffer.byteLength(msg) : msg.byteLength;
    countSend(len, app.numSubscribers(topic));
    app.publish(topic, msg, binary);
  };
  const isPacked = () => admit(policy, crowd.stats().connections) === 'packed';

  const link = new SimLink({
    url: o.simUrl,
    secret: o.relaySecret,
    minBackoffMs: o.reconnectMinMs,
    maxBackoffMs: o.reconnectMaxMs,
    hello: () => ({ c: 'hello', name, alwaysOn: o.alwaysOn, hourlyUsd: o.hourlyUsd }),
    onFrame: (frame) => {
      counters.framesIn++;
      if (frame.byteLength >= 33) lastOnline = new DataView(frame).getUint32(29, true);
      const g = gate.next(load.degraded);
      if (g.play) { counters.framesPlay++; publish('play', frame, true); }
      if (g.watch) { counters.framesWatch++; publish('watch', frame, true); }
    },
    onEvent: (text) => publish('all', text, false),
    onControl: (c: SimControl) => {
      switch (c.c) {
        case 'policy':
          policy = { tier: c.tier, alwaysOn: c.alwaysOn, capacity: c.capacity, frameHz: c.frameHz, sampleQuota: c.sampleQuota };
          crowd.setSampleQuota(c.sampleQuota);
          break;
        case 'welcome':
          welcome = c.ev.t === 'welcome' ? c.ev : welcome;
          welcomeText = JSON.stringify(c.ev);
          if (resync) { resync = false; publish('all', welcomeText, false); }
          break;
        case 'bans':
          bans.replace(c.cidrs);
          for (const ws of [...sockets]) if (bans.has(ws.getUserData().ip)) ws.end(4003, 'banned');
          break;
        case 'resetFlags':
          crowd.resetFlags();
          abuse.resetFlags();
          break;
        case 'adminRes': {
          const p = adminPending.get(c.id);
          if (!p) break;
          adminPending.delete(c.id);
          clearTimeout(p.timer);
          if (!p.aborted) p.res.cork(() => { p.res.writeStatus(String(c.status)).writeHeader('content-type', 'application/json').end(JSON.stringify(c.body)); });
          break;
        }
      }
    },
    onUp: () => { resync = true; publish('all', SIM_UP, false); },
    onDown: () => { publish('all', SIM_DOWN, false); },
  });

  const ipOf = (res: uWS.HttpResponse, req: uWS.HttpRequest) => clientIp(
    { flyClientIp: req.getHeader('fly-client-ip'), testIp: req.getHeader('x-test-ip') },
    Buffer.from(res.getRemoteAddressAsText()).toString(),
    o.trustTestIpHeader === true,
  );
  const json = (res: uWS.HttpResponse, status: string, body: unknown, cache = 'no-store') => {
    const text = JSON.stringify(body);
    countSend(text.length + 200, 1);
    res.writeStatus(status).writeHeader('content-type', 'application/json').writeHeader('cache-control', cache).end(text);
  };
  const readBody = (res: uWS.HttpResponse, limit: number, cb: (body: string | null) => void) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.onData((ab, last) => {
      size += ab.byteLength;
      if (size <= limit) chunks.push(Buffer.from(ab.slice(0)));
      if (last) cb(size <= limit ? Buffer.concat(chunks).toString() : null);
    });
  };

  app.ws<PlayerData>('/ws', {
    compression: uWS.DISABLED,
    maxPayloadLength: MAX_MESSAGE_BYTES, // bigger messages close the socket
    maxBackpressure: 2048, // ~20 frames: slow sockets skip frames instead of queueing stale ones
    idleTimeout: 12, // clients ping every 2 s; a silently dead phone loses its vote within ~12 s
    sendPingsAutomatically: true,
    upgrade: (res, req, context) => {
      const ip = ipOf(res, req);
      const key = req.getHeader('sec-websocket-key'), proto = req.getHeader('sec-websocket-protocol'), ext = req.getHeader('sec-websocket-extensions');
      const t = new URLSearchParams(req.getQuery() ?? '').get('t') ?? '';
      if (bans.has(ip)) { counters.rejected.banned++; res.writeStatus('403 Forbidden').end(); return; }
      const session = auth.verify(t);
      if (!session) { counters.rejected.token++; res.writeStatus('401 Unauthorized').end('session token required'); return; }
      const ipk = ipKey(ip);
      if ((ipConns.get(ipk) ?? 0) + abuse.remoteConns(ipk) >= ipConnCap) { counters.rejected.ipCap++; res.writeStatus('429 Too Many Requests').end('too many connections from this address'); return; }
      const role = admit(policy, crowd.stats().connections);
      if (role === 'packed') { counters.rejected.packed++; res.writeStatus('503 Service Unavailable').end('packed'); return; }
      res.upgrade<PlayerData>({ id: nextId++, ip, ipk, sid: session.sid, watcher: role === 'watcher', idx: -1 }, key, proto, ext, context);
    },
    open: (ws) => {
      const d = ws.getUserData();
      d.idx = sockets.length;
      sockets.push(ws);
      ipConns.set(d.ipk, (ipConns.get(d.ipk) ?? 0) + 1);
      const old = bySid.get(d.sid);
      bySid.set(d.sid, ws);
      if (old) { counters.replaced++; old.end(4000, 'replaced by a newer connection'); }
      crowd.add(d.id, d.ip, d.sid, d.watcher);
      // flagged on another relay within the hour: stays shadow-ignored here too
      const id = d.id;
      void abuse.lookupFlag(d.sid).then((reason) => { if (reason && crowd.has(id)) crowd.flag(id, reason, true); });
      ws.subscribe(d.watcher ? 'watch' : 'play');
      ws.subscribe('all');
      if (welcomeText) ws.send(welcomeText, false);
      if (!link.up) ws.send(SIM_DOWN, false);
    },
    message: (ws, msg, isBinary) => {
      if (!isBinary) return;
      const m = decodeClient(msg);
      if (!m) return;
      if (m.type === 'input') { crowd.input(ws.getUserData().id, m.bits, Date.now()); return; }
      if (o.latencyProbe) {
        const oneWay = (Date.now() % 2 ** 32 - m.t + 2 ** 32) % 2 ** 32;
        if (oneWay < 60_000) clientToEdge.add(oneWay);
      }
      countSend(5, 1);
      ws.send(encodePong(m.t), true);
    },
    close: (ws) => {
      const d = ws.getUserData();
      crowd.remove(d.id);
      const n = (ipConns.get(d.ipk) ?? 1) - 1;
      if (n > 0) ipConns.set(d.ipk, n); else ipConns.delete(d.ipk);
      if (bySid.get(d.sid) === ws) bySid.delete(d.sid);
      const last = sockets.pop()!;
      if (last !== ws) { sockets[d.idx] = last; last.getUserData().idx = d.idx; }
    },
  });

  app.get('/session', (res, req) => {
    const ip = ipOf(res, req);
    if (bans.has(ip)) { counters.rejected.banned++; return json(res, '403 Forbidden', { error: 'banned' }); }
    if (isPacked()) { counters.rejected.packed++; return json(res, '503 Service Unavailable', { packed: true }); }
    json(res, '200 OK', auth.challenge());
  });
  app.post('/session', (res, req) => {
    const ip = ipOf(res, req);
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    readBody(res, 2048, (body) => {
      if (aborted) return;
      res.cork(() => {
        if (bans.has(ip)) { counters.rejected.banned++; return json(res, '403 Forbidden', { error: 'banned' }); }
        let m: { challenge?: unknown; nonce?: unknown } = {};
        try { m = JSON.parse(body ?? '') as typeof m; } catch { /* below */ }
        const r = auth.redeem(String(m.challenge ?? ''), Number(m.nonce));
        if ('error' in r) { counters.rejected.pow++; return json(res, '400 Bad Request', r); }
        counters.sessionsIssued++;
        json(res, '200 OK', r);
      });
    });
  });
  app.get('/api/counter', (res) => {
    json(res, '200 OK', {
      deaths: welcome?.deaths ?? null, run: welcome?.run ?? null, record: welcome?.record ?? null,
      online: lastOnline, packed: isPacked(), simUp: link.up,
    }, 'public, max-age=10');
  });
  // the read API (run history, hall of fame, clips): proxied to the sim and cached here
  app.get('/api/*', (res, req) => {
    const q = req.getQuery();
    const key = req.getUrl() + (q ? `?${q}` : '');
    let aborted = false;
    res.onAborted(() => { aborted = true; });
    void api.get(key).then((r) => {
      if (aborted) return;
      countSend(r.body.length + 250, 1);
      res.cork(() => { res.writeStatus(String(r.status)).writeHeader('content-type', r.type).writeHeader('cache-control', r.cache).end(r.body); });
    });
  });
  app.get('/healthz', (res) => { json(res, '200 OK', { ok: true, simUp: link.up, connections: sockets.length }); });

  let adminSeq = 0;
  const adminPending = new Map<number, { res: uWS.HttpResponse; timer: ReturnType<typeof setTimeout>; aborted: boolean }>();
  // uWS prefers method routes over `any`, so GET /admin/* must be registered explicitly ahead of GET /*.
  const adminRoute = (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
    const method = req.getMethod(), path = req.getUrl(), authz = req.getHeader('authorization');
    const p = { res, timer: undefined as unknown as ReturnType<typeof setTimeout>, aborted: false };
    res.onAborted(() => { p.aborted = true; });
    readBody(res, 8192, (body) => {
      if (p.aborted) return;
      const id = ++adminSeq;
      const sent = body !== null && link.send(JSON.stringify({ c: 'admin', id, method, path, auth: authz, body }));
      if (!sent) { res.cork(() => json(res, '503 Service Unavailable', { error: 'sim unreachable' })); return; }
      p.timer = setTimeout(() => {
        adminPending.delete(id);
        if (!p.aborted) res.cork(() => json(res, '504 Gateway Timeout', { error: 'sim did not answer' }));
      }, 5000);
      adminPending.set(id, p);
    });
  };
  app.get('/admin/*', adminRoute);
  app.post('/admin/*', adminRoute);
  app.any('/admin/*', adminRoute);
  // HTML with absolute preview URLs, per origin (PUBLIC_URL, or each Host the site is reached on)
  const htmlCache = new Map<string, StaticFile>();
  const htmlFor = (url: string, f: StaticFile, origin: string, preview?: ClipMetaJson): StaticFile => {
    const key = `${url}|${origin}|${preview?.id ?? ''}`;
    let h = htmlCache.get(key);
    if (!h) {
      let text = absolutizeMeta(f.body.toString(), origin);
      if (preview) text = withPreview(text, clipPreview(preview, origin));
      const body = Buffer.from(text);
      h = { ...f, body, gzip: gzipSync(body) };
      if (htmlCache.size > 2000) htmlCache.clear();
      htmlCache.set(key, h);
    }
    return h;
  };
  const send = (res: uWS.HttpResponse, f: StaticFile, gzipOk: boolean) => {
    const gz = f.gzip && gzipOk;
    const body = gz ? f.gzip! : f.body;
    countSend(body.length + 250, 1);
    res.writeHeader('content-type', f.type).writeHeader('cache-control', f.cache);
    if (gz) res.writeHeader('content-encoding', 'gzip');
    res.end(body);
  };
  app.get('/*', (res, req) => {
    let url = req.getUrl();
    if (url === '/' || url === '/index.html') {
      if (isPacked()) {
        counters.rejected.packed++;
        const page = packedPage();
        countSend(page.length + 200, 1);
        res.writeHeader('content-type', 'text/html; charset=utf-8').writeHeader('cache-control', 'no-store').end(page);
        return;
      }
      url = '/index.html';
      if (!files.has(url)) { res.writeHeader('content-type', 'text/html; charset=utf-8').end(placeholderPage()); return; }
    }
    if (url === '/runs' || url === '/runs/') url = '/runs.html';
    else if (url === '/hall' || url === '/hall/') url = '/hall.html';
    const gzipOk = req.getHeader('accept-encoding').includes('gzip');
    const origin = originOf(o.publicUrl, req.getHeader('host'), req.getHeader('x-forwarded-proto') === 'http' ? 'http' : 'https');
    const clip = url.match(/^\/c\/([A-Za-z0-9_-]{1,64})\/?$/);
    if (clip) {
      // clip links: the clip page with this clip's title and preview image for link unfurls
      const page = files.get('/clip.html');
      if (!page) { res.writeStatus('404 Not Found').end('not found'); return; }
      let aborted = false;
      res.onAborted(() => { aborted = true; });
      void api.get(`/api/clips/${clip[1]}/meta`).then((r) => {
        if (aborted) return;
        let meta: ClipMetaJson | undefined;
        if (r.status === 200) { try { meta = JSON.parse(r.body.toString()) as ClipMetaJson; } catch { /* plain page */ } }
        res.cork(() => send(res, htmlFor('/clip.html', page, origin, meta), gzipOk));
      });
      return;
    }
    const f = files.get(url);
    if (!f) { res.writeStatus('404 Not Found').end('not found'); return; }
    send(res, f.type.startsWith('text/html') ? htmlFor(url, f, origin) : f, gzipOk);
  });
  app.any('/*', (res) => { res.writeStatus('404 Not Found').end('not found'); });

  // One summary per sim tick at most, sent only when it changed (plus a 1 s keepalive with the byte count).
  let seq = 0, lastSent = 0, lastKey: Buffer | null = null, pendingOldest = 0;
  const summaryTimer = setInterval(() => {
    const now = Date.now();
    const s = crowd.summarize(now);
    if (s.oldestInputAt && (!pendingOldest || s.oldestInputAt < pendingOldest)) pendingOldest = s.oldestInputAt;
    if (!link.up) return;
    const enc = encodeSummary({ ...s, seq: 0, bytesSent: 0, oldestInputAt: 0 });
    const key = Buffer.from(enc.buffer, 0, enc.length);
    if (lastKey && key.equals(lastKey) && now - lastSent < 1000) return;
    const dv = new DataView(enc.buffer);
    dv.setUint32(1, ++seq, true);
    dv.setFloat64(65, bytesUnreported, true);
    dv.setFloat64(73, pendingOldest, true);
    if (link.send(enc)) {
      bytesUnreported = 0;
      pendingOldest = 0;
      lastKey = Buffer.from(key);
      lastSent = now;
    }
  }, 1000 / (o.summaryHz ?? 60));

  let lastCpu = process.cpuUsage(), lastWall = performance.now();
  const loadTimer = setInterval(() => {
    const c = process.cpuUsage(), w = performance.now();
    cpu = ((c.user - lastCpu.user + c.system - lastCpu.system) / 1000) / Math.max(1, w - lastWall);
    lastCpu = c; lastWall = w;
    rssMb = process.memoryUsage().rss / 1048576;
    const n = Math.min(64, sockets.length);
    let backed = 0;
    for (let i = 0; i < n; i++) {
      const ws = sockets[Math.floor(Math.random() * sockets.length)]!;
      if (ws.getBufferedAmount() > 1024) backed++;
    }
    backpressure = n ? backed / n : 0;
    const was = load.degraded;
    if (load.sample(cpu, backpressure, Date.now()) !== was) console.log(`[edge ${name}] ${load.degraded ? 'overloaded: sending every other frame' : 'back to full frame rate'} (cpu ${(cpu * 100).toFixed(0)}%, backpressure ${(backpressure * 100).toFixed(0)}%)`);
  }, 1000);

  const stats = () => ({
    name, simUp: link.up, degraded: load.degraded, cpu: Math.round(cpu * 1000) / 1000, rssMb: Math.round(rssMb),
    backpressure, policy, ips: ipConns.size, ...crowd.stats(), ...counters,
    bytesSent: bytesTotal, clientToEdgeMs: o.latencyProbe ? clientToEdge.summary() : undefined, apiCache: api.stats(),
    flaggedList: crowd.flaggedList(1000),
  });
  const statsTimer = setInterval(() => { link.send(JSON.stringify({ c: 'stats', stats: stats() })); }, 2000);

  const listen = await new Promise<uWS.us_listen_socket>((resolve, reject) => {
    app.listen(o.host ?? '0.0.0.0', o.port, (t) => (t ? resolve(t) : reject(new Error(`edge could not listen on ${o.port}`))));
  });

  return {
    port: uWS.us_socket_local_port(listen),
    name,
    state: () => ({ simUp: link.up, policy, connections: sockets.length, degraded: load.degraded }),
    /** Sockets per IP key on this relay (published to Redis for the shared cap). */
    ipConns: () => new Map(ipConns),
    stats,
    stop: async () => {
      clearInterval(summaryTimer); clearInterval(loadTimer); clearInterval(statsTimer);
      link.close();
      abuse.close();
      for (const p of adminPending.values()) clearTimeout(p.timer);
      uWS.us_listen_socket_close(listen);
      app.close();
    },
  };
}

