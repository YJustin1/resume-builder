// One lock for the demo database (SPEC §9 "Demo lock"): held by a running demo
// server for its lifetime and by `demo:seed` for its whole check-build-publish
// sequence.
//
// The lock is an exclusive SQLite transaction on `.demo/lock.sqlite`. SQLite
// uses OS file locks, which the kernel releases when the holding process
// exits or dies, so there is no stale state to reclaim and no window in which
// one process can remove another's lock.

import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PathError } from './paths.ts';

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
  // Two processes opening a fresh lock file at the same moment can both hold
  // SHARED and both fail to upgrade (each sees the other as busy). Retry a few
  // times with random backoff so one of them wins; a lock that is genuinely
  // held (a running demo server) still refuses after about a second.
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
      if (!/locked|busy/i.test(String(error))) throw error;
      if (Date.now() > deadline) {
        throw new PathError(`the demo database is in use by another demo server or seed (requested by ${owner}); stop it or wait for it to finish`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 + Math.floor(Math.random() * 40));
    }
  }
  let released = false;
  const held = db;
  return () => {
    if (released) return;
    released = true;
    try {
      held.exec('ROLLBACK');
    } finally {
      held.close();
    }
  };
}
