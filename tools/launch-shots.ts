// Screenshots of the launch features on the real production build:
// share button under the death card, share panel, the share image, the clip, the text line,
// the stats dashboard and the packed screen.
// Usage: SITE_URL=https://blobocracy.com npm run build && npx tsx tools/launch-shots.ts [outDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../packages/sim/src/server';

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'tools/out/launch');
mkdirSync(out, { recursive: true });
const dist = join(root, 'packages/client/dist');

const srv = await startServer({
  port: 0, virtualPlayers: 240, staticDir: dist, dataDir: null, statsKey: 'demo', siteUrl: 'https://blobocracy.com',
});
const base = `http://localhost:${srv.port}`;
const browser = await chromium.launch();
const errors: string[] = [];
try {
  // ---- phone: play until the blob dies, then share ---------------------------------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(`${base}/?via=hn`);
  await page.waitForTimeout(1500);
  // make this player part of a run: hold right through a whole run until it dies
  const d0 = srv.world.deaths;
  await page.waitForFunction(() => true);
  for (let i = 0; i < 3000 && srv.world.deaths === d0; i++) {
    if (srv.world.phase === 'running') await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);
  }
  // the first death may have started before we pressed; wait for one of a run we were in
  const d1 = srv.world.deaths;
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 3000 && srv.world.deaths === d1; i++) await page.waitForTimeout(50);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, 'phone-death-share-button.png') });

  // the image renders ~0.6 s after the death
  await page.waitForTimeout(800);
  await page.click('.bl-share-more');
  await page.waitForSelector('.bl-share-img[src]', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'phone-share-panel.png') });
  const text = await page.inputValue('.bl-share-text');
  writeFileSync(join(out, 'share-text.txt'), text + '\n');

  const [img] = await Promise.all([page.waitForEvent('download'), page.click('[data-k=image]')]);
  await img.saveAs(join(out, 'share-image.png'));

  await page.waitForFunction(() => !(document.querySelector('[data-k=clip]') as HTMLButtonElement).disabled, null, { timeout: 10_000 });
  const t0 = Date.now();
  await page.click('[data-k=clip]');
  await page.waitForFunction(() => /Share clip|Download clip/.test(document.querySelector('[data-k=clip]')!.textContent ?? ''), null, { timeout: 120_000 });
  const clipMs = Date.now() - t0;
  const clipLabel = await page.textContent('[data-k=clip]');
  const [clip] = await Promise.all([page.waitForEvent('download'), page.click('[data-k=clip]')]);
  const clipPath = join(out, `share-clip.${clip.suggestedFilename().split('.').pop()}`);
  await clip.saveAs(clipPath);
  console.log(`clip: ${clipLabel?.trim()} in ${(clipMs / 1000).toFixed(1)} s -> ${clipPath}`);
  const codec = await page.evaluate(async () => {
    for (const c of ['avc1.640028', 'vp09.00.40.08']) {
      const r = await VideoEncoder.isConfigSupported({ codec: c, width: 1080, height: 1920, bitrate: 6e6, framerate: 30 }).catch(() => ({ supported: false }));
      if (r.supported) return c;
    }
    return 'none';
  });
  console.log('first supported codec in this browser:', codec);

  await page.click('[data-k=text]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, 'phone-share-text-copied.png') });
  const stats = await page.evaluate(() => localStorage.getItem('blobocracy.stats.v1'));
  console.log('personal stats in localStorage:', stats);
  console.log('address bar after ?via=hn:', page.url());
  await ctx.close();

  // ---- desktop panel -----------------------------------------------------------------
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const dpage = await dctx.newPage();
  dpage.on('pageerror', (e) => errors.push(String(e)));
  await dpage.goto(`${base}/?via=webgames`);
  await dpage.waitForTimeout(1000);
  const d2 = srv.world.deaths;
  await dpage.keyboard.down('ArrowRight');
  for (let i = 0; i < 3000 && srv.world.deaths === d2; i++) await dpage.waitForTimeout(50);
  const d3 = srv.world.deaths;
  for (let i = 0; i < 3000 && srv.world.deaths === d3; i++) await dpage.waitForTimeout(50);
  await dpage.keyboard.up('ArrowRight');
  await dpage.waitForTimeout(1000);
  await dpage.screenshot({ path: join(out, 'desktop-death-share-button.png') });
  await dpage.click('.bl-share-main'); // no share sheet on desktop: opens the panel
  await dpage.waitForSelector('.bl-share-img[src]', { timeout: 10_000 });
  await dpage.waitForTimeout(300);
  await dpage.screenshot({ path: join(out, 'desktop-share-panel.png') });
  // closing the panel must hand the keyboard back to the blob
  await dpage.click('.bl-share-x');
  const focusOk = await dpage.evaluate(() => document.activeElement === document.body || document.activeElement === null);
  console.log('after closing the panel, keyboard focus is back on the page:', focusOk);
  await dctx.close();

  // ---- stats dashboard (beacons from the sessions above, plus a few synthetic ones) -----
  const now = Date.now();
  const day = (o: number) => new Date(now - o * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const seed = (b: object, n: number, at = now) => { for (let i = 0; i < n; i++) srv.analytics.ingest(JSON.stringify(b), at); };
  for (let o = 13; o >= 1; o--) {
    const at = now - o * 86_400_000;
    const k = Math.round(20 + 60 * Math.exp(-((o - 6) ** 2) / 6));
    for (const [src, f] of [['hn', 0.5], ['webgames', 0.25], ['share', 0.15], ['direct', 0.1]] as const) {
      const n = Math.round(k * f);
      seed({ e: 'visit', src, isNew: true, daily: true, cohort: day(o), firstSrc: src, daysSince: 0, firstReturn: false }, n, at);
      seed({ e: 'play', src }, Math.round(n * 0.8), at);
      seed({ e: 'stay', src, s: 30 }, Math.round(n * 0.7), at);
      seed({ e: 'stay', src, s: 120 }, Math.round(n * 0.4), at);
      seed({ e: 'stay', src, s: 300 }, Math.round(n * 0.18), at);
      seed({ e: 'stay', src, s: 900 }, Math.round(n * 0.05), at);
      seed({ e: 'share', src, kind: 'image', how: 'sheet' }, Math.round(n * 0.06), at);
      seed({ e: 'share', src, kind: 'text', how: 'copy' }, Math.round(n * 0.03), at);
      seed({ e: 'visit', src: 'direct', isNew: false, daily: true, cohort: day(o + 1), firstSrc: src, daysSince: 1, firstReturn: true }, Math.round(n * (src === 'share' ? 0.3 : 0.15)), at);
    }
  }
  const spage = await browser.newPage({ viewport: { width: 1100, height: 1500 }, deviceScaleFactor: 2 });
  await spage.goto(`${base}/stats?key=demo&days=14`);
  await spage.screenshot({ path: join(out, 'stats-dashboard.png'), fullPage: true });
  await spage.close();
} finally {
  await browser.close();
  await srv.stop();
}

// ---- packed screen ---------------------------------------------------------------------
const full = await startServer({ port: 0, virtualPlayers: 0, staticDir: dist, dataDir: null, maxPlayers: 0 });
full.world.deaths = 4812;
const b2 = await chromium.launch();
try {
  const p = await b2.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.goto(`http://localhost:${full.port}/`);
  await p.waitForSelector('#packed:not([hidden])', { timeout: 10_000 });
  await p.waitForTimeout(500);
  await p.screenshot({ path: join(out, 'phone-packed.png') });
} finally {
  await b2.close();
  await full.stop();
}
if (errors.length) console.log('browser errors/warnings:', errors);
console.log('screenshots in', out);
process.exit(0);
