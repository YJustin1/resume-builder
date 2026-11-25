// A throwaway copy of the project (sources, configs, package.json; node_modules
// symlinked) for tests that start Vite or the launch commands. Builds, caches,
// .data and .demo then live in the copy, never in the live checkout (§9: tests
// use temporary directories only; §3.1: user databases stay untouched).

import { cpSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_REPO = fileURLToPath(new URL('../../', import.meta.url));

export function projectCopy(): { dir: string; remove: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rb-copy-')));
  for (const entry of ['src', 'fixtures', 'vite.config.ts', 'package.json', 'tsconfig.json']) {
    cpSync(join(LIVE_REPO, entry), join(dir, entry), { recursive: true });
  }
  symlinkSync(join(LIVE_REPO, 'node_modules'), join(dir, 'node_modules'));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
