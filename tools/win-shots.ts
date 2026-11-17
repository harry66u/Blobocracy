// The win, end to end: the real server (seeded with ~4,800 past runs and a small virtual
// crowd), the real client in headless Chromium at desktop 1600x900 and phone 390x844, the
// admin debug action that puts the blob just before the goal, then screenshots across the
// celebration and the "Level 2 unlocked" transition; then the win clip's page (both shapes,
// plus a real vertical video export), and the hall of fame and run history pages.
//   npx tsx tools/win-shots.ts [outDir] [--no-export]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { createServer } from 'vite';
import { LEVEL1 } from '../packages/shared/src/index';
import { startServer } from '../packages/sim/src/server';
import { MemoryStore } from '../packages/sim/src/store';
import { seedDemoRuns } from '../packages/sim/src/store/seed';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'tools/out/win';
const doExport = !args.includes('--no-export');
mkdirSync(out, { recursive: true });
const SIM_PORT = 8080;
process.env.PORT = String(SIM_PORT); // the Vite proxy target

const store = new MemoryStore();
const seeded = await seedDemoRuns(store, { runs: 4811, level: LEVEL1, levelName: 'Crown Mountain', now: Date.now() - 60_000 });
console.log(`seeded ${seeded.deaths} deaths`);
const srv = await startServer({ port: SIM_PORT, virtualPlayers: 40, adminToken: 'dev', store, log: (m) => console.log(m) });
const vite = await createServer({ root: 'packages/client', logLevel: 'warn', server: { port: 5184, strictPort: false } });
await vite.listen();
const base = (vite.resolvedUrls?.local[0] ?? 'http://localhost:5184/').replace(/\/$/, '');

const browser = await chromium.launch();
const errors: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const desk = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  for (const [name, p] of [['desktop', desk], ['phone', phone]] as const) {
    p.on('pageerror', (e) => errors.push(`${name}: ${String(e)}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await p.goto(`${base}/`);
  }
  await sleep(3000);
  const shoot = (tag: string) => Promise.all([
    desk.screenshot({ path: `${out}/${tag}-desktop.png` }),
    phone.screenshot({ path: `${out}/${tag}-phone.png` }),
  ]).then(() => console.log('shot', tag));
  await shoot('00-before');

  // the dev-only admin action: the blob lands just before the goal, the crowd does the rest
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${base}/admin/debug/win`, { method: 'POST', headers: { authorization: 'Bearer dev' } });
    console.log('debug win:', r.status, await r.text());
    if (r.status === 200) break;
    await sleep(500);
  }
  while (srv.world.phase !== 'celebrating') await sleep(5);
  const tw = Date.now();
  const at = async (s: number, tag: string) => { const wait = tw + s * 1000 - Date.now(); if (wait > 0) await sleep(wait); await shoot(tag); };
  await at(0.1, '01-touch');
  await at(0.55, '02-crown');
  await at(1.6, '03-fireworks');
  await at(3.3, '04-card');
  await at(9, '05-party');
  await at(21.5, '06-card-late');
  while (srv.world.level.id === 1) await sleep(5);
  const tl = Date.now();
  const lat = async (s: number, tag: string) => { const wait = tl + s * 1000 - Date.now(); if (wait > 0) await sleep(wait); await shoot(tag); };
  await lat(0.55, '07-levelup-shrink');
  await lat(1.45, '08-levelup-swap');
  await lat(2.5, '09-levelup-grow');
  await lat(3.4, '10-levelup-banner');
  await lat(7, '11-level2');
  console.log(`now on level ${srv.world.level.id}: run ${srv.world.run}, ${srv.world.deaths} deaths`);

  // the win clip: saved when the celebration ended
  await srv.store.drained();
  const hall = await store.hallOfFame();
  console.log('hall of fame:', JSON.stringify(hall));
  const clipId = hall.find((h) => h.levelId === 1)?.clipId;
  if (!clipId) throw new Error('no win clip in the hall of fame');
  for (const [name, p] of [['desktop', desk], ['phone', phone]] as const) {
    await p.goto(`${base}/c/${clipId}`);
    await p.waitForFunction(() => (window as unknown as { __clip?: { ready: boolean } }).__clip?.ready === true, null, { timeout: 60_000 });
    const dur = await p.evaluate(() => (window as unknown as { __clip: { duration: number } }).__clip.duration);
    await p.evaluate((t) => (window as unknown as { __clip: { seek(t: number): void } }).__clip.seek(t), Math.max(0, dur - 21));
    await sleep(300);
    await p.screenshot({ path: `${out}/12-clip-page-${name}.png` });
    console.log(`clip ${clipId}: ${dur.toFixed(1)} s`);
  }
  // full-resolution stills of the clip in both shapes, and a real vertical video export
  const still = async (t: number, a: 'vertical' | 'wide', tag: string) => {
    const url = await desk.evaluate(([tt, aa]) => (window as unknown as { __clip: { still(t: number, a: string): Promise<string> } }).__clip.still(tt as number, aa as string), [t, a] as const);
    writeFileSync(`${out}/${tag}.png`, Buffer.from(url.split(',')[1]!, 'base64'));
    console.log('still', tag);
  };
  const dur = await desk.evaluate(() => (window as unknown as { __clip: { duration: number } }).__clip.duration);
  await still(dur - 20, 'vertical', '13-clip-vertical-card');
  await still(dur - 24.2, 'vertical', '14-clip-vertical-crown');
  await still(dur - 20, 'wide', '15-clip-wide-card');
  if (doExport) {
    const v = await desk.evaluate(() => (window as unknown as { __clip: { exportVideo(a: string): Promise<{ result: Record<string, unknown>; base64: string } | null> } }).__clip.exportVideo('vertical'));
    if (!v) throw new Error('vertical export failed');
    const file = `${out}/win-vertical.${String(v.result.ext ?? 'mp4')}`;
    writeFileSync(file, Buffer.from(v.base64, 'base64'));
    console.log('exported', file, JSON.stringify(v.result));
    try {
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', file]).toString();
      console.log('ffprobe:', probe.replace(/\s+/g, ' '));
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, dur - 20)), '-i', file, '-frames:v', '1', `${out}/16-video-frame.png`]);
    } catch { console.log('(no ffprobe/ffmpeg: skipped the probe)'); }
  }
  // the pages
  for (const [name, p] of [['desktop', desk], ['phone', phone]] as const) {
    await p.goto(`${base}/hall`);
    await sleep(1500);
    await p.screenshot({ path: `${out}/17-hall-${name}.png`, fullPage: true });
    await p.goto(`${base}/runs?level=1`);
    await sleep(2000);
    await p.screenshot({ path: `${out}/18-runs-level1-${name}.png` });
  }
} finally {
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  await browser.close();
  await vite.close();
  await srv.stop();
}
process.exit(0);
