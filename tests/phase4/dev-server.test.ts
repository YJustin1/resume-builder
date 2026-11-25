// The Vite dev server's boundary (Codex Phase 4 review, findings 1 and 2):
// it must never serve database files or anything outside the client and its
// dependencies, and it must send no CORS headers (SPEC §3.1, §6).

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
// A database-shaped file inside the project, like .data/library.sqlite or a custom in-workspace DB_PATH.
const probeDir = join(REPO, `.vite-probe-${process.pid}`);
let vite: ViteDevServer;
let base: string;

beforeAll(async () => {
  mkdirSync(probeDir, { recursive: true });
  for (const f of ['library.sqlite', 'library.sqlite-wal', 'notes.txt']) writeFileSync(join(probeDir, f), 'SECRET');
  vite = await createServer({ configFile: join(REPO, 'vite.config.ts'), server: { port: 0, strictPort: false }, logLevel: 'error' });
  await vite.listen();
  const address = vite.httpServer!.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  await vite?.close();
  rmSync(probeDir, { recursive: true, force: true });
});

describe('Vite dev server boundary', () => {
  it('serves the UI and its dependencies', async () => {
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/main.tsx`)).status).toBe(200);
  });

  it.each(['library.sqlite', 'library.sqlite-wal', 'notes.txt'])('refuses /@fs access to project files outside the client: %s', async (file) => {
    const res = await fetch(`${base}/@fs${join(probeDir, file)}`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('SECRET');
  });

  it.each(['package.json', 'src/db/database.ts', '.data/library.sqlite', '.demo/demo.sqlite'])('never serves %s through /@fs', async (path) => {
    // A missing file gets Vite's SPA fallback (the app's own HTML), never file bytes.
    const res = await fetch(`${base}/@fs${join(REPO, path)}`);
    const body = await res.text();
    expect(body).not.toContain('SQLite format 3');
    if (existsSync(join(REPO, path))) expect(res.status).toBe(403);
    else expect(body).toContain('<div id="root">');
  });

  it('refuses a database file even inside the client directory', async () => {
    const inside = join(REPO, 'src/client', `.probe-${process.pid}.sqlite`);
    writeFileSync(inside, 'SECRET');
    try {
      const res = await fetch(`${base}/${inside.split('/').pop()}`);
      expect(await res.text()).not.toContain('SECRET');
    } finally {
      rmSync(inside, { force: true });
    }
  });

  it('sends no CORS headers to another loopback origin, on reads or preflights', async () => {
    const origin = 'http://127.0.0.1:9';
    const read = await fetch(`${base}/`, { headers: { Origin: origin } });
    expect(read.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await fetch(`${base}/api/profile`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT' } });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    expect(preflight.headers.get('access-control-allow-methods')).toBeNull();
  });
});
