// `npm run demo:seed -- --reset [--with-sections]` (SPEC §9 "Demo seed
// composition"). Writes only to the validated `<root>/.demo/demo.sqlite`,
// ignores DB_PATH, and refuses to overwrite without --reset.
//
// The new database is built completely in a temporary file inside `.demo/`
// (one transaction for all fixtures), then atomically renamed over the old
// one. Any failure removes the temporary file and leaves the previous demo
// database untouched.

import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openDatabase, transaction } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { loadFixture } from '../db/seed.ts';
import { PathError, prepareDemoDbPath, REPO_ROOT } from './paths.ts';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const withSections = args.includes('--with-sections');
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', name), 'utf8')) as Record<string, unknown>;

let temp: string | undefined;
try {
  const file = prepareDemoDbPath(REPO_ROOT);
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
  renameSync(temp, file); // atomic replacement on the same filesystem
  temp = undefined;
  for (const suffix of ['-journal', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  process.stdout.write(`demo database ready: ${file} (resumes: ${names.join(', ')})\n`);
} catch (error) {
  if (temp) rmSync(temp, { force: true });
  process.stderr.write(`demo:seed refused: ${(error as Error).message}\n`);
  process.exit(2);
}
