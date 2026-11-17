/**
 * One bot worker process: opens real WebSockets through the real front door (GET /session,
 * proof of work, POST /session, /ws?t=token) and plays according to each bot's profile.
 * Reports counters to the parent (main.ts) once a second over IPC.
 */
import { IN_JUMP, IN_LEFT, IN_RIGHT, LEVEL1, MSG_PONG, MSG_STATE, encodeInput, encodePing, solvePow } from '@blobocracy/shared';
import { hazardAhead } from '../../sim/src/virtual';
import type { BotSpec, Profile } from './profiles';

export interface WorkerInit { specs: BotSpec[]; ratePerS: number; maxInflight: number }
export interface WorkerReport {
  connected: number; connecting: number; frames: number; events: number; inputsSent: number;
  rtt: number[];
  failed: Record<string, number>;
  /** Sockets the server closed after they opened, by close code. */
  closedByServer: Record<string, number>;
  byProfile: Record<string, { connected: number; refused: number }>;
}

const L = IN_LEFT, R = IN_RIGHT, J = IN_JUMP;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Bot {
  spec: BotSpec;
  ws: WebSocket | null;
  bits: number;
  open: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
  jumpPlanned: boolean;
}

const report: WorkerReport = { connected: 0, connecting: 0, frames: 0, events: 0, inputsSent: 0, rtt: [], failed: {}, closedByServer: {}, byProfile: {} };
const bots: Bot[] = [];
const followers = new Set<Bot>();
const farms = new Map<number, Set<Bot>>();
let observer: Bot | null = null;
let prevDanger = false, prevGrounded = true;
let stopping = false;

const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
const prof = (p: Profile) => (report.byProfile[p] ??= { connected: 0, refused: 0 });

function later(b: Bot, ms: number, fn: () => void) {
  const t = setTimeout(() => { b.timers.delete(t); if (b.open) fn(); }, ms);
  b.timers.add(t);
}

function send(b: Bot, bits: number) {
  if (!b.open || b.bits === bits) return;
  b.bits = bits;
  b.ws!.send(encodeInput(bits));
  report.inputsSent++;
}

async function session(spec: BotSpec): Promise<string> {
  const base = spec.url.replace(/^ws/, 'http').replace(/\/ws$/, '');
  const headers = { 'x-test-ip': spec.ip };
  const r = await fetch(`${base}/session`, { headers });
  if (r.status === 503) throw new Error('packed');
  if (r.status === 403) throw new Error('banned');
  if (!r.ok) throw new Error(`session-${r.status}`);
  const c = await r.json() as { challenge: string; bits: number };
  const nonce = solvePow(c.challenge, c.bits);
  const t = await fetch(`${base}/session`, { method: 'POST', headers, body: JSON.stringify({ challenge: c.challenge, nonce }) });
  if (!t.ok) throw new Error(`token-${t.status}`);
  return ((await t.json()) as { token: string }).token;
}

/** One bot in each worker reads frames for everyone: is a gap, spike or step coming? */
function observe(frame: ArrayBuffer) {
  const dv = new DataView(frame);
  if (frame.byteLength < 46) return;
  const x = dv.getFloat32(9, true), y = dv.getFloat32(13, true), vx = dv.getFloat32(17, true);
  const flags = dv.getUint8(25);
  const grounded = (flags & 1) !== 0, running = ((flags >> 3) & 3) === 0;
  const dir = Math.sign(vx) || 1;
  const danger = running && hazardAhead(LEVEL1, x, y, dir, 1.2 + Math.abs(vx) * 0.35);
  const cue = danger && (!prevDanger || (grounded && !prevGrounded));
  prevDanger = danger; prevGrounded = grounded;
  if (!cue) return;
  for (const f of followers) {
    if (f.jumpPlanned || Math.random() > 0.9) continue; // some people miss the cue
    f.jumpPlanned = true;
    later(f, rand(150, 400), () => {
      send(f, f.bits | J);
      later(f, rand(250, 600), () => { f.jumpPlanned = false; send(f, f.bits & ~J); });
    });
  }
}

