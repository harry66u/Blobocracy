import { defineConfig, type Plugin } from 'vite';

const target = `localhost:${process.env.PORT ?? 8080}`;

/**
 * `npm run dev:split` proxies to an edge relay, which wants a session token: mark the page the
 * way an edge marks the index.html it serves, so net.ts does the proof of work first.
 */
const sessionMarker = (): Plugin => ({
  name: 'blobocracy-session-marker',
  transformIndexHtml: (html) => (process.env.BLOB_SESSION === '1'
    ? html.replace('</head>', '<meta name="blobocracy-session" content="pow"></head>')
    : html),
});

// In development the game server (or an edge, in dev:split) runs separately (default :8080); proxy it.
export default defineConfig({
  plugins: [sessionMarker()],
  server: {
    host: true,
    proxy: {
      '/ws': { target: `ws://${target}`, ws: true },
      '/session': { target: `http://${target}` },
      '/api': { target: `http://${target}` },
      '/admin': { target: `http://${target}` },
    },
  },
  build: {
    rollupOptions: { input: { main: 'index.html', preview: 'preview.html' } },
  },
});
