// `npm run demo:seed -- --reset [--with-sections]` (SPEC §9 "Demo seed
// composition"). Writes only to the validated `<root>/.demo/demo.sqlite`,
// ignores DB_PATH, and refuses to overwrite without --reset.
//
// The whole run holds the demo lock (refused while a demo server or another
// seed holds it). A seed that had to wait for the lock re-checks the demo
// file's identity and refuses if another seed published meanwhile. The old
// database is never opened or modified: if any SQLite sidecar file exists
// (left by an interrupted write), the reset is refused with instructions, so a
// refused reset always leaves the old database byte-identical. The new
// database is built completely in a temporary file inside `.demo/` (one
// transaction for all fixtures); the final step is an atomic rename over
// `demo.sqlite`, and nothing after it can turn the run into a refusal.

import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openDatabase, transaction } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { loadFixture } from '../db/seed.ts';
import { acquireDemoLock } from './demo-lock.ts';
import { lstatOrNull, PathError, prepareDemoDbPath, REPO_ROOT } from './paths.ts';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const withSections = args.includes('--with-sections');
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', name), 'utf8')) as Record<string, unknown>;

/** The demo file's identity (inode, mtime, size), or "absent". */
const identity = (file: string) => {
  const st = lstatOrNull(file);
  return st ? `${st.ino}:${st.mtimeMs}:${st.size}` : 'absent';
};

/** Refuse if SQLite recovery/sidecar files exist (lstat: dangling symlinks count). */
function refuseIfSidecars(file: string): void {
  const found = ['-journal', '-wal', '-shm'].map((s) => file + s).filter((p) => lstatOrNull(p) !== null);
  if (found.length > 0) {
    throw new PathError(
      `the demo database has SQLite recovery files left by an interrupted write (${found.join(', ')}); ` +
        'run `npm run demo` once so SQLite recovers it, or delete the .demo/ directory, then retry',
    );
  }
}

let temp: string | undefined;
let releaseLock: (() => void) | undefined;
try {
  const file = prepareDemoDbPath(REPO_ROOT);
  const seen = identity(file);
  releaseLock = acquireDemoLock(dirname(file), 'seed');
  if (identity(file) !== seen) {
    throw new PathError('another demo seed published while this one waited for the lock; nothing was changed');
  }
  if (existsSync(file) && !reset) throw new PathError(`${file} already exists; pass --reset to replace it`);
  refuseIfSidecars(file);

  const primary = fixture('primary.input.json');
  const overflow = fixture('overflow.input.json');
  if (!isDeepStrictEqual(primary.profile, overflow.profile)) {
    throw new Error('primary and overflow fixtures must have identical profiles');
  }
  const { profile: _p, ...overflowLibrary } = overflow;
  const sections = withSections ? fixture('sections.input.json') : undefined;

  temp = `${file}.tmp-${process.pid}`;
  rmSync(temp, { force: true });
  const db = openDatabase(temp);
  const lib = new Library(db);
  let names: string[] = [];
  try {
    transaction(db, () => {
      loadFixture(lib, primary);
      loadFixture(lib, overflowLibrary);
      if (sections) {
        const { profile, ...sectionsLibrary } = sections;
        loadFixture(lib, sectionsLibrary);
        lib.putProfile(profile);
      }
    });
    names = lib.listResumes().map((r) => r.name);
  } finally {
    db.close();
  }
  refuseIfSidecars(file); // again, immediately before publishing
  renameSync(temp, file); // the commit point: atomic replacement on the same filesystem
  temp = undefined;
  process.stdout.write(`demo database ready: ${file} (resumes: ${names.join(', ')})\n`);
  try {
    releaseLock();
  } catch (error) {
    // Published already: report, but never as a refused reset.
    process.stderr.write(`warning: demo database published, but releasing the lock failed: ${(error as Error).message}\n`);
  }
  releaseLock = undefined;
} catch (error) {
  if (temp) rmSync(temp, { force: true });
  try {
    releaseLock?.();
  } catch {
    /* the refusal below is the result that matters */
  }
  process.stderr.write(`demo:seed refused: ${(error as Error).message}\n`);
  process.exit(2);
}
