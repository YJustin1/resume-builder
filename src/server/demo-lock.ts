// One lock for the demo database (SPEC §9 "Demo lock"): held by a running demo
// server for its lifetime and by `demo:seed` for its whole check-build-publish
// sequence.
//
// The lock is an exclusive SQLite transaction on `.demo/lock.sqlite`. SQLite
// uses OS file locks, which the kernel releases when the holding process exits
// or dies, so there is no stale state to reclaim.
//
// Contention with a live holder is always a refusal, never a wait: before
// trying, the caller reads the lock's epoch (a counter every holder
// increments). That read is refused while anyone holds the lock. If the epoch
// has changed by the time the caller acquires the lock, someone held it in
// between, so the caller refuses too. The short retry loop below only
// resolves two processes starting at the same instant (both read the same
// epoch; SQLite's lock-upgrade collision makes both busy; exactly one then
// wins and the other sees the changed epoch).

import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PathError } from './paths.ts';

const busy = (error: unknown) => /locked|busy/i.test(String(error));
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const inUse = (owner: string) =>
  new PathError(
    `the demo database is in use by another demo server or seed (requested by ${owner}); stop it or wait for it to finish`,
  );

function epochOf(db: DatabaseSync): number {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'epoch'").get();
  if (!table) return 0;
  const row = db.prepare('SELECT n FROM epoch').get() as { n: number } | undefined;
  return row ? Number(row.n) : 0;
}

/**
 * Test-only pause points for the process-level tests (never set in normal
 * use): when RB_TEST_PAUSE_<stage> names a file path, write it and wait until
 * the test deletes it.
 */
export function testPause(stage: string): void {
  const marker = process.env[`RB_TEST_PAUSE_${stage}`];
  if (!marker) return;
  writeFileSync(marker, String(process.pid));
  const until = Date.now() + 20_000;
  while (existsSync(marker)) {
    if (Date.now() > until) throw new Error(`test pause ${stage} timed out`);
    sleep(20);
  }
}

/** Acquire the demo lock or throw PathError. Returns an idempotent release function. */
export function acquireDemoLock(demoDir: string, owner: 'server' | 'seed'): () => void {
  const path = join(demoDir, 'lock.sqlite');
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile() || st.nlink !== 1) {
      throw new PathError(`${path} must be a regular file (not a symlink or hard link)`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // 1. Read the epoch; a live holder makes this read busy, which is a refusal.
  let seen: number;
  const probe = new DatabaseSync(path, { timeout: 0 });
  try {
    seen = epochOf(probe);
  } catch (error) {
    if (busy(error)) throw inUse(owner);
    throw error;
  } finally {
    probe.close();
  }
  testPause('BEFORE_LOCK');

  // 2. Acquire, resolving only the simultaneous-start collision.
  const deadline = Date.now() + 1000;
  let db: DatabaseSync;
  for (;;) {
    db = new DatabaseSync(path, { timeout: 0 });
    try {
      db.exec('PRAGMA locking_mode = EXCLUSIVE');
      db.exec('BEGIN EXCLUSIVE');
      break;
    } catch (error) {
      db.close();
      if (!busy(error)) throw error;
      if (Date.now() > deadline) throw inUse(owner);
      sleep(10 + Math.floor(Math.random() * 40));
    }
  }

  // 3. Anyone who held the lock since step 1 changed the epoch: refuse.
  const held = db;
  try {
    const now = epochOf(held);
    if (now !== seen) {
      throw new PathError(
        `another demo server or seed held the demo lock while this ${owner} was starting; nothing was changed`,
      );
    }
    held.exec('CREATE TABLE IF NOT EXISTS epoch (n INTEGER NOT NULL)');
    held.exec('DELETE FROM epoch');
    held.prepare('INSERT INTO epoch (n) VALUES (?)').run(now + 1);
  } catch (error) {
    held.exec('ROLLBACK');
    held.close();
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      held.exec('COMMIT'); // persists the new epoch
    } finally {
      held.close();
    }
  };
}