function startProfile(b: Bot) {
  switch (b.spec.profile) {
    case 'follower': {
      followers.add(b);
      const roll = () => {
        const r = Math.random();
        const dir = r < 0.85 ? R : r < 0.93 ? 0 : L;
        send(b, dir | (b.bits & J));
        later(b, rand(500, 2500), roll);
      };
      later(b, rand(100, 1500), roll);
      break;
    }
    case 'random': {
      const choices = [0, L, R, R | J, L | J, J];
      const roll = () => { send(b, choices[Math.floor(Math.random() * choices.length)]!); later(b, rand(300, 1500), roll); };
      later(b, rand(100, 1500), roll);
      break;
    }
    case 'idle':
      later(b, rand(500, 3000), () => { send(b, R); later(b, rand(500, 1500), () => send(b, 0)); });
      break;
    case 'spammer': {
      const flood = () => { send(b, b.bits === L ? R : L); later(b, rand(8, 25), flood); };
      later(b, rand(100, 1000), flood);
      break;
    }
    case 'perfect-timing': {
      // A metronome: right held, jump toggled every 200 ms exactly (each bot on its own phase,
      // so it is the timing check that catches them, not the identical-stream one).
      const phase = Math.random() * 200;
      const wait = () => 200 - ((Date.now() - phase) % 200);
      const tick = () => { send(b, b.bits & J ? R : R | J); later(b, wait(), tick); };
      later(b, wait(), tick);
      break;
    }
    case 'farm': {
      let group = farms.get(b.spec.group);
      if (!group) {
        group = new Set();
        farms.set(b.spec.group, group);
        const members = group;
        // One script drives every socket of the farm at the same instant.
        const drive = () => {
          if (stopping) return;
          const bits = [R, R | J, L, 0][Math.floor(Math.random() * 4)]!;
          for (const m of members) send(m, bits);
          setTimeout(drive, rand(250, 600));
        };
        setTimeout(drive, 1000);
      }
      group.add(b);
      break;
    }
  }
}

async function launch(b: Bot) {
  report.connecting++;
  let token: string;
  try {
    token = await session(b.spec);
  } catch (e) {
    report.connecting--;
    bump(report.failed, (e as Error).message);
    prof(b.spec.profile).refused++;
    return;
  }
  const ws = new WebSocket(`${b.spec.url}?t=${encodeURIComponent(token)}`, { headers: { 'x-test-ip': b.spec.ip } } as unknown as string[]);
  ws.binaryType = 'arraybuffer';
  b.ws = ws;
  let settled = false;
  const refused = () => {
    if (settled) return;
    settled = true;
    report.connecting--;
    bump(report.failed, 'handshake-refused');
    prof(b.spec.profile).refused++;
  };
  ws.onerror = () => { if (!b.open) refused(); };
  ws.onopen = () => {
    settled = true;
    report.connecting--;
    report.connected++;
    prof(b.spec.profile).connected++;
    b.open = true;
    if (!observer && b.spec.profile === 'follower') observer = b;
    startProfile(b);
    const ping = () => { ws.send(encodePing(Date.now() % 2 ** 32)); later(b, 2000, ping); };
    later(b, rand(0, 2000), ping);
  };
  ws.onmessage = (m) => {
    if (typeof m.data === 'string') { report.events++; return; }
    const buf = m.data as ArrayBuffer;
    const type = new Uint8Array(buf, 0, 1)[0];
    if (type === MSG_STATE) {
      report.frames++;
      if (observer === b) observe(buf);
    } else if (type === MSG_PONG && buf.byteLength === 5) {
      const t = new DataView(buf).getUint32(1, true);
      report.rtt.push((Date.now() % 2 ** 32 - t + 2 ** 32) % 2 ** 32);
    }
  };
  ws.onclose = (ev) => {
    if (!b.open) { refused(); return; }
    b.open = false;
    report.connected--;
    prof(b.spec.profile).connected--;
    if (!stopping) bump(report.closedByServer, String(ev.code));
    for (const t of b.timers) clearTimeout(t);
    b.timers.clear();
    followers.delete(b);
    farms.get(b.spec.group)?.delete(b);
    if (observer === b) observer = [...followers][0] ?? null;
  };
}

function run(init: WorkerInit) {
  for (const spec of init.specs) bots.push({ spec, ws: null, bits: 0, open: false, timers: new Set(), jumpPlanned: false });
  let next = 0;
  const step = Math.max(1, Math.round(init.ratePerS / 20));
  const ramp = setInterval(() => {
    for (let i = 0; i < step && next < bots.length && report.connecting < init.maxInflight; i++) void launch(bots[next++]!);
    if (next >= bots.length) clearInterval(ramp);
  }, 50);
  setInterval(() => {
    process.send?.({ type: 'report', report });
    report.frames = 0; report.events = 0; report.inputsSent = 0; report.rtt = [];
  }, 1000);
}

process.on('message', (m: { type: string; init?: WorkerInit }) => {
  if (m.type === 'init' && m.init) run(m.init);
  if (m.type === 'stop') {
    stopping = true;
    for (const b of bots) b.ws?.close();
    setTimeout(() => process.exit(0), 500);
  }
});
