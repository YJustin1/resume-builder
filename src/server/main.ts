// Local API server. `node src/server/main.ts` uses the personal database;
// `--demo` uses the fixed demo database (SPEC §9). Binds to loopback only.
// PORT defaults to 5174; PORT=0 picks a free port (printed on startup).

import { serve } from '@hono/node-server';
import { openDatabase } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { createApp } from './app.ts';
import { PathError, prepareDemoDbPath, REPO_ROOT, resolvePersonalDbPath } from './paths.ts';

const demo = process.argv.includes('--demo');
let dbPath: string;
try {
  dbPath = demo ? prepareDemoDbPath(REPO_ROOT) : resolvePersonalDbPath(REPO_ROOT);
} catch (error) {
  if (error instanceof PathError) {
    process.stderr.write(`Refusing to start: ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}

const db = openDatabase(dbPath);
const app = createApp(new Library(db));
const port = Number(process.env.PORT ?? 5174);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
  process.stdout.write(`listening on http://127.0.0.1:${info.port} (${demo ? 'demo' : 'personal'} db: ${dbPath})\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
