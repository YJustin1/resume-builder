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
import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { PathError, REPO_ROOT, resolvePersonalDbPath } from './paths.ts';
import { CLIENT_DIR, servedDirs, within } from './served.ts';

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
for (const dir of servedDirs()) {
  if (within(dbPath, dir)) refuse(`the database ${dbPath} is inside ${dir}, which the UI dev server serves; choose a DB_PATH elsewhere`);
}

/** The reserved data directories, and the database files whose identity is protected. */
const root = realpathSync(REPO_ROOT);
const forbiddenDirs = [join(root, '.data'), join(root, '.demo')];
const withSidecars = (p: string) => [p, `${p}-journal`, `${p}-wal`, `${p}-shm`];
const protectedFiles = [...withSidecars(dbPath), ...withSidecars(join(root, '.demo', 'demo.sqlite')), join(root, '.demo', 'lock.sqlite')];
const client = realpathSync(CLIENT_DIR);

const identity = (path: string): string | null => {
  try {
    const st = statSync(path);
    return `${st.dev}:${st.ino}`;
  } catch {
    return null;
  }
};

const realOrNull = (path: string): string | null => {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
};

const decodings = (raw: string): string[] => {
  const out = new Set([raw]);
  for (const decode of [decodeURI, decodeURIComponent]) {
    try {
      out.add(decode(raw));
    } catch {
      // malformed escape: that decoder would not find a file either
    }
  }
  return [...out];
};

/**
 * Every file a request could make Vite read, resolved through symlinks. Rather
 * than mirror Vite's static handler exactly, take the union over the ways the
 * path may be decoded (raw, decodeURI as Vite's static handler does,
 * decodeURIComponent; verification round 3, finding 2) and over its fallbacks:
 * the path, the path with .html/.htm, and for a directory its index,
 * index.html and index.htm (round 2, finding 2).
 */
function resolvedTargets(url: string): string[] {
  const raw = url.split(/[?#]/)[0]!;
  const targets: string[] = [];
  for (const path of decodings(raw)) {
    const file = path.startsWith('/@fs/') ? path.slice('/@fs'.length) : join(client, path);
    const candidates = [file, `${file}.html`, `${file}.htm`, join(file, 'index'), join(file, 'index.html'), join(file, 'index.htm')];
    for (const p of candidates.map(realOrNull)) if (p !== null && !isDirectory(p)) targets.push(p);
  }
  return targets;
}

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Is this the database (any name: symlink or hard link), a sidecar, or reserved data? */
function isProtected(target: string): boolean {
  if (forbiddenDirs.some((d) => within(target, d))) return true;
  const id = identity(target);
  // Identities are read per request: the database and its sidecars come and go.
  return id !== null && protectedFiles.some((p) => identity(p) === id);
}

let apiReady = false;
const boundary: Plugin = {
  name: 'resume-builder-dev-boundary',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '/';
      if (url.startsWith('/api')) {
        if (apiReady) return next();
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'API_STARTING', message: 'The local API server is still starting.' } }));
        return;
      }
      // Vite checks the requested path; a symlink, a hard link or a directory index
      // inside a served directory could still lead to the database. Check the file
      // that would actually be read, by identity (review round 3, 2; verification, 2).
      if (resolvedTargets(url).some(isProtected)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      next();
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
  vite = await createServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), plugins: [boundary] });
  await vite.listen();
} catch (error) {
  process.stderr.write(`Refusing to start: the UI dev server could not start: ${(error as Error).message}\n`);
  await vite?.close().catch(() => undefined);
  process.exit(1);
}
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
  if (apiOut.includes(bound)) {
    apiReady = true; // our child bound the port: open the proxy, then announce the UI
    vite!.printUrls();
  }
});
api.on('exit', (code, signal) => {
  if (stopping) return;
  process.stderr.write(`API server exited (${code ?? signal}); stopping the UI dev server.\n`);
  void stop(code ?? 1);
});
