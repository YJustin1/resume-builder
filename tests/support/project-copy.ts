// A throwaway copy of the project (sources, configs, package.json) for tests
// that start Vite or the launch commands. Its node_modules is a real directory
// of per-package links, so Vite's own writes (node_modules/.vite-temp, the dep
// cache) and anything a regression might create under node_modules land in the
// copy. Builds, .data and .demo also live in the copy, never in the live
// checkout (§9: temporary directories only; §3.1: user databases untouched).

import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIVE_REPO = fileURLToPath(new URL('../../', import.meta.url));

export function projectCopy(): { dir: string; remove: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rb-copy-')));
  for (const entry of ['src', 'fixtures', 'vite.config.ts', 'package.json', 'tsconfig.json']) {
    cpSync(join(LIVE_REPO, entry), join(dir, entry), { recursive: true });
  }
  mkdirSync(join(dir, 'node_modules'));
  for (const entry of readdirSync(join(LIVE_REPO, 'node_modules'))) {
    if (entry === '.vite' || entry === '.vite-temp' || entry === '.cache') continue; // writable caches stay private
    symlinkSync(join(LIVE_REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
  }
  // Retries: Vite may still be flushing its cache into the copy when a test ends.
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}
