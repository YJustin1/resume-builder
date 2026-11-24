// SPEC §9 through the real commands: `demo-seed.ts` and `main.ts` run as child
// processes against isolated temporary roots (RB_ROOT), asserting file
// contents, refusals (exit 2) and successful startup.

import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readFixture } from '../support/harness.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SEED = join(REPO, 'src/server/demo-seed.ts');
const MAIN = join(REPO, 'src/server/main.ts');

let cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true });
  cleanup = [];
});
const tempDir = (prefix = 'rb-cmd-') => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(d);
  return d;
};

/** An isolated root with copies of the fixtures the demo seed reads. */
function makeRoot(): string {
  const root = tempDir();
  mkdirSync(join(root, 'fixtures'));
  for (const f of ['primary.input.json', 'overflow.input.json', 'sections.input.json']) {
    copyFileSync(join(REPO, 'fixtures', f), join(root, 'fixtures', f));
  }
  return root;
}

const baseEnv = (root: string, extra: Record<string, string> = {}) => {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), RB_ROOT: root, PORT: '0', ...extra };
  if (!('DB_PATH' in extra)) delete env.DB_PATH;
  return env;
};

function seed(root: string, args: string[] = ['--reset'], extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SEED, ...args], { env: baseEnv(root, extra), encoding: 'utf8', timeout: 30_000 });
}

function refusesToStart(root: string, extra: Record<string, string>, args: string[] = []) {
  const run = spawnSync(process.execPath, [MAIN, ...args], { env: baseEnv(root, extra), encoding: 'utf8', timeout: 15_000 });
  expect(run.status, run.stdout + run.stderr).toBe(2);
  expect(run.stderr).toMatch(/^Refusing to start: /);
  return run;
}

function start(env: Record<string, string>, args: string[] = [], script = MAIN) {
  const child = spawn(process.execPath, [script, ...args], { env });
  return new Promise<{ url: string; stop: () => Promise<void> }>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) resolve({ url: m[1]!, stop: () => new Promise((done) => { child.once('exit', () => done()); child.kill('SIGTERM'); }) });
    });
    child.stderr.on('data', (d) => (out += d));
    child.once('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
  });
}

const bytes = (path: string) => readFileSync(path).toString('base64');

