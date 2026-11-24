// `npm run demo:seed -- --reset [--with-sections]` (SPEC §9 "Demo seed
// composition"). Writes only to the validated `<root>/.demo/demo.sqlite`,
// ignores DB_PATH, and refuses to overwrite without --reset.
//
// The whole run holds the demo lock (refused while a demo server or another
// seed holds it). The new database is built completely in a temporary file
// inside `.demo/` (one transaction for all fixtures). Before publishing, the
// old database is opened through SQLite so any hot journal from an abnormal
// shutdown is rolled back by SQLite itself (sidecars are never deleted by
// hand); if a sidecar still remains, the reset is refused. The final step is
// an atomic rename over `demo.sqlite`: any failure before it leaves the old
// database untouched, and nothing after it can turn the run into a refusal.

import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openDatabase, transaction } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { loadFixture } from '../db/seed.ts';
import { acquireDemoLock } from './demo-lock.ts';
import { PathError, prepareDemoDbPath, REPO_ROOT } from './paths.ts';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const withSections = args.includes('--with-sections');
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', name), 'utf8')) as Record<string, unknown>;

let temp: string | undefined;
let releaseLock: (() => void) | undefined;
try {
  const file = prepareDemoDbPath(REPO_ROOT);
  releaseLock = acquireDemoLock(dirname(file), 'seed');
  if (existsSync(file) && !reset) throw new PathError(`${file} already exists; pass --reset to replace it`);

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
  if (existsSync(file)) {
    // Let SQLite recover the old database (rolls back a hot journal), so no
    // recovery data is lost, and make sure no sidecar could be applied to the
    // replacement after the rename.
    const old = new DatabaseSync(file, { timeout: 0 });
    try {
      old.prepare('PRAGMA quick_check').get();
    } finally {
      old.close();
    }
    const leftover = ['-journal', '-wal', '-shm'].map((s) => file + s).filter((p) => existsSync(p));
    if (leftover.length > 0) throw new PathError(`old database sidecar files remain after recovery: ${leftover.join(', ')}`);
  }
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
