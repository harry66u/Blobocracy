import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);

export interface StaticFile { body: Buffer; gzip: Buffer | null; type: string; cache: string }

/** Marker that tells the client (net.ts) this page is served by an edge, so it fetches a session token first. */
export const SESSION_META = '<meta name="blobocracy-session" content="pow">';

/**
 * The built client (packages/client/dist), loaded into memory once at start, gzipped ahead of
 * time. Hashed assets are cached for a year; HTML is revalidated.
 */
export function loadStatic(dir: string | undefined): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  if (!dir || !existsSync(dir)) return files;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const ext = extname(p);
      let body = readFileSync(p);
      if (ext === '.html') body = Buffer.from(body.toString().replace('</head>', `${SESSION_META}</head>`));
      const url = '/' + relative(dir, p).split(sep).join('/');
      const gz = COMPRESSIBLE.has(ext) && body.length > 512 ? gzipSync(body) : null;
      files.set(url, {
        body, gzip: gz, type: TYPES[ext] ?? 'application/octet-stream',
        cache: url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
    }
  };
  walk(dir);
  return files;
}

export function packedPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blobocracy is packed</title>
<style>
:root{--sky:#7ec8f2;--cream:#fff6e3;--plum:#4a2350;--pink:#ff4f9a;--yellow:#ffd23f}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(#5fb4ea,var(--sky));font-family:system-ui,sans-serif;color:var(--plum)}
.card{background:var(--cream);border:4px solid var(--plum);border-radius:24px;padding:28px 24px;max-width:420px;margin:16px;text-align:center;box-shadow:0 8px 0 var(--plum)}
.blob{width:72px;height:60px;margin:0 auto 12px;background:var(--yellow);border:4px solid var(--plum);border-radius:50% 50% 44% 44%}
h1{margin:.2em 0;font-size:1.8rem}.n{font-size:2.6rem;font-weight:800;color:var(--pink)}p{line-height:1.45}
</style></head><body><main class="card"><div class="blob" aria-hidden="true"></div>
<h1>Blobocracy is packed</h1>
<p>So many people are steering the blob right now that there is no room for one more pair of hands. This page checks again by itself.</p>
<p>The internet has died</p><div class="n" id="deaths" aria-live="polite">…</div><p>times so far.</p>
<p id="online"></p></main>
<script>
async function tick(){try{const r=await fetch('/api/counter',{cache:'no-store'});const c=await r.json();
document.getElementById('deaths').textContent=Number(c.deaths).toLocaleString('en-US');
document.getElementById('online').textContent=c.online?Number(c.online).toLocaleString('en-US')+' people are playing.':'';
if(!c.packed)location.reload();}catch(e){}}
tick();setInterval(tick,10000);
</script></body></html>`;
}

export function placeholderPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8">${SESSION_META}<title>Blobocracy edge</title></head>
<body><p>The client is not built. Run <code>npm run build</code> (or use <code>npm run dev:split</code>, which serves the client through Vite).</p></body></html>`;
}
