// Client build and dev server (SPEC §3.1, §6). The UI always calls relative
// /api URLs: in development Vite proxies them to the API server; the built
// app is served by the API server itself (`npm run demo`, `--ui`).

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export const API_PORT = Number(process.env.API_PORT ?? 5174);

export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.UI_PORT ?? 5173),
    strictPort: true,
    // Host stays 127.0.0.1:<ui port> and Origin is the loopback UI origin, so the
    // API's loopback Host and Origin checks pass unchanged (SPEC §6).
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
});
