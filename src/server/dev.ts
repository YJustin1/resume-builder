// `npm run dev` (SPEC §9): the Vite dev server (UI with live reload, proxying
// /api) plus the API server on the personal database, as one command.
//
// Lifecycle: Vite starts first, so if the UI port is taken the API (and the
// personal database) is never opened. The API's exit code is passed through
// (2 when it refuses a database path), always after Vite has closed, and a
// signal stops both and waits for the API to exit.

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const apiPort = Number(process.env.API_PORT ?? 5174);
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
  vite = await createServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)) });
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
  stdio: 'inherit',
  env: { ...process.env, PORT: String(apiPort) },
});
api.on('exit', (code, signal) => {
  if (stopping) return;
  process.stderr.write(`API server exited (${code ?? signal}); stopping the UI dev server.\n`);
  void stop(code ?? 1);
});
