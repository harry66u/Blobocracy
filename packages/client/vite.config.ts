import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const serverPort = process.env.PORT ?? 8080;

/**
 * Link previews need absolute URLs (crawlers don't run JavaScript and ignore relative
 * og:image paths). SITE_URL is the public address, e.g. https://blobocracy.com.
 * Production builds refuse to run without a real https SITE_URL.
 */
function siteUrl(): Plugin {
  let url = '';
  let ogVersion = 'dev';
  return {
    name: 'blobocracy-site-url',
    config(_, { command }) {
      const raw = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
      if (command === 'build') {
        if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(raw)) {
          throw new Error(`SITE_URL must be the public https address, e.g. SITE_URL=https://blobocracy.com npm run build (got "${raw}")`);
        }
      }
      url = raw || `http://localhost:5173`;
      const og = fileURLToPath(new URL('./public/og.png', import.meta.url));
      if (existsSync(og)) ogVersion = createHash('sha1').update(readFileSync(og)).digest('hex').slice(0, 8);
      return { define: { 'import.meta.env.VITE_SITE_URL': JSON.stringify(raw) } };
    },
    transformIndexHtml(html) {
      return html.replaceAll('__SITE_URL__', url).replaceAll('__OG_VERSION__', ogVersion);
    },
  };
}

// In development the game server runs separately (default :8080); proxy its socket and HTTP API.
export default defineConfig({
  plugins: [siteUrl()],
  server: {
    host: true,
    proxy: {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/a': `http://localhost:${serverPort}`,
      '/api': `http://localhost:${serverPort}`,
      '/stats': `http://localhost:${serverPort}`,
    },
  },
  build: {
    rollupOptions: { input: { main: 'index.html' } },
  },
});
