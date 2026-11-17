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
  // Death card: wait for a death on the phone view.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await page.goto('http://localhost:5180/');
  const deaths0 = srv.world.deaths;
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 600 && srv.world.deaths === deaths0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${out}/m1-phone-death.png` });
  await page.close();
  console.log('deaths so far:', srv.world.deaths, 'run', srv.world.run, 'x', srv.world.body.x.toFixed(1));
} finally {
  await browser.close();
  vite.kill();
  await srv.stop();
}
process.exit(0);
