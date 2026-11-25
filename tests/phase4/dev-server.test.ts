// The Vite dev server's boundary (Codex Phase 4 review, round 1 findings 1-2,
// round 2 finding 2): it must never serve database files or anything outside
// the client and its dependencies, must have no public directory (which would
// bypass the deny list), and must send no CORS headers (SPEC §3.1, §6). Runs on
// a temporary project copy with synthetic databases.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projectCopy } from '../support/project-copy.ts';

const SQLITE = 'SQLite format 3\u0000 synthetic SECRET';
const copy = projectCopy();
const R = copy.dir;
let vite: ViteDevServer;
let base: string;

beforeAll(async () => {
  const files = [
    '.data/library.sqlite',
    '.data/library.sqlite-wal',
    '.demo/demo.sqlite',
    'personal.db', // a custom DB_PATH with any name, outside the client
    'notes.txt',
    'src/client/public/personal.db', // the (disabled) public directory
    'src/client/stray.sqlite',
  ];
  for (const f of files) {
    mkdirSync(join(R, f, '..'), { recursive: true });
    writeFileSync(join(R, f), SQLITE);
  }
  vite = await createServer({
    configFile: join(R, 'vite.config.ts'),
    cacheDir: join(R, '.vite-cache'),
    server: { port: 0, strictPort: false },
    logLevel: 'error',
  });
  await vite.listen();
  base = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`;
}, 60_000);

afterAll(async () => {
  await vite?.close();
  copy.remove();
});

describe('Vite dev server boundary', () => {
  it('serves the UI and its dependencies', async () => {
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await fetch(`${base}/main.tsx`)).status).toBe(200);
  });

  it.each(['.data/library.sqlite', '.data/library.sqlite-wal', '.demo/demo.sqlite', 'personal.db', 'notes.txt', 'package.json', 'src/db/database.ts'])(
    'refuses /@fs/<root>/%s with 403',
    async (path) => {
      const res = await fetch(`${base}/@fs${join(R, path)}`);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('SECRET');
    },
  );

  // /personal.db would come from src/client/public/ if the public directory were on.
  // (Other files inside src/client are client sources and are served by design; an
  // actual database there is refused by the launcher, see launch-commands.test.ts.)
  it.each(['/personal.db', '/stray.sqlite', `/@fs${join(R, 'src/client/stray.sqlite')}`])('never serves %s (no public dir; database names denied)', async (path) => {
    expect(await (await fetch(`${base}${path}`)).text()).not.toContain('SECRET');
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
