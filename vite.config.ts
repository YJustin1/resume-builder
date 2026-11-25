// Client build and dev server (SPEC §3.1, §6). The UI always calls relative
// /api URLs: in development Vite proxies them to the API server; the built
// app is served by the API server itself (`npm run demo`, `--ui`).

import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { CLIENT_DIR, PROJECT, servedDirs } from './src/server/served.ts';

export const API_PORT = Number(process.env.API_PORT ?? 5174);
const client = realpathSync(CLIENT_DIR);

/**
 * `vite build` empties dist/client. Refuse to build unless dist and dist/client
 * are real directories exactly where they appear (no symlink, no alias), so the
 * cleanup can never reach a database elsewhere, e.g. .data/ through a symlinked
 * dist/client (Codex Phase 4 verification, round 2, finding 1).
 */
const safeOutDir: Plugin = {
  name: 'resume-builder-safe-outdir',
  apply: 'build',
  configResolved() {
    for (const dir of [join(PROJECT, 'dist'), join(PROJECT, 'dist', 'client')]) {
      let st;
      try {
        st = lstatSync(dir);
      } catch {
        continue; // created fresh by the build
      }
      if (st.isSymbolicLink() || !st.isDirectory() || realpathSync(dir) !== dir) {
        throw new Error(`Refusing to build: ${dir} must be a real directory (not a symlink or alias); remove it and retry.`);
      }
    }
  },
};

export default defineConfig({
  root: client,
  // No public directory: it would bypass server.fs.deny (Codex Phase 4 review, round 2).
  publicDir: false,
  // Test copies point this at a private directory so parallel dev servers don't share a cache.
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  plugins: [safeOutDir, react()],
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
      allow: servedDirs(),
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/*.sqlite', '**/*.sqlite-*', '**/.data/**', '**/.demo/**'],
    },
    // Host stays 127.0.0.1:<ui port> and Origin is the loopback UI origin, so the
    // API's loopback Host and Origin checks pass unchanged (SPEC §6).
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
});
