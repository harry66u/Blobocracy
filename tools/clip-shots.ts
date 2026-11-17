// Screenshots of the clip page and real video exports, in headless Chromium.
//   npx tsx tools/clip-shots.ts [outDir] [--no-export] [--fallback]
// For each fixture: the page at desktop and phone sizes (playing, on the big moment),
// full-resolution stills of key frames in both shapes, then real MP4 exports (WebCodecs
// H.264 + mp4-muxer) checked with ffprobe when it's installed (MP4 box headers otherwise),
// and a few frames pulled out of the videos to look at. --fallback also records the
// MediaRecorder (real-time WebM) path once.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { createServer } from 'vite';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'tools/out/clips';
const doExport = !args.includes('--no-export');
const doFallback = args.includes('--fallback');
mkdirSync(out, { recursive: true });

/** Key moments per fixture (clip seconds): the hook, the big moment, the card, the end card. */
const FIXTURES: Record<string, { name: string; at: number }[]> = {
  'near-miss': [{ name: 'run', at: 12 }, { name: 'death', at: 26.62 }, { name: 'card', at: 28.4 }, { name: 'outro', at: 31.6 }],
  zone: [{ name: 'record', at: 3.9 }, { name: 'banner', at: 6.5 }, { name: 'card', at: 23.6 }, { name: 'outro', at: 26.8 }],
};

const vite = await createServer({ root: 'packages/client', logLevel: 'warn', server: { port: 5183, strictPort: false } });
await vite.listen();
const base = vite.resolvedUrls?.local[0] ?? 'http://localhost:5183/';
const have = (cmd: string) => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const ffprobe = have('ffprobe'), ffmpeg = have('ffmpeg');

type Clip = {
  duration: number;
  still(at: number, a: string): Promise<string>;
  seek(at: number): void;
  exportVideo(a: string): Promise<{ result: Record<string, unknown>; base64: string } | null>;
};