describe('demo:seed command', () => {
  it('1: a reset leaves the personal database byte-identical; demo mode serves the seeded resumes', async () => {
    const root = makeRoot();
    const personal = await start(baseEnv(root));
    const put = await fetch(`${personal.url}/api/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Personal Owner' }),
    });
    expect(put.status).toBe(201);
    await personal.stop();
    const personalFile = join(root, '.data', 'library.sqlite');
    const before = bytes(personalFile);

    expect(seed(root).status).toBe(0);
    expect(bytes(personalFile)).toBe(before);

    const demo = await start(baseEnv(root), ['--demo']);
    try {
      expect(await (await fetch(`${demo.url}/api/resumes/r-security/export/json`)).json()).toEqual(
        readFixture('security.expected.json'),
      );
      const names = (await (await fetch(`${demo.url}/api/resumes`)).json()).map((r: any) => r.name);
      expect(names).toEqual(['Engineering', 'Overflow', 'Security']);
    } finally {
      await demo.stop();
    }
  }, 60_000);

  it('refuses to overwrite without --reset and ignores DB_PATH', () => {
    const root = makeRoot();
    const other = join(root, 'other.sqlite');
    expect(seed(root, ['--reset'], { DB_PATH: other }).status).toBe(0);
    expect(existsSync(other)).toBe(false);
    const demoFile = join(root, '.demo', 'demo.sqlite');
    const before = bytes(demoFile);
    const again = seed(root, []);
    expect(again.status).toBe(2);
    expect(again.stderr).toMatch(/already exists; pass --reset/);
    expect(bytes(demoFile)).toBe(before);
  });

  it('a failed reset preserves the previous demo database and leaves no temporary file', () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const demoFile = join(root, '.demo', 'demo.sqlite');
    const before = bytes(demoFile);
    const broken = JSON.parse(readFileSync(join(root, 'fixtures', 'overflow.input.json'), 'utf8'));
    broken.variants[10].text = '';
    writeFileSync(join(root, 'fixtures', 'overflow.input.json'), JSON.stringify(broken));
    const run = seed(root);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/variants\[10\]: variant\.text must not be empty/);
    expect(bytes(demoFile)).toBe(before);
    expect(readdirSync(join(root, '.demo')).filter((f) => f !== 'lock.sqlite')).toEqual(['demo.sqlite']);
  });

  it('3: a symlinked demo.sqlite is refused and its target untouched', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.demo'));
    const outside = join(tempDir(), 'personal.sqlite');
    writeFileSync(outside, 'personal-bytes');
    symlinkSync(outside, join(root, '.demo', 'demo.sqlite'));
    expect(seed(root).status).toBe(2);
    expect(readFileSync(outside, 'utf8')).toBe('personal-bytes');
  });

  it('4: a symlinked .demo directory is refused and the database behind it untouched', () => {
    const root = makeRoot();
    const personalDir = tempDir();
    writeFileSync(join(personalDir, 'demo.sqlite'), 'personal-bytes');
    symlinkSync(personalDir, join(root, '.demo'));
    expect(seed(root).status).toBe(2);
    expect(readFileSync(join(personalDir, 'demo.sqlite'), 'utf8')).toBe('personal-bytes');
  });

  it('5: on a fresh root the seed creates .demo/ and demo mode starts', async () => {
    const root = makeRoot();
    expect(existsSync(join(root, '.demo'))).toBe(false);
    expect(seed(root).status).toBe(0);
    const demo = await start(baseEnv(root), ['--demo']);
    expect((await fetch(`${demo.url}/api/resumes/r-overflow`)).status).toBe(200);
    await demo.stop();
  }, 30_000);
});

describe('server command, personal mode', () => {
  it('2: DB_PATH inside .demo is refused, including via ../ and before .demo exists', () => {
    const root = makeRoot();
    refusesToStart(root, { DB_PATH: join(root, '.demo', 'demo.sqlite') });
    expect(seed(root).status).toBe(0);
    refusesToStart(root, { DB_PATH: join(root, '.demo', '..', '.demo', 'demo.sqlite') });
  });

  it('2b: an alternate-case spelling of .demo is refused (case-insensitive filesystems)', () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    refusesToStart(root, { DB_PATH: join(root, '.DEMO', 'demo.sqlite') });
  });

  it('6: outside symlink aliasing the demo DB, a dangling symlink, and a hard link are all refused', () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const demoFile = join(root, '.demo', 'demo.sqlite');
    const dir = tempDir();
    symlinkSync(demoFile, join(dir, 'alias.sqlite'));
    refusesToStart(root, { DB_PATH: join(dir, 'alias.sqlite') });
    symlinkSync(join(dir, 'nowhere.sqlite'), join(dir, 'dangling.sqlite'));
    refusesToStart(root, { DB_PATH: join(dir, 'dangling.sqlite') });
    linkSync(demoFile, join(dir, 'hard.sqlite'));
    const run = refusesToStart(root, { DB_PATH: join(dir, 'hard.sqlite') });
    expect(run.stderr).toMatch(/same file as the demo database/);
  });

  it('7: a fresh root without DB_PATH starts and creates .data/library.sqlite; a symlinked .data is refused', async () => {
    const root = makeRoot();
    const server = await start(baseEnv(root));
    expect((await fetch(`${server.url}/api/profile`)).status).toBe(200);
    await server.stop();
    expect(existsSync(join(root, '.data', 'library.sqlite'))).toBe(true);
    const other = makeRoot();
    symlinkSync(tempDir(), join(other, '.data'));
    refusesToStart(other, {});
  }, 30_000);

  it('starts from a checkout path containing spaces (no RB_ROOT; root derived from the module URL)', async () => {
    const parent = tempDir('rb with space ');
    const checkout = join(parent, 'resume builder');
    mkdirSync(checkout);
    cpSync(join(REPO, 'src'), join(checkout, 'src'), { recursive: true });
    cpSync(join(REPO, 'package.json'), join(checkout, 'package.json'));
    symlinkSync(join(REPO, 'node_modules'), join(checkout, 'node_modules'));
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PORT: '0' };
    delete env.RB_ROOT;
    delete env.DB_PATH;
    const server = await start(env, [], join(checkout, 'src/server/main.ts'));
    await server.stop();
    expect(existsSync(join(checkout, '.data', 'library.sqlite'))).toBe(true);
  }, 30_000);
});

describe('demo lock (review round 2)', () => {
  function seedAsync(root: string, args: string[] = []) {
    return new Promise<{ code: number | null; err: string }>((resolve) => {
      const child = spawn(process.execPath, [SEED, ...args], { env: baseEnv(root) });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.once('exit', (code) => resolve({ code, err }));
    });
  }

  it('a reset is refused while a demo server runs; the server keeps serving; after it stops the reset works', async () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const demoFile = join(root, '.demo', 'demo.sqlite');
    const before = bytes(demoFile);
    const server = await start(baseEnv(root), ['--demo']);
    try {
      const run = seed(root);
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/demo database is in use by another demo server or seed/);
      expect(bytes(demoFile)).toBe(before);
      expect((await fetch(`${server.url}/api/resumes/r-security`)).status).toBe(200);
    } finally {
      await server.stop();
    }
    expect(seed(root).status).toBe(0);
  }, 60_000);

  it('a second demo server cannot start while one holds the lock', async () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const server = await start(baseEnv(root), ['--demo']);
    try {
      refusesToStart(root, {}, ['--demo']);
    } finally {
      await server.stop();
    }
  }, 30_000);

  it('exactly one of two concurrent first seeds (without --reset) succeeds', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = makeRoot();
      const runs = await Promise.all([seedAsync(root), seedAsync(root)]);
      expect(runs.map((r) => r.code).sort(), runs.map((r) => r.err).join(' | ')).toEqual([0, 2]);
    }
  }, 60_000);

  it('a demo server killed with SIGKILL leaves no lock behind (the OS releases it)', async () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const child = spawn(process.execPath, [MAIN, '--demo'], { env: baseEnv(root) });
    await new Promise<void>((resolve) => child.stdout.on('data', (d) => String(d).includes('listening') && resolve()));
    expect(seed(root).status).toBe(2);
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGKILL');
    });
    expect(seed(root).status).toBe(0);
  }, 60_000);

  it('a symlinked lock file is refused', () => {
    const root = makeRoot();
    mkdirSync(join(root, '.demo'));
    const outside = join(tempDir(), 'x.sqlite');
    writeFileSync(outside, '');
    symlinkSync(outside, join(root, '.demo', 'lock.sqlite'));
    expect(seed(root).status).toBe(2);
  });

  it('two concurrent --reset seeds: exactly one publishes, the other refuses', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const root = makeRoot();
      expect(seed(root).status).toBe(0);
      const runs = await Promise.all([seedAsync(root, ['--reset']), seedAsync(root, ['--reset'])]);
      expect(runs.map((r) => r.code).sort(), runs.map((r) => r.err).join(' | ')).toEqual([0, 2]);
      const loser = runs.find((r) => r.code === 2)!;
      expect(loser.err).toMatch(/published while this one waited|in use by another demo server or seed/);
    }
  }, 120_000);
});

describe('personal mode tolerates a broken demo location (review round 2)', () => {
  it('a dangling .demo symlink does not block personal mode; demo mode refuses it', async () => {
    const root = makeRoot();
    symlinkSync(join(tempDir(), 'gone'), join(root, '.demo'));
    const server = await start(baseEnv(root));
    await server.stop();
    refusesToStart(root, {}, ['--demo']);
  }, 30_000);

  it('a dangling .demo/demo.sqlite does not block an existing personal database', async () => {
    const root = makeRoot();
    const first = await start(baseEnv(root));
    await first.stop();
    mkdirSync(join(root, '.demo'));
    symlinkSync(join(tempDir(), 'gone.sqlite'), join(root, '.demo', 'demo.sqlite'));
    const again = await start(baseEnv(root));
    await again.stop();
  }, 30_000);
});

describe('interrupted writes: refuse and touch nothing (owner decision)', () => {
  /** Crash a writer mid-transaction after SQLite has spilled pages into the file: a genuine hot journal. */
  function crashWriter(file: string) {
    spawnSync(process.execPath, [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);
       d.exec('PRAGMA cache_size = 2');d.exec('BEGIN');d.exec('CREATE TABLE junk(x)');
       d.exec('WITH RECURSIVE c(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM c WHERE i<3000) INSERT INTO junk SELECT randomblob(800) FROM c');
       process.kill(process.pid,'SIGKILL');`,
      file,
    ]);
  }

  it('a genuine hot journal: reset refused with instructions, bytes untouched; after `demo` recovers it, reset works', async () => {
    const root = makeRoot();
    expect(seed(root).status).toBe(0);
    const demoFile = join(root, '.demo', 'demo.sqlite');
    const original = bytes(demoFile);
    crashWriter(demoFile);
    expect(existsSync(`${demoFile}-journal`)).toBe(true);
    const crashed = bytes(demoFile);
    expect(crashed).not.toBe(original); // pages really were written: the journal is hot
    const run = seed(root);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/recovery files left by an interrupted write .* run `npm run demo` once/);
    expect(bytes(demoFile)).toBe(crashed);
    expect(existsSync(`${demoFile}-journal`)).toBe(true);
    const demo = await start(baseEnv(root), ['--demo']); // SQLite rolls the journal back on open
    await demo.stop();
    expect(existsSync(`${demoFile}-journal`)).toBe(false);
    expect(bytes(demoFile)).toBe(original);
    expect(seed(root).status).toBe(0);
  }, 60_000);

  it('orphaned sidecars with no database (including a dangling symlink) refuse a first seed; nothing is published', () => {
    for (const make of [
      (f: string) => writeFileSync(`${f}-wal`, 'orphan'),
      (f: string) => symlinkSync(join(tempDir(), 'gone'), `${f}-shm`),
    ]) {
      const root = makeRoot();
      mkdirSync(join(root, '.demo'));
      const demoFile = join(root, '.demo', 'demo.sqlite');
      make(demoFile);
      const run = seed(root);
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/recovery files/);
      expect(existsSync(demoFile)).toBe(false);
    }
  });
});
