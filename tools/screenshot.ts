// Screenshots of the live game: real server + virtual crowd + Vite client.
// Usage: npx tsx tools/screenshot.ts [virtualPlayers] [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright is preinstalled globally; ESM imports don't search NODE_PATH, so require it.
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { startServer } from '../packages/sim/src/server';

const players = Number(process.argv[2] ?? 400);
const out = process.argv[3] ?? 'tools/out';
mkdirSync(out, { recursive: true });

const srv = await startServer({ port: 8080, virtualPlayers: players });
const vite = spawn('npx', ['vite', 'packages/client', '--port', '5180', '--strictPort'], { stdio: 'pipe' });
await new Promise<void>((res) => vite.stdout.on('data', (d) => String(d).includes('Local') && res()));

const browser = await chromium.launch();
try {
  const shots: [string, { width: number; height: number }, boolean][] = [
    ['m1-desktop', { width: 1600, height: 900 }, false],
    ['m1-phone', { width: 390, height: 844 }, true],
  ];
  for (const [name, viewport, touch] of shots) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:5180/');
    await page.waitForTimeout(1500);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.keyboard.up('ArrowRight');
    if (errors.length) console.log(name, 'errors:', errors);
    await page.close();
  }
  // The death moment, live: freeze frame, card, then the swoop back to the start (phone and desktop).
  for (const [name, viewport, touch] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1600, height: 900 }, false]] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('http://localhost:5180/');
    await page.waitForTimeout(800);
    const deaths0 = srv.world.deaths;
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 1200 && srv.world.deaths === deaths0; i += 1) await page.waitForTimeout(25);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/live-${name}-death-freeze.png` });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${out}/live-${name}-death-card.png` });
    for (let i = 0; i < 400 && srv.world.phase === 'dying'; i++) await page.waitForTimeout(25);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/live-${name}-swoop.png` });
    await page.keyboard.up('ArrowRight');
    if (errors.length) console.log(name, 'death errors:', errors);
    await page.close();
  }
  console.log('deaths so far:', srv.world.deaths, 'run', srv.world.run, 'x', srv.world.body.x.toFixed(1));
} finally {
  await browser.close();
  vite.kill();
  await srv.stop();
}
process.exit(0);
