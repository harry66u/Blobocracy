// Screenshots of the renderer preview harness (packages/client/preview.html) for every
// sky plus the death and paused states, and every milestone-2 mechanic (mech-*), at
// desktop 1600x900 and phone 390x844.
// The big moments (moment-*) are played in slow motion and captured at a set age.
// Usage: node tools/preview-shots.mjs [--dpr=2] [--only=<name part>]   Output: tools/out/preview-*.png
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tools', 'out');
mkdirSync(out, { recursive: true });
const PORT = await new Promise((res) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
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
  // milestone 2 mechanics (packages/client/src/preview.ts, &level=mech)
  { name: 'mech-press', q: 'level=mech&dots=40&sky=sunset&still=1&strain=0&x=6.5&at=0.05&rt=1.63&freeze=1' },
  { name: 'mech-press-wait', q: 'level=mech&dots=40&sky=sunset&still=1&strain=0&x=6.5&at=0.05&rt=1.2&freeze=1' },
  { name: 'mech-mover', q: 'level=mech&dots=40&sky=sunset&still=1&strain=0&x=20.5&at=0.05&rt=1.1&freeze=1' },
  { name: 'mech-crumble', q: 'level=mech&dots=40&sky=sunset&still=1&strain=0&x=54.5&at=0.05&crumbleDemo=1&freeze=1' },
  { name: 'mech-spring', q: 'level=mech&dots=40&sky=sunset&still=1&strain=0&x=60.5&y=12&at=0.05&freeze=1' },
  { name: 'mech-belt', q: 'level=mech&dots=40&sky=purple&still=1&strain=0&x=96.5&at=0.05&rt=0.4&freeze=1' },
  { name: 'mech-saw', q: 'level=mech&dots=40&sky=purple&still=1&strain=0&x=114.5&at=0.05&rt=0.6&freeze=1' },
  { name: 'mech-chomp', q: 'level=mech&dots=40&sky=purple&still=1&strain=0&x=141.5&chomp=2.6&at=0.05&freeze=1' },
  { name: 'mech-chomp-near', q: 'level=mech&dots=40&sky=purple&still=1&strain=0&x=141.5&chomp=6.5&at=0.05&freeze=1' },
  { name: 'mech-run', q: 'level=mech&dots=40&sky=sunset&x=44&at=2.2' },
  // big moments: `age` is how far into the moment (preview seconds) to capture; slow=0.1 makes that precise
  ...['press', 'spikes', 'ceiling spikes', 'pit', 'saw', 'chomp'].flatMap((c) => {
    const where = {
      press: 'level=mech&sky=sunset&x=10&rt=1.63',
      spikes: 'sky=blue&x=13&y=12',
      'ceiling spikes': 'sky=blue&x=45.5&y=12.2',
      pit: 'sky=blue&x=19&y=19',
      saw: 'level=mech&sky=purple&x=126.5&rt=0.6',
      chomp: 'level=mech&sky=purple&x=141.5&chomp=0.4',
    }[c];
    const slug = c.replace(' ', '-');
    return [
      { name: `moment-death-${slug}`, q: `${where}&dots=60&still=1&strain=0&at=0.05&moment=death&cause=${c}&slow=0.1`, age: 0.12 },
      { name: `moment-death-${slug}-after`, q: `${where}&dots=60&still=1&strain=0&at=0.05&moment=death&cause=${c}&slow=0.25`, age: 1.5 },
    ];
  }),
  { name: 'moment-flip', q: 'sky=blue&x=13&y=12&dots=60&still=1&strain=0&at=0.05&moment=death&cause=spikes&slow=0.05', age: 0.28 + 0.2 },
  { name: 'moment-flip-early', q: 'sky=blue&x=13&y=12&dots=60&still=1&strain=0&at=0.05&moment=death&cause=spikes&slow=0.05', age: 0.28 + 0.1 },
  { name: 'moment-card', q: 'level=mech&sky=sunset&x=10&rt=1.63&dots=60&still=1&strain=0&at=0.05&moment=death&cause=press&slow=0.3', age: 1.6 },
  { name: 'moment-swoop', q: 'sky=purple&x=150&dots=60&still=1&strain=0&at=0.05&moment=swoop&cause=saw&slow=0.25', age: 3.5 + 0.45 },
  { name: 'moment-zone', q: 'sky=sunset&x=73&dots=80&strain=0&at=0.3&moment=zone&slow=0.25', age: 0.75 },
  { name: 'moment-zone-drop', q: 'sky=sunset&x=73&dots=80&strain=0&at=0.3&moment=zone&slow=0.1', age: 0.3 },
  { name: 'moment-record', q: 'sky=sunset&x=100&dots=80&strain=0&at=0.3&moment=record&slow=0.25', age: 0.5 },
  { name: 'moment-reduced-zone', q: 'sky=sunset&x=73&dots=80&strain=0&at=0.3&moment=zone&slow=0.25&reduced=1', age: 0.9 },
  // the win (spec §6.7) on the real level 1 goal, and the level-up that follows
  { name: 'moment-win-touch', q: 'level=real1&dots=80&strain=0&at=0.05&moment=win&slow=0.1', age: 0.18 },
  { name: 'moment-win-crown', q: 'level=real1&dots=80&strain=0&at=0.05&moment=win&slow=0.1', age: 0.62 },
  { name: 'moment-win-fireworks', q: 'level=real1&dots=80&strain=0&at=0.05&moment=win&slow=0.3', age: 1.7 },
  { name: 'moment-win-card', q: 'level=real1&dots=80&strain=0&at=0.05&moment=win&slow=0.5', age: 4.2 },
  { name: 'moment-win-card-late', q: 'level=real2&encore=1&dots=80&strain=0&at=0.05&moment=win', age: 9 },
  { name: 'moment-win-reduced', q: 'level=real1&dots=80&strain=0&at=0.05&moment=win&reduced=1&slow=0.5', age: 4.2 },
  { name: 'moment-levelup-shrink', q: 'level=real1&dots=80&strain=0&at=0.05&moment=levelup&slow=0.25', age: 0.4 + 0.75 },
  { name: 'moment-levelup-swap', q: 'level=real1&dots=80&strain=0&at=0.05&moment=levelup&slow=0.25', age: 0.4 + 1.6 },
  { name: 'moment-levelup-banner', q: 'level=real1&dots=80&strain=0&at=0.05&moment=levelup&slow=0.25', age: 0.4 + 2.6 },
  { name: 'moment-levelup-reduced', q: 'level=real1&dots=80&strain=0&at=0.05&moment=levelup&reduced=1&slow=0.25', age: 0.4 + 0.5 },
  { name: 'hud-level2-encore', q: 'level=real2&x=12&dots=80&strain=0&encore=1' },
  { name: 'settings', q: 'sky=blue&dots=80&still=1&strain=0&settings=1' },
  // the game page with no game server running: it stays on the loading screen
  { name: 'loading', path: '/', q: '' },
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
      if (s.path) {
        await page.goto(`http://localhost:${PORT}${s.path}`);
        await page.waitForTimeout(1200);
        const file = join(out, `${name}.png`);
        await page.screenshot({ path: file });
        console.log('wrote', file);
        await page.close();
        continue;
      }
      await page.goto(`http://localhost:${PORT}/preview.html?${s.q}${v.touch ? '&touch=1' : ''}`);
      await page.waitForFunction(() => (window.__frames ?? 0) > 5, null, { timeout: 15000 });
      if (s.age !== undefined) await page.waitForFunction((a) => (window.__momentAge ?? -1) >= a, s.age, { timeout: 60000, polling: 'raf' });
      else await page.waitForTimeout(s.name === 'death' ? 1200 : 900);
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
