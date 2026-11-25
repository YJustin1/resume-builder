// `npm run dev` (SPEC §9): the API server on the personal database plus the
// Vite dev server, which proxies /api to it. One command, two processes; both
// stop together.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const apiPort = Number(process.env.API_PORT ?? 5174);
const api = spawn(process.execPath, [fileURLToPath(new URL('./main.ts', import.meta.url))], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(apiPort) },
});
api.on('exit', (code) => {
  process.stderr.write(`API server exited (${code ?? 'signal'}); stopping.\n`);
  process.exit(code ?? 1);
});

const vite = await createServer({ configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)) });
await vite.listen();
vite.printUrls();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    api.kill(signal);
    void vite.close().then(() => process.exit(0));
  });
}
