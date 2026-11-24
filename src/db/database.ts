// Connection handling: foreign keys on every connection, schema migration by
// user_version, and a transaction helper that rolls back on any error.

import { DatabaseSync } from 'node:sqlite';
import { DDL, SCHEMA_VERSION } from './schema.ts';

export type Db = DatabaseSync;

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (row.user_version === 0) {
    transaction(db, () => {
      db.exec(DDL);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  } else if (row.user_version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`Unsupported database schema version ${row.user_version} (expected ${SCHEMA_VERSION})`);
  }
  const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  if (fk.foreign_keys !== 1) throw new Error('SQLite foreign keys could not be enabled');
  return db;
}

let savepoints = 0;

/**
 * Run `fn` in one IMMEDIATE transaction (a write lock is taken up front, so a
 * dependency check and the write it guards see the same state). Any error
 * rolls everything back and is rethrown. Nested calls use savepoints, so an
 * outer transaction (e.g. the seed loader) stays all-or-nothing.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) {
    const name = `sp_${++savepoints}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw error;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
