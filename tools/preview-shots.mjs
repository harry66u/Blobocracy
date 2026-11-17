// Screenshots of the renderer preview harness (packages/client/preview.html) for every
// sky plus the death and paused states, at desktop 1600x900 and phone 390x844.
// Usage: node tools/preview-shots.mjs [--dpr=2]   Output: tools/out/preview-*.png
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tools', 'out');
mkdirSync(out, { recursive: true });
const PORT = 5199;
const dpr = Number((process.argv.find((a) => a.startsWith('--dpr=')) ?? '--dpr=1').slice(6));
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const vite = spawn('npx', ['vite', 'packages/client', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
vite.stdout.on('data', (d) => { log += d; });
vite.stderr.on('data', (d) => { log += d; });
// npx does not forward signals to vite, so kill the whole process group.
const stop = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch {} };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/preview.html`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite did not start:\n' + log);
}

const states = [
  { name: 'blue', q: 'sky=blue' },
  { name: 'sunset', q: 'sky=sunset' },
  { name: 'purple', q: 'sky=purple' },
  { name: 'death', q: 'sky=sunset&death=1' },
  { name: 'paused', q: 'sky=blue&paused=1' },
  { name: 'calm', q: 'sky=blue&still=1&strain=0' },
  { name: 'strain', q: 'sky=blue&still=1&strain=0.9' },
];
const views = [
  { name: 'desktop', viewport: { width: 1600, height: 900 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];

try {
  await waitForServer();
  const browser = await chromium.launch();
  const errors = [];
  for (const v of views) {
    const ctx = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: dpr, hasTouch: v.touch, isMobile: v.touch });
    for (const s of states) {
      const name = `preview-${s.name}-${v.name}`;
      if (only && !name.includes(only)) continue;
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      await page.goto(`http://localhost:${PORT}/preview.html?${s.q}${v.touch ? '&touch=1' : ''}`);
      await page.waitForFunction(() => (window.__frames ?? 0) > 5, null, { timeout: 15000 });
      await page.waitForTimeout(s.name === 'death' ? 1200 : 900);
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file });
      console.log('wrote', file);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  if (errors.length) {
    console.error('console errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
} finally {
  stop();
  setTimeout(() => process.exit(), 300);
}
