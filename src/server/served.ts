// What the UI dev server may serve (used by vite.config.ts and dev.ts, so the
// allow list and the launcher's database check cannot drift apart): the client
// sources and the dependency directories, as real paths. node_modules entries
// may be links (test copies link packages individually), so the directories
// their packages really live in are included too.

import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
export const CLIENT_DIR = join(PROJECT, 'src', 'client');

export function servedDirs(): string[] {
  const nodeModules = realpathSync(join(PROJECT, 'node_modules'));
  const dirs = new Set([realpathSync(CLIENT_DIR), nodeModules]);
  for (const entry of readdirSync(nodeModules)) {
    try {
      dirs.add(dirname(realpathSync(join(nodeModules, entry))));
    } catch {
      // a dangling entry serves nothing
    }
  }
  return [...dirs];
}

/** Component-wise containment: `..private.db` inside `dir` is inside; `../x` is not. */
export function within(path: string, dir: string): boolean {
  const r = relative(dir, path);
  return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
}
