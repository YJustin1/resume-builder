// Test harness: isolated in-memory databases seeded from fixtures, a full row
// dump for "nothing changed" assertions, and a driver that maps fixture step
// actions onto the service layer (Phase 1: no HTTP, no assembly).

import { readFileSync } from 'node:fs';
import { ServiceError } from '../../src/core/errors.ts';
import type { DeletableType } from '../../src/core/impact.ts';
import { openDatabase, type Db } from '../../src/db/database.ts';
import { Library } from '../../src/db/library.ts';
import { TABLES } from '../../src/db/schema.ts';
import { loadFixture } from '../../src/db/seed.ts';

export const FIXTURES = new URL('../../fixtures/', import.meta.url);

export function readFixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as T;
}

/** A fresh, isolated database (in memory by default), optionally seeded from a fixture input. */
export function freshLibrary(input?: string, path = ':memory:'): Library {
  const lib = new Library(openDatabase(path));
  if (input) loadFixture(lib, readFixture(input));
  return lib;
}

/** Every row of every table, in a deterministic order. */
export function dumpRows(db: Db): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all().map((r) => JSON.stringify({ ...r }));
    out[table] = rows.sort().map((r) => JSON.parse(r) as unknown);
  }
  return out;
}

export interface StepResult {
  status: number;
  code?: string;
  affectedResumes?: unknown;
  body?: unknown;
  /** The action needs a later phase (assembly, HTTP or rendering). */
  deferred?: string;
}

const DELETE_TYPES: Record<string, DeletableType> = {
  variant: 'variant',
  accomplishment: 'accomplishment',
  experience: 'experience',
  project: 'project',
  skill: 'skill',
};

const DEFERRED: Record<string, string> = {
  impact: 'Phase 2 (edit impact is defined on assembled JSON)',
  exportJson: 'Phase 2 (assembly)',
  exportPdf: 'Phase 3 (rendering)',
  directSqlUpdate: 'Phase 3 (runtime content policy on rendered HTML)',
};

function run(lib: Library, step: any): StepResult {
  switch (step.action) {
    case 'saveResume':
      return { status: 200, body: lib.saveResume(step.id, step.payload) };
    case 'createResume':
      return { status: 201, body: lib.createResume({ name: step.name }, { id: step.id }) };
    case 'delete': {
      const type = DELETE_TYPES[step.type];
      if (!type) throw new Error(`unknown delete type ${step.type}`);
      lib.deleteRecord(type, step.id);
      return { status: 204 };
    }
    case 'editVariant':
      return { status: 200, body: lib.patchVariant(step.id, { text: step.text }) };
    case 'editExperience':
      return { status: 200, body: lib.patchEntry('work', step.id, step.patch) };
    case 'editAccomplishment':
      return { status: 200, body: lib.patchAccomplishment(step.id, step.patch) };
    case 'editSkill':
      return { status: 200, body: lib.patchSkill(step.id, step.patch) };
    case 'editProfile':
    case 'patchProfile':
      return { status: 200, body: lib.patchProfile(step.patch) };
    case 'putProfile': {
      const { created, profile } = lib.putProfile(step.body);
      return { status: created ? 201 : 200, body: profile };
    }
    case 'getProfile':
      return { status: 200, body: { profile: lib.getProfile() } };
    case 'createExperience':
      return { status: 201, body: lib.createEntry('work', step.body, { id: step.id }) };
    default:
      throw new Error(`unknown fixture action ${step.action}`);
  }
}

/** Run one fixture step, converting ServiceErrors into status/code results. */
export function runStep(lib: Library, step: any): StepResult {
  const deferred = DEFERRED[step.action];
  if (deferred) return { status: -1, deferred };
  try {
    return run(lib, step);
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    const result: StepResult = { status: error.status, code: error.code };
    if (error.affectedResumes) result.affectedResumes = error.affectedResumes;
    return result;
  }
}

/** Whether a record exists in any library table. */
export function recordExists(lib: Library, id: string): boolean {
  return ['entries', 'accomplishments', 'variants', 'skills', 'resumes'].some((t) =>
    lib.db.prepare(`SELECT 1 FROM ${t} WHERE id = ?`).get(id),
  );
}
