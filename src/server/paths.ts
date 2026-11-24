// Database locations (SPEC §9 "Database separation"). The personal database
// can never be, or alias, the demo database, and the demo reset can never
// reach outside the repository's real `.demo/` directory.
//
// Containment uses canonical paths (realpathSync.native returns the on-disk
// spelling, so `.DEMO` on a case-insensitive filesystem resolves to `.demo`)
// and file identity (device + inode), which also catches hard links.

import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const canonical = (path: string) => realpathSync.native(path);

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
const sameFile = (a: string, b: string) => {
  const sa = statSync(a);
  const sb = statSync(b);
  return sa.dev === sb.dev && sa.ino === sb.ino;
};

const reserved = (demoDir: string) =>
  new PathError(`DB_PATH resolves inside the reserved demo directory (${demoDir}); use a different path`);

/**
 * Personal mode: DB_PATH, or `<repo>/.data/library.sqlite` when unset.
 * Returns the canonical target, refusing anything that is, or is inside, the
 * demo directory, or that is the same file as the demo database.
 */
export function resolvePersonalDbPath(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = canonical(repoRoot);
  const demoDir = join(root, '.demo');
  let dbPath: string;
  if (env.DB_PATH === undefined || env.DB_PATH === '') {
    const dataDir = join(root, '.data');
    ensureRealDirectory(dataDir, 'The personal data directory');
    dbPath = join(dataDir, 'library.sqlite');
  } else {
    dbPath = resolve(env.DB_PATH);
    // Lexical check first, so a path under .demo is refused even before .demo
    // exists. Alternate spellings of an existing .demo (case, symlinks) are
    // caught by the identity checks below.
    if (inside(dbPath, demoDir)) throw reserved(demoDir);
  }
  const st = lstatOrNull(dbPath);
  let target: string;
  if (st) {
    try {
      target = canonical(dbPath); // follows every symlink, including the final component
    } catch {
      throw new PathError(`DB_PATH ${dbPath} is a dangling symlink`);
    }
  } else {
    const parent = dirname(dbPath);
    if (!lstatOrNull(parent)) throw new PathError(`The directory for DB_PATH does not exist: ${parent}`);
    target = join(canonical(parent), basename(dbPath));
  }
  if (inside(target, demoDir)) throw reserved(demoDir);
  if (lstatOrNull(demoDir)) {
    // Identity checks: an ancestor that *is* the demo directory under another
    // spelling, or a hard link to the demo database.
    for (let dir = dirname(target); ; dir = dirname(dir)) {
      if (lstatOrNull(dir) && sameFile(dir, demoDir)) throw reserved(demoDir);
      if (dirname(dir) === dir) break;
    }
    const demoFile = join(demoDir, 'demo.sqlite');
    if (st && lstatOrNull(demoFile) && sameFile(target, demoFile)) {
      throw new PathError('DB_PATH is the same file as the demo database (hard link); use a different path');
    }
  }
  return target;
}

/** Demo mode: always `<repo>/.demo/demo.sqlite`, validated before any open or write. */
export function prepareDemoDbPath(repoRoot: string): string {
  const root = canonical(repoRoot);
  const demoDir = join(root, '.demo');
  ensureRealDirectory(demoDir, 'The demo directory');
  if (canonical(demoDir) !== demoDir) throw new PathError(`The demo directory ${demoDir} resolves elsewhere`);
  const file = join(demoDir, 'demo.sqlite');
  const st = lstatOrNull(file);
  if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1)) {
    throw new PathError(`${file} must be a regular file (not a symlink or hard link)`);
  }
  return file;
}

/**
 * The repository root (this file lives in <root>/src/server). RB_ROOT
 * overrides it so the process-level tests can run the real commands against an
 * isolated temporary root; the §9 rules apply unchanged to that root.
 */
export const REPO_ROOT = process.env.RB_ROOT
  ? resolve(process.env.RB_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
