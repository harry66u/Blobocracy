// Link preview check. Fetches the production page the way link-preview crawlers do (no
// JavaScript, crawler user agents), validates the tags and the image against what iMessage,
// Discord, X, Reddit, Slack and WhatsApp need, and draws approximate previews from exactly
// what a crawler would get. The drawings approximate each app's layout; the real check is
// pasting the deployed link (see docs/launch/launch-day.md).
// Usage: SITE_URL=https://blobocracy.com npm run build && npx tsx tools/unfurl-check.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../packages/sim/src/server';

const { chromium } = createRequire(import.meta.url)('playwright') as typeof import('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tools/out/launch');
mkdirSync(out, { recursive: true });
const srv = await startServer({ port: 0, virtualPlayers: 0, staticDir: join(root, 'packages/client/dist'), dataDir: null });
const local = `http://127.0.0.1:${srv.port}`;

const CRAWLERS = {
  'iMessage / Facebook': 'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  X: 'Twitterbot/1.0',
  Reddit: 'Mozilla/5.0 (compatible; redditbot/1.0; +http://www.reddit.com/feedback)',
  Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
};

const results: string[] = [];
const check = (ok: boolean, what: string) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${what}`); };

let html = '';
for (const [name, ua] of Object.entries(CRAWLERS)) {
  const r = await fetch(`${local}/`, { headers: { 'user-agent': ua } });
  html = await r.text();
  check(r.status === 200 && r.headers.get('content-type')!.startsWith('text/html'), `${name} crawler gets 200 text/html`);
}
const meta = (attr: 'property' | 'name', key: string) => html.match(new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`))?.[1] ?? '';
const tags = {
  title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '',
  ogTitle: meta('property', 'og:title'), ogDesc: meta('property', 'og:description'), ogUrl: meta('property', 'og:url'),
  ogImage: meta('property', 'og:image'), ogW: meta('property', 'og:image:width'), ogH: meta('property', 'og:image:height'),
  ogAlt: meta('property', 'og:image:alt'), ogSite: meta('property', 'og:site_name'), ogType: meta('property', 'og:type'),
  twCard: meta('name', 'twitter:card'), twImage: meta('name', 'twitter:image'), theme: meta('name', 'theme-color'),
  desc: meta('name', 'description'),
};
console.log(tags);
check(/^https:\/\//.test(tags.ogImage) && /^https:\/\//.test(tags.ogUrl), 'og:image and og:url are absolute https URLs (every unfurler needs this)');
check(!/localhost|127\.0\.0\.1|__SITE_URL__/.test(html), 'no localhost or placeholder URLs in the page');
check(tags.ogTitle.length > 0 && tags.ogTitle.length <= 70, `og:title present and ≤ 70 chars (${tags.ogTitle.length})`);
check(tags.ogDesc.length >= 50 && tags.ogDesc.length <= 200, `og:description 50–200 chars (${tags.ogDesc.length})`);
check(tags.twCard === 'summary_large_image', 'twitter:card is summary_large_image (big image on X)');
check(tags.twImage === tags.ogImage, 'twitter:image matches og:image');
check(tags.ogW === '1200' && tags.ogH === '630', 'og:image:width/height declared as 1200x630 (lets Facebook/iMessage render on first share)');
check(tags.ogAlt.length > 20, 'og:image:alt describes the image');
check(/^#[0-9a-f]{6}$/i.test(tags.theme), `theme-color set (${tags.theme}; Discord uses it for the embed stripe)`);

const imgPath = new URL(tags.ogImage).pathname + new URL(tags.ogImage).search;
const img = await fetch(`${local}${imgPath}`, { headers: { 'user-agent': CRAWLERS.Discord } });
const buf = Buffer.from(await img.arrayBuffer());
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
check(img.status === 200 && img.headers.get('content-type') === 'image/png', 'og image is served as image/png');
check(w === 1200 && h === 630, `og image really is ${w}x${h}`);
check(buf.length < 300_000, `og image is ${(buf.length / 1024).toFixed(0)} KB (< 300 KB so WhatsApp shows it; X allows 5 MB)`);
for (const icon of ['/apple-touch-icon.png', '/favicon.ico', '/icon.svg', '/site.webmanifest', '/robots.txt']) {
  const r = await fetch(`${local}${icon}`);
  check(r.status === 200, `${icon} is served`);
}
const robots = await (await fetch(`${local}/robots.txt`)).text();
check(!/Disallow:\s*\/\s*$/m.test(robots), 'robots.txt does not block crawlers from the page');
writeFileSync(join(out, 'unfurl-check.txt'), results.join('\n') + '\n');

// ---- approximate previews, drawn from the crawled tags --------------------------------
const host = new URL(tags.ogUrl).host;
const imgSrc = `${local}${imgPath}`;
const page = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#E9E6EF;font-family:-apple-system,system-ui,'Segoe UI',Roboto,sans-serif;padding:28px;display:grid;grid-template-columns:repeat(2,560px);gap:28px}
.frame{border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.label{font:600 12px system-ui;letter-spacing:.04em;text-transform:uppercase;color:#6B6478;margin:0 0 10px}
.im{background:#fff}.im .bubble{width:330px;margin-left:auto;border-radius:18px;overflow:hidden;background:#E9E9EB}
.im img{display:block;width:100%}.im .cap{padding:9px 12px}.im .t{font-weight:600;font-size:15px;color:#000;line-height:1.25}.im .d{font-size:13px;color:#8A8A8E;margin-top:2px}
.dc{background:#313338;color:#DBDEE1}.dc .msg{font-size:15px}.dc a{color:#00A8FC;text-decoration:none}
.dc .embed{margin-top:8px;max-width:432px;background:#2B2D31;border-left:4px solid ${tags.theme};border-radius:4px;padding:10px 14px 14px}
.dc .site{font-size:12px;color:#B5BAC1}.dc .t{color:#00A8FC;font-weight:600;font-size:15px;margin:6px 0}.dc .d{font-size:14px;line-height:1.35}.dc img{width:100%;border-radius:4px;margin-top:12px;display:block}
.x{background:#fff}.x .card{border:1px solid #CFD9DE;border-radius:16px;overflow:hidden;position:relative}.x img{display:block;width:100%}
.x .dom{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.77);color:#fff;font-size:13px;padding:1px 6px;border-radius:4px}
.x .from{font-size:13px;color:#536471;margin-top:4px}
.rd{background:#fff}.rd .post{display:flex;gap:12px;align-items:flex-start;border:1px solid #E5EBEE;border-radius:12px;padding:12px}
.rd .t{font-size:17px;font-weight:600;color:#0F1A1C;line-height:1.3}.rd .dom{font-size:12px;color:#576F76;margin-top:6px}
.rd .thumb{width:140px;height:100px;border-radius:8px;object-fit:cover;flex:none}
.rd .big{display:block;width:100%;border-radius:12px;margin-top:10px}
.note{grid-column:1/-1;font:13px system-ui;color:#4A4458;margin:0}
</style></head><body>
<p class="note">Approximate layouts drawn from the tags and image a crawler fetched from the production build (no JavaScript). Not real app screenshots: those need the deployed URL.</p>
<div class="frame im"><p class="label">iMessage (approximation)</p><div class="bubble"><img src="${imgSrc}"><div class="cap"><div class="t">${tags.ogTitle}</div><div class="d">${host}</div></div></div></div>
<div class="frame dc"><p class="label" style="color:#B5BAC1">Discord (approximation)</p><div class="msg"><a>https://${host}/?via=discord</a><div class="embed"><div class="site">${tags.ogSite}</div><div class="t">${tags.ogTitle}</div><div class="d">${tags.ogDesc}</div><img src="${imgSrc}"></div></div></div>
<div class="frame x"><p class="label">X (approximation)</p><div class="card"><img src="${imgSrc}"><span class="dom">${host}</span></div><div class="from">From ${host}</div></div>
<div class="frame rd"><p class="label">Reddit link post (approximation: feed thumbnail, then expanded)</p><div class="post"><div><div class="t">Blobocracy - everyone on the site controls the same blob at the same time, and a death sends all of us back to the start</div><div class="dom">${host}</div></div><img class="thumb" src="${imgSrc}"></div><img class="big" src="${imgSrc}"></div>
</body></html>`;
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1204, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(page, { waitUntil: 'networkidle' });
await p.screenshot({ path: join(out, 'link-previews.png'), fullPage: true });
await browser.close();
await srv.stop();
console.log(results.join('\n'));
console.log(`${results.filter((r) => r.startsWith('PASS')).length}/${results.length} checks passed; previews in ${join(out, 'link-previews.png')}`);
process.exit(results.every((r) => r.startsWith('PASS')) ? 0 : 1);
