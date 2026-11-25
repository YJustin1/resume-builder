// Local API server. `node src/server/main.ts` uses the personal database;
// `--demo` uses the fixed demo database (SPEC §9). Binds to loopback only.
// PORT defaults to 5174; PORT=0 picks a free port (printed on startup).

import { serve } from '@hono/node-server';
import { openDatabase } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { createApp } from './app.ts';
import { acquireDemoLock } from './demo-lock.ts';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BUILD_OUT } from './served.ts';
import { PathError, prepareDemoDbPath, REPO_ROOT, resolvePersonalDbPath } from './paths.ts';

const demo = process.argv.includes('--demo');
// --ui: also serve the built client (dist/client, from `vite build`) on the same port.
// It is located next to the code, not under RB_ROOT: the build is a code artifact, not data.
const uiDir = process.argv.includes('--ui') ? BUILD_OUT : undefined;
if (uiDir && !existsSync(join(uiDir, 'index.html'))) {
  process.stderr.write(`Refusing to start: no built UI at ${uiDir}; run \`npm run build\` first.\n`);
  process.exit(2);
}
let dbPath: string;
let releaseLock = () => {};
try {
  dbPath = demo ? prepareDemoDbPath(REPO_ROOT) : resolvePersonalDbPath(REPO_ROOT);
  // A demo server holds the demo lock for its lifetime, so demo:seed cannot
  // replace the file under it (SPEC §9 "Demo lock").
  if (demo) releaseLock = acquireDemoLock(dirname(dbPath), 'server');
} catch (error) {
  if (error instanceof PathError) {
    process.stderr.write(`Refusing to start: ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}

process.on('exit', () => releaseLock());
const db = openDatabase(dbPath);
const app = createApp(new Library(db), uiDir ? { uiDir } : {});
const port = Number(process.env.PORT ?? 5174);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  process.stdout.write(`listening on http://127.0.0.1:${info.port} (${demo ? 'demo' : 'personal'} db: ${dbPath}${uiDir ? '; UI at /' : ''})\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    releaseLock();
    process.exit(0);
  });
}