const problems: string[] = [];
const browser = await chromium.launch();
try {
  for (const [fixture, moments] of Object.entries(FIXTURES)) {
    // ---- the page, desktop and phone
    for (const [dev, opts] of [
      ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
      ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ] as const) {
      const page = await browser.newPage(opts);
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(new URL(`clip.html?fixture=${fixture}`, base).href);
      await page.waitForFunction(() => (window as unknown as { __clip?: { ready: boolean } }).__clip?.ready === true, null, { timeout: 20000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/${fixture}-${dev}-playing.png` });
      const key = moments[1]!;
      await page.evaluate((at) => (window as unknown as { __clip: Clip }).__clip.seek(at), key.at);
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${out}/${fixture}-${dev}-${key.name}.png` });
      if (errors.length) problems.push(`${fixture} ${dev}: ${errors.join('; ')}`);
      await page.close();
    }

    // ---- full-resolution stills, as they will be in the video
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => problems.push(`${fixture} stills: ${e}`));
    await page.goto(new URL(`clip.html?fixture=${fixture}`, base).href);
    await page.waitForFunction(() => (window as unknown as { __clip?: { ready: boolean } }).__clip?.ready === true, null, { timeout: 20000 });
    for (const aspect of ['vertical', 'wide']) {
      for (const m of moments) {
        const url = await page.evaluate(([at, a]) => (window as unknown as { __clip: Clip }).__clip.still(at as number, a as string), [m.at, aspect] as const);
        writeFileSync(`${out}/${fixture}-${aspect}-${m.name}.png`, Buffer.from(url.split(',')[1]!, 'base64'));
      }
    }
    await page.close();
  }

  if (doExport) {
    const runs: [fixture: string, aspect: string, query: string, label: string][] = [
      ['near-miss', 'vertical', '', 'near-miss-vertical'],
      ['near-miss', 'wide', '&audio=opus', 'near-miss-wide-opus'],
      ['zone', 'vertical', '&audio=opus', 'zone-vertical-opus'],
    ];
    if (doFallback) runs.push(['zone', 'vertical', '&export=mediarecorder', 'zone-vertical-fallback']);
    for (const [fixture, aspect, query, label] of runs) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('pageerror', (e) => problems.push(`${label}: ${e}`));
      page.on('console', (m) => m.type() === 'error' && problems.push(`${label}: ${m.text()}`));
      await page.goto(new URL(`clip.html?fixture=${fixture}${query}`, base).href);
      await page.waitForFunction(() => (window as unknown as { __clip?: { ready: boolean } }).__clip?.ready === true, null, { timeout: 20000 });
      const expect = await page.evaluate(() => (window as unknown as { __clip: Clip }).__clip.duration);
      const t0 = Date.now();
      const res = await page.evaluate((a) => (window as unknown as { __clip: Clip }).__clip.exportVideo(a), aspect);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      await page.close();
      if (!res) { problems.push(`${label}: export failed`); continue; }
      const ext = String(res.result.ext);
      const file = `${out}/${label}.${ext}`;
      const bytes = Buffer.from(res.base64, 'base64');
      writeFileSync(file, bytes);
      const info = { ...res.result, bytes: bytes.length, renderSeconds: secs };
      console.log(`${label}: ${JSON.stringify(info)}`);
      const want = { w: aspect === 'vertical' ? 1080 : 1920, h: aspect === 'vertical' ? 1920 : 1080, d: expect };
      const webcodecs = res.result.method === 'webcodecs';
      if (bytes.length < 1_000_000 || bytes.length > 24_000_000) problems.push(`${label}: odd size ${bytes.length} (want 1–24 MB)`);
      if (ffprobe) {
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', file]).toString()) as {
          streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_read_frames?: string; avg_frame_rate?: string; duration?: string; sample_rate?: string }[];
          format: { duration: string; format_name: string };
        };
        const v = probe.streams.find((s) => s.codec_type === 'video');
        const a = probe.streams.find((s) => s.codec_type === 'audio');
        const dur = Number(probe.format.duration);
        console.log(`   ffprobe: ${probe.format.format_name} ${dur.toFixed(2)} s, video ${v?.codec_name} ${v?.width}x${v?.height} ${v?.avg_frame_rate} (${v?.nb_read_frames} frames), audio ${a ? `${a.codec_name} ${a.sample_rate} Hz` : 'none'}`);
        if (!v || v.width !== want.w || v.height !== want.h) problems.push(`${label}: wrong video stream ${v?.width}x${v?.height}`);
        if (webcodecs && v?.codec_name !== 'h264') problems.push(`${label}: not H.264`);
        // real-time recording can end a few frames early; the offline export must be exact
        if (Math.abs(dur - want.d) > (webcodecs ? 0.1 : 0.6)) problems.push(`${label}: duration ${dur} vs ${want.d}`);
        if (res.result.audioCodec && !a) problems.push(`${label}: audio track missing`);
      } else {
        // no ffprobe: check the MP4 boxes by hand (ftyp, moov with mvhd duration)
        const box = (name: string) => bytes.indexOf(Buffer.from(name, 'latin1'));
        if (box('ftyp') !== 4 || box('moov') < 0 || box('mdat') < 0) problems.push(`${label}: not an MP4`);
        const mvhd = box('mvhd');
        if (mvhd > 0) {
          const scale = bytes.readUInt32BE(mvhd + 16), dur = bytes.readUInt32BE(mvhd + 20) / scale;
          console.log(`   mvhd duration ${dur.toFixed(2)} s`);
          if (Math.abs(dur - want.d) > 0.25) problems.push(`${label}: duration ${dur} vs ${want.d}`);
        }
      }
      if (ffmpeg) {
        for (const at of [2, want.d * 0.5, want.d - 3.6, want.d - 0.3]) {
          execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', at.toFixed(2), '-i', file, '-frames:v', '1', `${out}/${label}-frame-${at.toFixed(1)}s.png`]);
        }
        if (res.result.audioCodec) {
          const log = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
          console.log(`   ${(String(log).match(/mean_volume: [^\n]*/) ?? ['?'])[0]}, ${(String(log).match(/max_volume: [^\n]*/) ?? ['?'])[0]}`);
        }
      }
    }
  }
} finally {
  await browser.close();
  await vite.close();
}
console.log(`\nScreenshots and videos in ${out}/`);
if (problems.length) {
  console.log('\nPROBLEMS:\n  ' + problems.join('\n  '));
  process.exit(1);
}
process.exit(0);
