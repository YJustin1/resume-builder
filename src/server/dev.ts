// `npm run dev` (SPEC §9): the Vite dev server (UI with live reload, proxying
// /api) plus the API server on the personal database, as one command.
//
// Lifecycle: Vite starts first, so if the UI port is taken the API (and the
// personal database) is never opened. The API's exit code is passed through
// (2 when it refuses a database path), always after Vite has closed, and a
// signal stops both and waits for the API to exit.
//
// Boundary: the database the API will open must not lie inside anything the
// dev server serves (whatever its file name), and /api answers 503 until this
// launcher's own API child has bound its port, so another server already on
// that port (e.g. `npm run demo`) can never answer through the proxy.

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { PathError, REPO_ROOT, resolvePersonalDbPath } from './paths.ts';

const apiPort = Number(process.env.API_PORT ?? 5174);
const refuse = (message: string): never => {
  process.stderr.write(`Refusing to start: ${message}\n`);
  process.exit(2);
};

// The same resolution the API performs (symlinks followed, .demo refused).
let dbPath = '';
try {
  dbPath = resolvePersonalDbPath(REPO_ROOT);
} catch (error) {
  if (error instanceof PathError) refuse(error.message);
  throw error;
}
const served = ['../client', '../../node_modules'].map((p) => realpathSync(fileURLToPath(new URL(p, import.meta.url))));
const within = (child: string, dir: string) => {
  const r = relative(dir, child);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};
for (const dir of served) {
  if (within(dbPath, dir)) refuse(`the database ${dbPath} is inside ${dir}, which the UI dev server serves; choose a DB_PATH elsewhere`);
}

let apiReady = false;
const apiGate: Plugin = {
  name: 'resume-builder-api-gate',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (apiReady || !(req.url ?? '').startsWith('/api')) return next();
      res.statusCode = 503;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'API_STARTING', message: 'The local API server is still starting.' } }));
    });
  },
};
let vite: ViteDevServer | undefined;
let api: ChildProcess | undefined;
let stopping = false;

async function stop(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    if (api && api.exitCode === null && api.signalCode === null) {
      const exited = once(api, 'exit');
      api.kill('SIGTERM');
      await exited;
    }
    await vite?.close().catch(() => undefined);
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop(0));
// Backstop for any other exit path: never leave the API (and the personal
// database) running without the launcher.
process.on('exit', () => {
  if (api && api.exitCode === null && api.signalCode === null) api.kill('SIGTERM');
});

try {
  vite = await createServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), plugins: [apiGate] });
  await vite.listen();
} catch (error) {
  process.stderr.write(`Refusing to start: the UI dev server could not start: ${(error as Error).message}\n`);
  await vite?.close().catch(() => undefined);
  process.exit(1);
}
vite.printUrls();
// Vite installs its own SIGTERM handler that closes Vite and calls
// process.exit() at once, which would race ours and skip waiting for the API.
process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => void stop(0));

api = spawn(process.execPath, [fileURLToPath(new URL('./main.ts', import.meta.url))], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, PORT: String(apiPort) },
});
let apiOut = '';
const bound = `listening on http://127.0.0.1:${apiPort} `;
api.stdout!.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (apiReady) return;
  apiOut += chunk.toString();
  if (apiOut.includes(bound)) apiReady = true; // our child bound the port: open the proxy
});
api.on('exit', (code, signal) => {
  if (stopping) return;
  process.stderr.write(`API server exited (${code ?? signal}); stopping the UI dev server.\n`);
  void stop(code ?? 1);
});
