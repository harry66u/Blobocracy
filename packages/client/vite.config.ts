import { defineConfig } from 'vite';

// In development the game server runs separately (default :8080); proxy its socket.
export default defineConfig({
  server: {
    host: true,
    proxy: { '/ws': { target: `ws://localhost:${process.env.PORT ?? 8080}`, ws: true } },
  },
  build: {
    rollupOptions: { input: { main: 'index.html', preview: 'preview.html' } },
  },
});
