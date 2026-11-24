// One lock for the demo database (SPEC §9 "Demo lock"): held by a running demo
// server for its lifetime and by `demo:seed` for its whole check-build-publish
// sequence. It is created atomically (O_EXCL), so two seeds can never both
// publish, and a reset can never replace a database a live server has open.
// A lock left by a dead process (its PID no longer exists) is reclaimed.

import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { PathError } from './paths.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function tryCreate(lock: string, owner: string): boolean {
  try {
    const fd = openSync(lock, 'wx', 0o600); // fails if the path exists, including as a symlink
    writeSync(fd, `${process.pid} ${owner}\n`);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Acquire `<demoDir>/lock` or throw PathError naming the holder. Returns a release function. */
export function acquireDemoLock(demoDir: string, owner: 'server' | 'seed'): () => void {
  const lock = join(demoDir, 'lock');
  if (!tryCreate(lock, owner)) {
    let holder = '';
    try {
      holder = readFileSync(lock, 'utf8').trim();
    } catch {
      /* unreadable: treat as held */
    }
    const pid = Number(holder.split(' ')[0]);
    if (Number.isInteger(pid) && pid > 0 && !alive(pid)) {
      rmSync(lock, { force: true }); // stale lock from a process that no longer exists
      if (tryCreate(lock, owner)) return release(lock);
    }
    throw new PathError(`the demo database is in use (${holder || 'lock held'}); stop the demo server or wait for the seed to finish`);
  }
  return release(lock);
}

function release(lock: string): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    rmSync(lock, { force: true });
  };
}
