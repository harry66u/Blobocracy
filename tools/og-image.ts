// The site's link-preview image (1200x630) drawn with the real game renderer: the preview
// harness (packages/client/preview.html) in the sunset sky with a crowd, the blob mid-jump,
// the flip-card counter, plus the logo and a one-line pitch in the page's own fonts.
//   npx tsx tools/og-image.ts [out=packages/client/public/og.png]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
import { createServer } from 'vite';

const out = process.argv[2] ?? 'packages/client/public/og.png';
const vite = await createServer({ root: 'packages/client', logLevel: 'warn', server: { port: 5194, strictPort: false } });
await vite.listen();
const base = vite.resolvedUrls?.local[0] ?? 'http://localhost:5194/';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // the spike run of zone 1 with a big crowd, frozen mid-jump
  await page.goto(`${base}preview.html?dots=170&x=9.2&at=1.15&freeze=1`);
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: `
    .og-bg { position: fixed; left: 0; top: 0; bottom: 0; width: 620px; z-index: 49; background: linear-gradient(#5FBFFF, #A8DEFF 70%, #CFEFFF);
      -webkit-mask-image: linear-gradient(90deg, #000 72%, transparent); mask-image: linear-gradient(90deg, #000 72%, transparent); }
    .og { position: fixed; left: 0; top: 0; bottom: 0; width: 640px; z-index: 50; padding: 120px 0 0 60px; box-sizing: border-box; font-family: 'Atkinson Hyperlegible Next', system-ui, sans-serif; color: #2A1B3D; }
    .og h1 { margin: 0; font: 400 100px/1 'Bagel Fat One', system-ui, sans-serif; color: #FFD21F; -webkit-text-stroke: 16px #2A1B3D; paint-order: stroke fill;
      text-shadow: 0 9px 0 #2A1B3D; transform: rotate(-4deg); transform-origin: 0 50%; letter-spacing: .5px; }
    .og p { margin: 44px 0 0; font-weight: 800; font-size: 34px; line-height: 1.22; max-width: 15em; }
    .og .pill { display: inline-block; margin-top: 26px; font: 400 28px/1 'Bagel Fat One', system-ui, sans-serif; background: #FF3B7A; color: #FFFBF1; border: 4.5px solid #2A1B3D;
      border-radius: 999px; padding: 14px 26px 12px; box-shadow: 0 6px 0 #2A1B3D; transform: rotate(-2deg); }
    .bl-hudbtn, .bl-touch { display: none !important; }
    #game { transform: translateX(270px); }` });
  await page.evaluate(() => {
    const bg = document.createElement('div');
    bg.className = 'og-bg';
    document.body.appendChild(bg);
    const d = document.createElement('div');
    d.className = 'og';
    d.innerHTML = '<h1>Blobocracy</h1><p>Everyone online steers the same blob. One shared life.</p><span class="pill">Can we beat it together?</span>';
    document.body.appendChild(d);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  await vite.close();
}
