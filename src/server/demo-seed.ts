// `npm run demo:seed -- --reset [--with-sections]` (SPEC §9 "Demo seed
// composition"). Writes only to the validated `<repo>/.demo/demo.sqlite`,
// ignores DB_PATH, and refuses to overwrite without --reset.

import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { openDatabase } from '../db/database.ts';
import { Library } from '../db/library.ts';
import { loadFixture } from '../db/seed.ts';
import { PathError, prepareDemoDbPath, REPO_ROOT } from './paths.ts';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const withSections = args.includes('--with-sections');
const fixture = (name: string) => JSON.parse(readFileSync(join(REPO_ROOT, 'fixtures', name), 'utf8')) as Record<string, unknown>;

try {
  const file = prepareDemoDbPath(REPO_ROOT);
  let exists = true;
  try {
    lstatSync(file);
  } catch {
    exists = false;
  }
  if (exists && !reset) throw new PathError(`${file} already exists; pass --reset to replace it`);
  if (exists) for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(file + suffix, { force: true });

  const primary = fixture('primary.input.json');
  const overflow = fixture('overflow.input.json');
  if (!isDeepStrictEqual(primary.profile, overflow.profile)) {
    throw new Error('primary and overflow fixtures must have identical profiles');
  }
  const { profile: _p, ...overflowLibrary } = overflow;
  const db = openDatabase(file);
  const lib = new Library(db);
  loadFixture(lib, primary);
  loadFixture(lib, overflowLibrary);
  if (withSections) {
    const { profile, ...sectionsLibrary } = fixture('sections.input.json');
    loadFixture(lib, sectionsLibrary);
    lib.putProfile(profile);
  }
  const names = lib.listResumes().map((r) => r.name);
  db.close();
  process.stdout.write(`demo database ready: ${file} (resumes: ${names.join(', ')})\n`);
} catch (error) {
  process.stderr.write(`demo:seed refused: ${(error as Error).message}\n`);
  process.exit(2);
}
