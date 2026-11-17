// Screenshots of the history pages (/runs, /hall) with ~2,000 seeded fake runs, at desktop
// (1440x900) and phone (390x844) sizes, plus the death card's "Share the clip" button in the
// live game. Real sim (in-memory store) + Vite.
//   npx tsx tools/pages-shots.ts [outDir] [--runs 2000]
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { LEVEL1 } from '../packages/shared/src/index';
import { startServer } from '../packages/sim/src/server';
import { MemoryStore } from '../packages/sim/src/store';
import { hazardSpots, seedDemoRuns } from '../packages/sim/src/store/seed';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) ?? 'tools/out/pages';
const ri = args.indexOf('--runs');
const RUNS = ri >= 0 ? Number(args[ri + 1]) : 2000;
mkdirSync(out, { recursive: true });
const SIM_PORT = 8093;
process.env.PORT = String(SIM_PORT); // the Vite proxy target
const { createServer } = await import('vite');
const replay = readFileSync('packages/client/public/fixtures/near-miss.replay');
const quiet = () => {};

async function sim(beaten: boolean, runs = RUNS) {
  const store = new MemoryStore();
  if (runs > 0) await seedDemoRuns(store, { runs, level: LEVEL1, now: Date.now(), clipReplay: replay, beaten });
  return startServer({ port: SIM_PORT, virtualPlayers: 0, store, log: quiet });
}

const vite = await createServer({ root: 'packages/client', logLevel: 'warn', server: { port: 5191, strictPort: true } });
await vite.listen();
const base = 'http://localhost:5191';
const browser = await chromium.launch();
const problems: string[] = [];
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;

async function shoot(path: string, name: string, opts: { full?: boolean; scroll?: string; wait?: number } = {}) {
  for (const [size, viewport] of Object.entries(sizes)) {
    const phone = size === 'phone';
    const page = await browser.newPage({ viewport, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
    page.on('pageerror', (e) => problems.push(`${name}/${size}: ${String(e)}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${name}/${size}: ${m.text()}`); });
    await page.goto(base + path);
    await page.waitForTimeout(opts.wait ?? 2200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) problems.push(`${name}/${size}: horizontal overflow ${overflow}px`);
    if (opts.scroll) { await page.locator(opts.scroll).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }
    await page.screenshot({ path: `${out}/${name}-${size}.png`, fullPage: opts.full ?? false });
    if (opts.full === undefined) await page.screenshot({ path: `${out}/${name}-${size}-full.png`, fullPage: true });
    await page.close();
  }
}

try {
  let s = await sim(false);
  await shoot('/runs', 'runs');
  await shoot('/runs?best=1&page=2', 'runs-best', { full: false, scroll: '#list-title' });
  await shoot('/hall', 'hall-empty');
  await s.stop();

  s = await sim(true);
  await shoot('/hall', 'hall-beaten');
  await s.stop();

  s = await sim(false, 0);
  await shoot('/runs', 'runs-fresh', { full: true });
  await s.stop();

  // the death card with "Share the clip": a fresh world, the blob put just before the first
  // spikes past 5% (so dying there sets a record worth a clip), one player holding right
  s = await sim(false, 0);
  const spot = hazardSpots(LEVEL1).find((h) => h.cause === 'spikes' && h.p > 0.06)!;
  for (const [size, viewport] of Object.entries(sizes)) {
    const phone = size === 'phone';
    const page = await browser.newPage({ viewport, deviceScaleFactor: phone ? 3 : 1, hasTouch: phone, isMobile: phone });
    page.on('pageerror', (e) => problems.push(`share/${size}: ${String(e)}`));
    await page.goto(base + '/');
    await page.waitForTimeout(1500);
    s.world.body.x = spot.x - 3;
    s.world.body.vx = 0;
    await page.keyboard.down('ArrowRight');
    const t0 = Date.now();
    while (s.world.phase !== 'dying' && Date.now() - t0 < 8000) await page.waitForTimeout(20);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(1900);
    const btn = page.locator('.bl-share');
    if (!(await btn.isVisible())) problems.push(`share/${size}: the Share the clip button is not visible (phase ${s.world.phase})`);
    else {
      const href = await btn.getAttribute('href');
      if (!href?.startsWith('/c/')) problems.push(`share/${size}: bad href ${href}`);
    }
    await page.screenshot({ path: `${out}/share-${size}.png` });
    await page.waitForTimeout(3500);
    const clip = await page.evaluate(async (h) => (await fetch(`/api/clips/${h}`)).status, (await btn.getAttribute('href'))?.slice(3) ?? 'x');
    if (clip !== 200) problems.push(`share/${size}: clip fetch ${clip}`);
    await page.close();
    await s.stop();
    s = await sim(false, 0);
  }
  await s.stop();
} finally {
  await browser.close();
  await vite.close();
}
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : `ok: screenshots in ${out}`);
process.exit(problems.length ? 1 : 0);
