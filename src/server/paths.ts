// Database locations (SPEC §9 "Database separation"). The personal database
// can never be, or alias, the demo database, and the demo reset can never
// reach outside the repository's real `.demo/` directory.

import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Create `dir` (0700) if absent; if present it must be a real directory, not a symlink. */
function ensureRealDirectory(dir: string, what: string): void {
  const st = lstatOrNull(dir);
  if (!st) {
    mkdirSync(dir, { mode: 0o700 });
    return;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new PathError(`${what} (${dir}) must be a real directory, not a symlink`);
}

const inside = (target: string, dir: string) => target === dir || target.startsWith(dir + sep);

/**
 * Personal mode: DB_PATH, or `<repo>/.data/library.sqlite` when unset.
 * Returns the fully resolved target, refusing anything inside `<repo>/.demo`.
 */
export function resolvePersonalDbPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = realpathSync(repoRoot);
  const demoDir = join(root, '.demo');
  let dbPath: string;
  if (env.DB_PATH === undefined || env.DB_PATH === '') {
    const dataDir = join(root, '.data');
    ensureRealDirectory(dataDir, 'The personal data directory');
    dbPath = join(dataDir, 'library.sqlite');
  } else {
    dbPath = resolve(env.DB_PATH);
    // Lexical check first, so a path under .demo is refused even before
    // .demo exists (the resolved check below catches symlink aliases).
    if (inside(dbPath, demoDir)) {
      throw new PathError(`DB_PATH resolves inside the reserved demo directory (${demoDir}); use a different path`);
    }
  }
  const st = lstatOrNull(dbPath);
  let target: string;
  if (st) {
    try {
      target = realpathSync(dbPath); // follows every symlink, including the final component
    } catch {
      throw new PathError(`DB_PATH ${dbPath} is a dangling symlink`);
    }
  } else {
    const parent = dirname(dbPath);
    if (!lstatOrNull(parent)) throw new PathError(`The directory for DB_PATH does not exist: ${parent}`);
    target = join(realpathSync(parent), basename(dbPath));
  }
  if (inside(target, demoDir)) {
    throw new PathError(`DB_PATH resolves inside the reserved demo directory (${demoDir}); use a different path`);
  }
  return target;
}

/** Demo mode: always `<repo>/.demo/demo.sqlite`, validated before any open or write. */
export function prepareDemoDbPath(repoRoot: string): string {
  const root = realpathSync(repoRoot);
  const demoDir = join(root, '.demo');
  ensureRealDirectory(demoDir, 'The demo directory');
  if (realpathSync(demoDir) !== demoDir) throw new PathError(`The demo directory ${demoDir} resolves elsewhere`);
  const file = join(demoDir, 'demo.sqlite');
  const st = lstatOrNull(file);
  if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1)) {
    throw new PathError(`${file} must be a regular file (not a symlink or hard link)`);
  }
  return file;
}

/** The repository root (this file lives in <root>/src/server). */
export const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
