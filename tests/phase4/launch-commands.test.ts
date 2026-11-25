// SPEC §9 through the supported launch commands (Codex Phase 4 review,
// findings 5, 9, 12 and round-2 finding 2): `npm run dev` (src/server/dev.ts:
// Vite + API) and `npm run demo` (vite build, then the API serving the UI),
// run from a temporary project copy against isolated roots (RB_ROOT) on free
// ports. Refusals exit 2 and leave nothing listening; successful runs serve
// both the UI and the API.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { UI_CSP } from '../../src/server/app.ts';
import { LIVE_REPO, projectCopy } from '../support/project-copy.ts';

const copy = projectCopy();
afterAll(() => copy.remove());
const REPO = copy.dir;
const DEV = join(REPO, 'src/server/dev.ts');
const SEED = join(REPO, 'src/server/demo-seed.ts');

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rb-launch-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'fixtures'));
  for (const f of ['primary.input.json', 'overflow.input.json', 'sections.input.json']) copyFileSync(join(LIVE_REPO, 'fixtures', f), join(root, 'fixtures', f));
  return root;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function listening(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

function env(root: string, extra: Record<string, string>) {
  const e: Record<string, string> = { ...(process.env as Record<string, string>), RB_ROOT: root, VITE_CACHE_DIR: join(root, '.vite-cache'), ...extra };
  if (!('DB_PATH' in extra)) delete e.DB_PATH;
  return e;
}

interface Run {
  child: ChildProcess;
  output: () => string;
  exit: Promise<number | null>;
}

function launch(cmd: string, args: string[], e: Record<string, string>): Run {
  // Own process group, so a stop reaches npm's children too.
  const child = spawn(cmd, args, { env: e, cwd: REPO, detached: true });
  let out = '';
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const exit = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  cleanup.push(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
  return { child, output: () => out, exit };
}

async function waitFor(run: Run, pattern: RegExp, ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const m = pattern.exec(run.output());
    if (m) return m;
    if (run.child.exitCode !== null) throw new Error(`exited ${run.child.exitCode} before ${pattern}:\n${run.output()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${pattern}:\n${run.output()}`);
}

const devRun = async (root: string, extra: Record<string, string> = {}) => {
  const [uiPort, apiPort] = [await freePort(), await freePort()];
  return { uiPort, apiPort, run: launch(process.execPath, [DEV], env(root, { UI_PORT: String(uiPort), API_PORT: String(apiPort), ...extra })) };
};

async function expectRefusal(root: string, extra: Record<string, string>) {
  const { uiPort, apiPort, run } = await devRun(root, extra);
  expect(await run.exit, run.output()).toBe(2);
  expect(run.output()).toMatch(/Refusing to start: /);
  expect(await listening(uiPort)).toBe(false); // Vite closed
  expect(await listening(apiPort)).toBe(false);
}

describe('npm run dev (src/server/dev.ts)', () => {
  it('7: a fresh root starts, creates .data/library.sqlite, serves the UI and proxies the API; SIGTERM stops both', async () => {
    const root = makeRoot();
    const { uiPort, apiPort, run } = await devRun(root);
    await waitFor(run, new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${uiPort}/`));
    // The UI URL is announced only after the API has bound (review round 3, 13).
    expect(run.output().indexOf(`listening on http://127.0.0.1:${apiPort}`)).toBeGreaterThan(-1);
    expect(run.output().indexOf(`listening on http://127.0.0.1:${apiPort}`)).toBeLessThan(run.output().search(/Local:\s+http/));
    expect(existsSync(join(root, '.data', 'library.sqlite'))).toBe(true);
    expect(await (await fetch(`http://127.0.0.1:${uiPort}/`)).text()).toContain('id="root"');
    const profile = await fetch(`http://127.0.0.1:${uiPort}/api/profile`);
    expect([profile.status, await profile.json()]).toEqual([200, { profile: null }]);
    process.kill(run.child.pid!, 'SIGTERM');
    expect(await run.exit).toBe(0);
    expect(await listening(uiPort)).toBe(false);
    expect(await listening(apiPort)).toBe(false);
  }, 90_000);

  it('2: DB_PATH inside .demo is refused with exit 2 and nothing is left listening, also spelled via ../', async () => {
    const root = makeRoot();
    await expectRefusal(root, { DB_PATH: join(root, '.demo', 'demo.sqlite') });
    await expectRefusal(root, { DB_PATH: `${root}/.demo/../.demo/demo.sqlite` });
  }, 90_000);

  it('6b: a dangling DB_PATH symlink is refused', async () => {
    const root = makeRoot();
    const link = join(root, 'dangling.sqlite');
    symlinkSync(join(root, 'missing', 'nothing.sqlite'), link);
    await expectRefusal(root, { DB_PATH: link });
  }, 90_000);

  it('a database inside a directory the dev server serves is refused, whatever its name (review round 2, finding 2)', async () => {
    const root = makeRoot();
    await expectRefusal(root, { DB_PATH: join(REPO, 'src', 'client', 'personal.db') });
    await expectRefusal(root, { DB_PATH: join(REPO, 'node_modules', 'personal.db') });
    await expectRefusal(root, { DB_PATH: join(REPO, 'src', 'client', '..private.db') }); // a child whose name starts with ".."
    expect(existsSync(join(REPO, 'src', 'client', 'personal.db'))).toBe(false);
    expect(existsSync(join(REPO, 'src', 'client', '..private.db'))).toBe(false);
  }, 90_000);

  it('a database in the build output (emptied by every build) is refused by dev and by the API (verification, 1)', async () => {
    const root = makeRoot();
    mkdirSync(join(REPO, 'dist', 'client'), { recursive: true }); // as after a build
    const inBuild = join(REPO, 'dist', 'client', 'personal.sqlite');
    await expectRefusal(root, { DB_PATH: inBuild });
    const api = spawnSync(process.execPath, [join(REPO, 'src/server/main.ts')], { env: env(root, { DB_PATH: inBuild, PORT: '0' }), encoding: 'utf8', timeout: 30_000 });
    expect(api.status, api.stdout + api.stderr).toBe(2);
    expect(api.stderr).toMatch(/inside the build output/);
    expect(existsSync(inBuild)).toBe(false);
  }, 90_000);

  it('a symlink inside the client directory never serves the database it points to (review round 3, 2)', async () => {
    const root = makeRoot();
    const db = join(root, 'personal.sqlite');
    const { uiPort, apiPort, run } = await devRun(root, { DB_PATH: db });
    await waitFor(run, new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${uiPort}/`));
    expect((await fetch(`http://127.0.0.1:${uiPort}/api/profile`)).status).toBe(200); // the API created the database
    const links = { 'innocent.txt': db, 'data-dir': join(root, '.data') };
    for (const [name, target] of Object.entries(links)) {
      symlinkSync(target, join(REPO, 'src', 'client', name));
      cleanup.push(() => rmSync(join(REPO, 'src', 'client', name), { force: true }));
    }
    // Verification round, finding 2: a hard link with an allowed name, and a
    // directory whose index.html (served for /dir/) links to the database.
    linkSync(db, join(REPO, 'src', 'client', 'hard.txt'));
    mkdirSync(join(REPO, 'src', 'client', 'dirx'));
    symlinkSync(db, join(REPO, 'src', 'client', 'dirx', 'index.html'));
    // Round 2: Vite's other fallbacks, an extensionless index and a .html extension.
    mkdirSync(join(REPO, 'src', 'client', 'diry'));
    symlinkSync(db, join(REPO, 'src', 'client', 'diry', 'index'));
    symlinkSync(db, join(REPO, 'src', 'client', 'page.html'));
    cleanup.push(() => {
      for (const p of ['hard.txt', 'dirx', 'diry', 'page.html']) rmSync(join(REPO, 'src', 'client', p), { recursive: true, force: true });
    });
    for (const path of ['/innocent.txt', `/@fs${join(REPO, 'src', 'client', 'innocent.txt')}`, '/innocent.txt?import', '/data-dir/library.sqlite', '/hard.txt', '/dirx/', '/dirx', '/diry/', '/diry', '/page']) {
      const res = await fetch(`http://127.0.0.1:${uiPort}${path}`);
      const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
      expect(body.startsWith('SQLite format 3'), path).toBe(false);
      if (!['/data-dir/library.sqlite', '/dirx', '/diry'].includes(path)) expect(res.status, path).toBe(403);
    }
    expect(await listening(apiPort)).toBe(true);
  }, 90_000);

  it('another server already on the API port never answers through the proxy; the launcher exits nonzero (review, 12)', async () => {
    const root = makeRoot();
    const { createServer: createHttp } = await import('node:http');
    const impostor = createHttp((_req, res) => res.end('IMPOSTOR'));
    await new Promise<void>((r) => impostor.listen(0, '127.0.0.1', r));
    cleanup.push(() => impostor.close());
    const apiPort = (impostor.address() as { port: number }).port;
    const uiPort = await freePort();
    const run = launch(process.execPath, [DEV], env(root, { UI_PORT: String(uiPort), API_PORT: String(apiPort) }));
    const seen: string[] = [];
    while (run.child.exitCode === null) {
      try {
        const res = await fetch(`http://127.0.0.1:${uiPort}/api/profile`, { signal: AbortSignal.timeout(1000) });
        seen.push(`${res.status} ${await res.text()}`);
      } catch {
        // not listening yet, or already closed
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await run.exit, run.output()).not.toBe(0);
    expect(seen.filter((s) => s.includes('IMPOSTOR'))).toEqual([]);
    expect(seen.length, 'the UI port answered at least once while the API was starting').toBeGreaterThan(0);
    expect(seen.every((s) => s.startsWith('503 '))).toBe(true);
    expect(await listening(uiPort)).toBe(false);
  }, 90_000);

  it('6: a DB_PATH symlink outside .demo pointing at the demo database is refused', async () => {
    const root = makeRoot();
    expect(spawnSync(process.execPath, [SEED, '--reset'], { env: env(root, {}), encoding: 'utf8' }).status).toBe(0);
    const link = join(root, 'alias.sqlite');
    symlinkSync(join(root, '.demo', 'demo.sqlite'), link);
    await expectRefusal(root, { DB_PATH: link });
  }, 90_000);

  it('7b: a symlinked .data directory is refused', async () => {
    const root = makeRoot();
    const elsewhere = mkdtempSync(join(tmpdir(), 'rb-elsewhere-'));
    cleanup.push(() => rmSync(elsewhere, { recursive: true, force: true }));
    symlinkSync(elsewhere, join(root, '.data'));
    await expectRefusal(root, {});
  }, 90_000);

  it('an occupied UI port: exits nonzero without ever starting the API or opening the database', async () => {
    const root = makeRoot();
    const blocker: Server = createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    cleanup.push(() => blocker.close());
    const uiPort = (blocker.address() as { port: number }).port;
    const apiPort = await freePort();
    const run = launch(process.execPath, [DEV], env(root, { UI_PORT: String(uiPort), API_PORT: String(apiPort) }));
    expect(await run.exit, run.output()).toBe(1);
    expect(run.output()).toMatch(/UI dev server could not start/);
    expect(await listening(apiPort)).toBe(false);
    expect(existsSync(join(root, '.data', 'library.sqlite'))).toBe(false);
  }, 90_000);
});

describe('npm run demo (vite build, then the API serves the UI)', () => {
  it('refuses to build into a symlinked dist/client; a personal database behind it stays byte-identical (verification round 2, 1)', async () => {
    const root = makeRoot();
    mkdirSync(join(root, '.data'));
    const personal = join(root, '.data', 'library.sqlite');
    writeFileSync(personal, 'SQLite format 3\u0000 personal data');
    const before = readFileSync(personal);
    rmSync(join(REPO, 'dist'), { recursive: true, force: true });
    mkdirSync(join(REPO, 'dist'));
    symlinkSync(join(root, '.data'), join(REPO, 'dist', 'client'));
    cleanup.push(() => rmSync(join(REPO, 'dist'), { recursive: true, force: true }));
    const run = launch('npm', ['run', 'demo'], env(root, { PORT: String(await freePort()) }));
    expect(await run.exit, run.output()).not.toBe(0);
    expect(run.output()).toMatch(/Refusing to build: .*dist\/client must be a real directory/);
    expect(readFileSync(personal)).toEqual(before);
    expect(readdirSync(join(root, '.data'))).toEqual(['library.sqlite']);
  }, 150_000);

  it('5: after demo:seed on a fresh root, serves the UI with its CSP and the API on one port', async () => {
    const root = makeRoot();
    expect(spawnSync(process.execPath, [SEED, '--reset'], { env: env(root, {}), encoding: 'utf8' }).status).toBe(0);
    const port = await freePort();
    const run = launch('npm', ['run', 'demo'], env(root, { PORT: String(port) }));
    await waitFor(run, new RegExp(`listening on http://127\\.0\\.0\\.1:${port} \\(demo db: .*; UI at /\\)`), 120_000);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(page.headers.get('content-security-policy')).toBe(UI_CSP);
    expect(await page.text()).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js">/);
    expect(await (await fetch(`http://127.0.0.1:${port}/api/resumes`)).json()).toEqual([
      { id: 'r-engineering', name: 'Engineering' },
      { id: 'r-overflow', name: 'Overflow' },
      { id: 'r-security', name: 'Security' },
    ]);
    process.kill(-run.child.pid!, 'SIGTERM');
    await run.exit;
    expect(await listening(port)).toBe(false);
  }, 150_000);
});
