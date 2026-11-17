// HTTP for the single-process server: the built client (static files, gzip, cache headers),
// the analytics beacon endpoint, public status and health, the private stats page and the
// admin budget control.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type uWS from 'uWebSockets.js';

interface StaticFile { body: Buffer; gz: Buffer | null; type: string; cache: string }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);

/** Loads every file under `dir` into memory, pre-gzipped. Hashed assets are cached for a year. */
export function loadStatic(dir: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  if (!existsSync(dir)) return files;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const url = '/' + relative(dir, p).split(sep).join('/');
      const ext = extname(name).toLowerCase();
      const body = readFileSync(p);
      const gz = COMPRESSIBLE.has(ext) && body.length > 512 ? gzipSync(body, { level: 9 }) : null;
      const cache = url.startsWith('/assets/') ? 'public, max-age=31536000, immutable'
        : ext === '.html' ? 'no-cache' : 'public, max-age=3600';
      files.set(url, { body, gz, type: TYPES[ext] ?? 'application/octet-stream', cache });
    }
  };
  walk(dir);
  return files;
}

/** Constant-time key check; an unset server key never matches. */
export function keyOk(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const query = (req: uWS.HttpRequest) => new URLSearchParams(req.getQuery() ?? '');

/** Client IP for rate limiting only (never stored): Fly's header, else the socket address. */
export function clientIp(res: uWS.HttpResponse, req: uWS.HttpRequest): string {
  return req.getHeader('fly-client-ip') || Buffer.from(res.getRemoteAddressAsText()).toString();
}

/** Reads a small request body; calls back with null if it is too big or the client went away. */
export function readBody(res: uWS.HttpResponse, max: number, cb: (body: string | null) => void): void {
  let size = 0;
  const parts: Buffer[] = [];
  let aborted = false;
  res.onAborted(() => { aborted = true; });
  res.onData((chunk, last) => {
    if (aborted) return;
    size += chunk.byteLength;
    if (size > max) {
      if (size - chunk.byteLength <= max) cb(null); // report once
      return;
    }
    parts.push(Buffer.from(chunk.slice(0)));
    if (last) cb(Buffer.concat(parts).toString('utf8'));
  });
}

export function send(res: uWS.HttpResponse, status: string, type: string, body: string | Buffer, headers: Record<string, string> = {}): number {
  res.cork(() => {
    res.writeStatus(status).writeHeader('content-type', type).writeHeader('x-content-type-options', 'nosniff');
    for (const [k, v] of Object.entries(headers)) res.writeHeader(k, v);
    res.end(body);
  });
  return typeof body === 'string' ? Buffer.byteLength(body) : body.length;
}

const SECURITY_HEADERS = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** Serves a static file (or index.html for "/"). Returns bytes sent, or -1 if not found. */
export function serveStatic(files: Map<string, StaticFile>, res: uWS.HttpResponse, req: uWS.HttpRequest): number {
  let url = req.getUrl();
  if (url === '/' || url === '') url = '/index.html';
  const f = files.get(url);
  if (!f) return -1;
  const gzip = f.gz && /\bgzip\b/.test(req.getHeader('accept-encoding'));
  const body = gzip ? f.gz! : f.body;
  const headers: Record<string, string> = { 'cache-control': f.cache, vary: 'accept-encoding', ...(f.type.startsWith('text/html') ? SECURITY_HEADERS : {}) };
  if (gzip) headers['content-encoding'] = 'gzip';
  return send(res, '200 OK', f.type, body, headers);
}
