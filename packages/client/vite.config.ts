import { defineConfig, type Plugin } from 'vite';

/** Clip links (/c/<id>) are served the clip page; in production the edge does the same. */
const clipRoutes = (): Plugin => ({
  name: 'clip-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/c\/[A-Za-z0-9_-]{1,64}\/?(\?.*)?$/.test(req.url)) req.url = '/clip.html';
      next();
    });
  },
});

/**
 * `npm run dev:split` proxies to an edge relay, which wants a session token: mark the page the
 * way an edge marks the HTML it serves, so net.ts does the proof of work first.
 */
const sessionMarker = (): Plugin => ({
  name: 'blobocracy-session-marker',
  transformIndexHtml: (html) => (process.env.BLOB_SESSION === '1'
    ? html.replace('</head>', '<meta name="blobocracy-session" content="pow"></head>')
    : html),
});

const target = `localhost:${process.env.PORT ?? 8080}`;

// In development the game server (or an edge, in dev:split) runs separately (default :8080); proxy it.
export default defineConfig({
  plugins: [clipRoutes(), sessionMarker()],
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
    rollupOptions: { input: { main: 'index.html', preview: 'preview.html', clip: 'clip.html' } },
  },
});
