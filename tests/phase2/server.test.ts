// Phase 2: the real server process. T10 (persistence across a restart) and the
// SPEC §9 database-location isolation tests 1-7.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PathError, prepareDemoDbPath, resolvePersonalDbPath } from '../../src/server/paths.ts';
import { readFixture } from '../support/harness.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const MAIN = join(ROOT, 'src/server/main.ts');

let temp: string[] = [];
afterEach(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
  temp = [];
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'rb-p2-'));
  temp.push(d);
  return d;
};

/** Start the real server on a free port; resolves with its base URL and a stop function. */
function startServer(env: Record<string, string>, args: string[] = []) {
  const child = spawn(process.execPath, [MAIN, ...args], { env: { ...process.env, ...env, PORT: '0' } });
  return new Promise<{ url: string; stop: () => Promise<void> }>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        resolve({
          url: m[1]!,
          stop: () => new Promise((done) => {
            child.once('exit', () => done());
            child.kill('SIGTERM');
          }),
        });
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => reject(new Error(`server exited (${code}): ${out}`)));
  });
}

describe('T10 persistence across a real server restart', () => {
  it('the T02 configuration survives a process restart on a file DB', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'library.sqlite');
    // Seed through the service in-process, then serve the same file.
    const { openDatabase } = await import('../../src/db/database.ts');
    const { Library } = await import('../../src/db/library.ts');
    const { loadFixture } = await import('../../src/db/seed.ts');
    const db = openDatabase(dbPath);
    loadFixture(new Library(db), readFixture('primary.input.json'));
    db.close();

    const t02 = readFixture('primary-mutations.expected.json').cases.find((c: any) => c.case === 'T02');
    const first = await startServer({ DB_PATH: dbPath });
    const put = await fetch(`${first.url}/api/resumes/r-security`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(t02.steps[0].payload),
    });
    expect(put.status).toBe(200);
    await first.stop();

    const second = await startServer({ DB_PATH: dbPath });
    try {
      expect(await (await fetch(`${second.url}/api/resumes/r-security/export/json`)).json()).toEqual(t02.expected['r-security']);
      expect(await (await fetch(`${second.url}/api/resumes/r-engineering/export/json`)).json()).toEqual(
        readFixture('engineering.expected.json'),
      );
    } finally {
      await second.stop();
    }
  }, 30_000);
});

// Unit-level checks of the path helpers; tests/phase2/commands.test.ts runs the
// same §9 cases through the real seed and server commands.
describe('§9 path helpers (unit level)', () => {
  /** A fake repository root with its own .data/.demo. */
  const fakeRepo = () => {
    const repo = tempDir();
    return { repo, demo: join(repo, '.demo'), data: join(repo, '.data') };
  };
  const refuses = (fn: () => unknown) => expect(fn).toThrow(PathError);

  it('1: demo reset leaves a personal database byte-identical', () => {
    const { repo } = fakeRepo();
    const personal = resolvePersonalDbPath(repo, {});
    writeFileSync(personal, 'personal-bytes');
    const demo = prepareDemoDbPath(repo);
    writeFileSync(demo, 'demo');
    rmSync(demo);
    expect(prepareDemoDbPath(repo)).toBe(demo);
    expect(readFileSync(personal, 'utf8')).toBe('personal-bytes');
  });

  it('2: DB_PATH pointing into .demo is refused, including via ../', () => {
    const { repo, demo } = fakeRepo();
    mkdirSync(demo);
    refuses(() => resolvePersonalDbPath(repo, { DB_PATH: join(demo, 'demo.sqlite') }));
    refuses(() => resolvePersonalDbPath(repo, { DB_PATH: join(demo, '..', '.demo', 'demo.sqlite') }));
  });

  it('3: a symlinked demo.sqlite is refused and its target untouched', () => {
    const { repo, demo } = fakeRepo();
    mkdirSync(demo);
    const outside = join(tempDir(), 'personal.sqlite');
    writeFileSync(outside, 'personal-bytes');
    symlinkSync(outside, join(demo, 'demo.sqlite'));
    refuses(() => prepareDemoDbPath(repo));
    expect(readFileSync(outside, 'utf8')).toBe('personal-bytes');
  });

  it('3b: a hard-linked demo.sqlite is refused', () => {
    const { repo, demo } = fakeRepo();
    mkdirSync(demo);
    const outside = join(tempDir(), 'personal.sqlite');
    writeFileSync(outside, 'personal-bytes');
    linkSync(outside, join(demo, 'demo.sqlite'));
    refuses(() => prepareDemoDbPath(repo));
  });

  it('4: a symlinked .demo directory is refused and the database behind it untouched', () => {
    const { repo, demo } = fakeRepo();
    const personalDir = tempDir();
    writeFileSync(join(personalDir, 'demo.sqlite'), 'personal-bytes');
    symlinkSync(personalDir, demo);
    refuses(() => prepareDemoDbPath(repo));
    expect(readFileSync(join(personalDir, 'demo.sqlite'), 'utf8')).toBe('personal-bytes');
  });

  it('5: on a fresh repository, the demo path creates .demo/', () => {
    const { repo, demo } = fakeRepo();
    expect(existsSync(demo)).toBe(false);
    expect(prepareDemoDbPath(repo)).toMatch(/\.demo\/demo\.sqlite$/);
    expect(existsSync(demo)).toBe(true);
  });

  it('6: an outside DB_PATH symlink aliasing the demo DB, or a dangling one, is refused', () => {
    const { repo, demo } = fakeRepo();
    mkdirSync(demo);
    writeFileSync(join(demo, 'demo.sqlite'), 'demo');
    const alias = join(tempDir(), 'alias.sqlite');
    symlinkSync(join(demo, 'demo.sqlite'), alias);
    refuses(() => resolvePersonalDbPath(repo, { DB_PATH: alias }));
    const dangling = join(tempDir(), 'dangling.sqlite');
    symlinkSync(join(tempDir(), 'nowhere.sqlite'), dangling);
    refuses(() => resolvePersonalDbPath(repo, { DB_PATH: dangling }));
  });

  it('7: fresh repository without DB_PATH creates .data/; a symlinked .data is refused; a missing DB_PATH parent is refused', () => {
    const { repo, data } = fakeRepo();
    expect(resolvePersonalDbPath(repo, {})).toMatch(/\.data\/library\.sqlite$/);
    expect(existsSync(data)).toBe(true);
    const other = fakeRepo();
    symlinkSync(tempDir(), other.data);
    refuses(() => resolvePersonalDbPath(other.repo, {}));
    refuses(() => resolvePersonalDbPath(repo, { DB_PATH: join(repo, 'missing-dir', 'x.sqlite') }));
  });

  it('the server process refuses to start on a reserved path (exit 2, clear message)', () => {
    // .demo/ may or may not exist in this checkout; the lexical check refuses either way.
    const run = spawnSync(process.execPath, [MAIN], {
      env: { ...process.env, DB_PATH: join(ROOT, '.demo', 'never-created', 'demo.sqlite'), PORT: '0' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/Refusing to start: DB_PATH resolves inside the reserved demo directory/);
  });
});
