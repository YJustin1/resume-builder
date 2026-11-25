// Client build and dev server (SPEC §3.1, §6). The UI always calls relative
// /api URLs: in development Vite proxies them to the API server; the built
// app is served by the API server itself (`npm run demo`, `--ui`).

import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export const API_PORT = Number(process.env.API_PORT ?? 5174);
const client = fileURLToPath(new URL('./src/client', import.meta.url));
const nodeModules = fileURLToPath(new URL('./node_modules', import.meta.url));

export default defineConfig({
  root: client,
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.UI_PORT ?? 5173),
    strictPort: true,
    // SPEC §6: same-origin API access only, no CORS headers. Vite's default
    // allows other loopback origins, which would let a page on another local
    // port read the personal library through the proxy.
    cors: false,
    // SPEC §3.1: the browser never reads the database. Serve only the client
    // sources and its dependencies (Vite's default allows the whole project,
    // including .data/library.sqlite), and deny database files anywhere.
    fs: {
      strict: true,
      allow: [client, nodeModules],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.sqlite', '**/*.sqlite-*', '**/.data/**', '**/.demo/**'],
    },
    // Host stays 127.0.0.1:<ui port> and Origin is the loopback UI origin, so the
    // API's loopback Host and Origin checks pass unchanged (SPEC §6).
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
});
