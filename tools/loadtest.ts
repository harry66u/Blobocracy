// Spike load test: real WebSocket players against the real server in its own process.
//   npx tsx tools/loadtest.ts [--peak 4000] [--ramp 10] [--hold 45] [--max-players 3500] [--workers 4] [--url ws://host/ws --health http://host/api/health?key=…]
// Profile: 30 players for 10 s (normal), then a spike to --peak over --ramp seconds, held for
// --hold seconds, then everyone but 30 leaves at once and the server is watched recovering.
// Each bot changes its input every 0.3–3 s like a person and pings every 2 s.
// Without --url, the tool starts `packages/sim/src/main.ts` itself with MAX_PLAYERS=--max-players.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

interface Tally {
  open: number; welcomed: number; packed: number; failed: number;
  frames: number; gaps: number[]; rtts: number[]; connectMs: number[];
}
const blank = (): Tally => ({ open: 0, welcomed: 0, packed: 0, failed: 0, frames: 0, gaps: [], rtts: [], connectMs: [] });

// ------------------------------------------------------------------- worker: a batch of bots
if (!isMainThread) {
  const { url, id } = workerData as { url: string; id: number };
  let t = blank();
  const socks = new Set<WebSocket>();
  const open = (n: number) => {
    for (let i = 0; i < n; i++) {
      const started = performance.now();
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      let last = 0, welcomed = false, packed = false;
      let timer: ReturnType<typeof setTimeout> | undefined, ping: ReturnType<typeof setInterval> | undefined;
      ws.onopen = () => {
        t.open++;
        socks.add(ws);
        const act = () => {
          if (ws.readyState !== 1) return;
          ws.send(new Uint8Array([1, Math.random() < 0.7 ? 2 | (Math.random() < 0.4 ? 4 : 0) : Math.floor(Math.random() * 8)]));
          timer = setTimeout(act, 300 + Math.random() * 2700);
        };
        timer = setTimeout(act, Math.random() * 2000);
        ping = setInterval(() => {
          if (ws.readyState !== 1) return;
          const b = new Uint8Array(5); b[0] = 2;
          new DataView(b.buffer).setUint32(1, Math.floor(performance.now()) >>> 0, true);
          ws.send(b);
        }, 2000);
      };
      ws.onmessage = (m) => {
        if (typeof m.data === 'string') {
          if (m.data.includes('"welcome"')) { welcomed = true; t.welcomed++; t.connectMs.push(performance.now() - started); }
          else if (m.data.includes('"packed"')) { packed = true; t.packed++; }
          return;
        }
        const u8 = new Uint8Array(m.data as ArrayBuffer);
        if (u8[0] === 10) {
          const now = performance.now();
          if (last) t.gaps.push(now - last);
          last = now;
          t.frames++;
        } else if (u8[0] === 12 && u8.length === 5) {
          t.rtts.push(((Math.floor(performance.now()) >>> 0) - new DataView(u8.buffer).getUint32(1, true)));
        }
      };
      ws.onclose = () => { clearTimeout(timer); clearInterval(ping); socks.delete(ws); if (!welcomed && !packed) t.failed++; };
      ws.onerror = () => {};
    }
  };
  parentPort!.on('message', (msg: { open?: number; close?: number; report?: boolean }) => {
    if (msg.open) open(msg.open);
    if (msg.close) { let k = msg.close; for (const ws of socks) { if (k-- <= 0) break; ws.close(); } }
    if (msg.report) { parentPort!.postMessage({ id, live: socks.size, t }); t = blank(); }
  });
} else {
  // ---------------------------------------------------------------- main: drive and measure
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1]! : d; };
  const PEAK = Number(arg('peak', '4000')), RAMP = Number(arg('ramp', '10')), HOLD = Number(arg('hold', '45'));
  const MAXP = Number(arg('max-players', '3500')), WORKERS = Number(arg('workers', '4')), BASE = 30;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let url = arg('url', ''), healthUrl = arg('health', '');
  let server: ReturnType<typeof spawn> | null = null;
  if (!url) {
    const port = 8790;
    server = spawn('npx', ['tsx', 'packages/sim/src/main.ts'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, PORT: String(port), MAX_PLAYERS: String(MAXP), ADMIN_KEY: 'loadtest', DATA_DIR: join(root, 'tools/out/loadtest-data'), STATIC_DIR: join(root, 'packages/client/dist') },
    });
    server.stderr!.on('data', (d) => process.stderr.write(`[server] ${d}`));
    process.on('exit', () => { try { process.kill(-server!.pid!, 'SIGTERM'); } catch { /* gone */ } });
    url = `ws://127.0.0.1:${port}/ws`;
    healthUrl = `http://127.0.0.1:${port}/api/health?key=loadtest`;
    for (let i = 0; ; i++) {
      try { if ((await fetch(healthUrl)).ok) break; } catch { /* starting */ }
      if (i > 150) throw new Error('server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const workers = Array.from({ length: WORKERS }, (_, id) => new Worker(fileURLToPath(import.meta.url), { workerData: { url, id }, execArgv: ['--import', 'tsx'] }));
  const openN = (n: number) => { for (let i = 0; i < WORKERS; i++) workers[i]!.postMessage({ open: Math.floor(n / WORKERS) + (i < n % WORKERS ? 1 : 0) }); };
  const closeN = (n: number) => { for (let i = 0; i < WORKERS; i++) workers[i]!.postMessage({ close: Math.floor(n / WORKERS) + (i < n % WORKERS ? 1 : 0) }); };
  const collect = () => new Promise<{ live: number; t: Tally }>((resolve) => {
    const got: { live: number; t: Tally }[] = [];
    for (const w of workers) {
      w.once('message', (m) => { got.push(m); if (got.length === WORKERS) {
        const t = blank(); let live = 0;
        for (const g of got) {
          live += g.live;
          t.open += g.t.open; t.welcomed += g.t.welcomed; t.packed += g.t.packed; t.failed += g.t.failed; t.frames += g.t.frames;
          t.gaps.push(...g.t.gaps); t.rtts.push(...g.t.rtts); t.connectMs.push(...g.t.connectMs);
        }
        resolve({ live, t });
      } });
      w.postMessage({ report: true });
    }
  });
  const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

  interface Row { t: number; phase: string; live: number; framesPerPlayerS: number; gapP50: number; gapP99: number; rttP50: number; rttP99: number; connectP99: number; welcomed: number; packed: number; failed: number; tickHz: number; frameHz: number; loopGapMs: number; rssMb: number; cpuPct: number; online: number }
  const rows: Row[] = [];
  let lastCpu: { user: number; system: number } | null = null, lastAt = performance.now(), lastLive = 0;
  const t0 = performance.now();
  const sample = async (phase: string) => {
    const { live, t } = await collect();
    let h: Record<string, any> = {};
    try { h = await (await fetch(healthUrl)).json(); } catch { /* server busy */ }
    const now = performance.now(), dtS = (now - lastAt) / 1000;
    let cpuPct = 0;
    if (h.cpu && lastCpu) cpuPct = Math.round(((h.cpu.user - lastCpu.user + h.cpu.system - lastCpu.system) / 1e6 / dtS) * 100);
    if (h.cpu) lastCpu = h.cpu;
    lastAt = now;
    const row: Row = {
      t: Math.round((now - t0) / 1000), phase, live,
      // average of the players at the start and end of the window, so arrivals/departures don't skew it
      framesPerPlayerS: live + lastLive ? Math.round((t.frames / ((live + lastLive) / 2) / dtS) * 10) / 10 : 0,
      gapP50: Math.round(pct(t.gaps, 0.5)), gapP99: Math.round(pct(t.gaps, 0.99)),
      rttP50: Math.round(pct(t.rtts, 0.5)), rttP99: Math.round(pct(t.rtts, 0.99)), connectP99: Math.round(pct(t.connectMs, 0.99)),
      welcomed: t.welcomed, packed: t.packed, failed: t.failed,
      tickHz: h.tickHz ?? 0, frameHz: h.frameHz ?? 0, loopGapMs: h.maxLoopGapMs ?? 0, rssMb: h.rssMb ?? 0, cpuPct, online: h.online ?? 0,
    };
    rows.push(row);
    lastLive = live;
    console.log(`${String(row.t).padStart(4)}s ${phase.padEnd(8)} players ${String(row.online).padStart(5)} | frames/player/s ${String(row.framesPerPlayerS).padStart(4)} gap p50/p99 ${row.gapP50}/${row.gapP99} ms | ping p50/p99 ${row.rttP50}/${row.rttP99} ms | +${row.welcomed} in, ${row.packed} packed, ${row.failed} failed | server ${row.tickHz} ticks/s, ${row.cpuPct}% CPU, ${row.rssMb} MB`);
  };
  const run = async (phase: string, seconds: number, each?: (i: number) => void) => {
    for (let i = 0; i < seconds / 2; i++) { each?.(i); await new Promise((r) => setTimeout(r, 2000)); await sample(phase); }
  };

  console.log(`Spike test: ${BASE} → ${PEAK} players in ${RAMP} s, hold ${HOLD} s, MAX_PLAYERS ${MAXP}, ${WORKERS} load workers, ${url}`);
  openN(BASE);
  await run('normal', 10);
  const steps = Math.max(1, RAMP / 2), per = Math.ceil((PEAK - BASE) / steps);
  await run('spike', RAMP, () => openN(per));
  await run('hold', HOLD);
  closeN(PEAK);
  openN(BASE);
  await run('after', 12);

  const by = (p: string) => rows.filter((r) => r.phase === p);
  const hold = by('hold');
  const worst = (k: keyof Row, rs: Row[]) => Math.max(...rs.map((r) => r[k] as number));
  const best = (k: keyof Row, rs: Row[]) => Math.min(...rs.map((r) => r[k] as number));
  const summary = {
    peakRequested: PEAK, maxPlayers: MAXP, peakOnline: worst('online', rows),
    admitted: rows.reduce((s, r) => s + r.welcomed, 0), packed: rows.reduce((s, r) => s + r.packed, 0), failed: rows.reduce((s, r) => s + r.failed, 0),
    holdMinTickHz: best('tickHz', hold), holdMinFramesPerPlayerS: best('framesPerPlayerS', hold),
    holdWorstGapP99: worst('gapP99', hold), holdWorstPingP99: worst('rttP99', hold), holdWorstLoopGapMs: worst('loopGapMs', hold),
    peakCpuPct: worst('cpuPct', rows), peakRssMb: worst('rssMb', rows),
    afterTickHz: by('after').at(-1)?.tickHz, afterOnline: by('after').at(-1)?.online,
  };
  console.log('\nSummary', summary);
  mkdirSync(join(root, 'tools/out'), { recursive: true });
  writeFileSync(join(root, 'tools/out/loadtest.json'), JSON.stringify({ summary, rows }, null, 2));
  for (const w of workers) await w.terminate();
  process.exit(0);
}
