// Renders the link preview image and the icons from the game's own renderer.
// Usage: npx tsx tools/og-image.ts      Output: packages/client/public/{og.png, icon-*.png, apple-touch-icon.png, favicon.ico}
import { spawn } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'packages/client/public');
const PORT = 5197;
mkdirSync(join(root, 'tools/out'), { recursive: true });

const vite = spawn('npx', ['vite', 'packages/client', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
process.on('exit', () => { try { process.kill(-vite.pid!, 'SIGTERM'); } catch { /* gone */ } });
for (let i = 0; ; i++) {
  try { if ((await fetch(`http://localhost:${PORT}/og.html`)).ok) break; } catch { /* starting */ }
  if (i > 100) throw new Error('vite did not start');
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch();
async function shot(query: string, w: number, h: number, path: string): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}/og.html${query}`);
  await page.waitForSelector('body[data-ready="1"]');
  const buf = await page.locator('#og').screenshot({ path });
  await page.close();
  return buf;
}

await shot('', 1200, 630, join(pub, 'og.png'));
for (const [size, name] of [[512, 'icon-512.png'], [192, 'icon-192.png'], [180, 'apple-touch-icon.png']] as const) {
  await shot(`?icon=${size}`, size, size, join(pub, name));
}
// favicon.ico: a single 32x32 PNG wrapped in an ICO header (every browser accepts PNG-in-ICO).
const png32 = await shot('?icon=32', 32, 32, join(root, 'tools/out/favicon-32.png'));
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico.writeUInt8(32, 6); ico.writeUInt8(32, 7); ico.writeUInt8(0, 8); ico.writeUInt8(0, 9);
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png32.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([ico, png32]));
await browser.close();

const kb = (f: string) => (statSync(join(pub, f)).size / 1024).toFixed(0);
console.log(`og.png ${kb('og.png')} KB, icon-512 ${kb('icon-512.png')} KB, favicon.ico ${kb('favicon.ico')} KB`);
process.exit(0);
