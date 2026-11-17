// Renders the whole of LEVEL1 as one image (stacked rows, zone skies and names) using the
// real renderer, via packages/client/level-preview.html.
// Usage: npx tsx tools/level-preview.ts [out.png] [--tile=14] [--rows=N] [--t=<run time>]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is preinstalled globally; ESM imports don't search NODE_PATH, so require it.
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.startsWith('--')) ?? join(root, 'tools', 'out', 'level1-overview.png'));
const q = new URLSearchParams();
for (const k of ['tile', 'rows', 't']) {
  const v = args.find((a) => a.startsWith(`--${k}=`));
  if (v) q.set(k, v.slice(k.length + 3));
}
mkdirSync(dirname(out), { recursive: true });

const port = await new Promise<number>((res) => {
  const s = createServer();
  s.listen(0, () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => res(p));
  });
});
const vite = spawn('npx', ['vite', 'packages/client', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = '';
vite.stdout!.on('data', (d) => { log += d; });
vite.stderr!.on('data', (d) => { log += d; });
// npx does not forward signals to vite, so kill the whole process group.
const stop = () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);

try {
  const url = `http://localhost:${port}/level-preview.html?${q}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    if (i > 100) throw new Error('vite did not start:\n' + log);
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __done?: boolean; __error?: string }).__done || (window as unknown as { __error?: string }).__error, null, { timeout: 30000 });
    if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
    const data = await page.evaluate(() => (document.getElementById('strip') as HTMLCanvasElement).toDataURL('image/png'));
    writeFileSync(out, Buffer.from(data.split(',')[1]!, 'base64'));
    console.log('wrote', out);
  } finally {
    await browser.close();
  }
} finally {
  stop();
}
