// Renders the game's synthesized audio offline in Chromium and checks the levels.
// Usage: npx tsx tools/audio-render.ts [outDir]
// Writes one WAV per clip (listen to them!) and fails if anything is silent, clips,
// or the death hit is not followed by silence.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright is preinstalled globally; ESM imports don't search NODE_PATH, so require it.
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import type { ClipResult } from '../packages/client/src/audio-test';

const out = process.argv[2] ?? 'tools/out/audio';
mkdirSync(out, { recursive: true });
const PORT = 5181;

const vite = spawn('npx', ['vite', 'packages/client', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise<void>((res, rej) => {
  vite.stdout.on('data', (d) => String(d).includes('Local') && res());
  vite.on('exit', (code) => rej(new Error(`vite exited (${code})`)));
});

const browser = await chromium.launch();
let failures: string[] = [];
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/audio-test.html`);
  await page.waitForFunction(() => (window as unknown as { audioTestReady?: boolean }).audioTestReady === true);
  const results = await page.evaluate(() => (window as unknown as { renderAll: () => Promise<ClipResult[]> }).renderAll());
  if (errors.length) failures.push(`page errors: ${errors.join('; ')}`);

  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : '  -inf');
  console.log('clip            peak dBFS  rms dBFS   windows (rms / peak dBFS)');
  for (const r of results) {
    writeFileSync(`${out}/${r.name}.wav`, Buffer.from(r.wav, 'base64'));
    const w = Object.entries(r.windows).map(([k, v]) => `${k} ${f(v.rmsDb).trim()}/${f(v.peakDb).trim()}`).join(', ');
    console.log(`${r.name.padEnd(15)} ${f(r.peakDb)}    ${f(r.rmsDb)}    ${w}`);
  }

  const by = (n: string) => results.find((r) => r.name === n)!;
  const win = (n: string, w: string) => by(n).windows[w]!;
  for (const r of results) {
    if (r.peak >= 1) failures.push(`${r.name} clips (peak ${r.peak.toFixed(3)})`);
    if (r.rmsDb < -50) failures.push(`${r.name} is (nearly) silent: rms ${r.rmsDb.toFixed(1)} dBFS`);
  }
  if (win('death', 'tail').peakDb > -90) failures.push(`death is not followed by silence (tail peak ${win('death', 'tail').peakDb.toFixed(1)} dBFS)`);
  if (win('death', 'hit').peakDb < win('death', 'music').peakDb + 6) failures.push('death hit is not clearly louder than the music');
  if (win('tour', 'afterDeath').peakDb > -90) failures.push('tour: music did not stop at the death');
  if (win('tour', 'back').rmsDb < -40) failures.push('tour: music did not come back after resetToStart');
  if (win('sfx-misc', 'sawStopped').peakDb > -60) failures.push('saw buzz did not fade once sawNear calls stopped');
  if (win('sfx-misc', 'sawFull').rmsDb <= win('sfx-misc', 'sawHalf').rmsDb) failures.push('saw buzz does not grow with proximity');
  if (win('sfx-misc', 'pressFar').peakDb >= win('sfx-misc', 'pressNear').peakDb) failures.push('far press is not quieter than near press');
  const music = win('mix-z2', 'music').rmsDb;
  for (const k of ['jump', 'land', 'cheer'] as const) {
    if (win('mix-z2', k).rmsDb < music + 3) failures.push(`${k} is not clearly audible over the music (${win('mix-z2', k).rmsDb.toFixed(1)} vs ${music.toFixed(1)} dBFS)`);
  }
  if (win('music-z5', 'steady').rmsDb <= win('music-z0', 'steady').rmsDb) failures.push('zone 6 music is not more intense than zone 1');
  console.log(`\nWAV files in ${out}/`);
} finally {
  await browser.close();
  vite.kill();
}
if (failures.length) {
  console.log('\nFAIL:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('All audio checks passed.');
process.exit(0);
