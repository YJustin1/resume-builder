// Phase 1 gate, service level: restricted deletion (SPEC FR-03).
// T04 (deletion.expected.json), T06, T07 and T20 (deletion-more.expected.json), T15.

import { describe, expect, it } from 'vitest';
import { dumpRows, freshLibrary, readFixture, recordExists, runStep } from '../support/harness.ts';

const SELECTION_TABLES = ['resumes', 'resume_entries', 'resume_bullets', 'resume_skills'] as const;

function selections(rows: Record<string, unknown[]>) {
  return Object.fromEntries(SELECTION_TABLES.map((t) => [t, rows[t]]));
}

describe('T04 referenced variant and accomplishment deletes are rejected without changes', () => {
  const oracle = readFixture('deletion.expected.json');
  for (const attempt of oracle.attempts) {
    it(`${attempt.type} ${attempt.id}`, () => {
      const lib = freshLibrary('primary.input.json');
      const before = dumpRows(lib.db);
      expect(lib.deleteImpact(attempt.type, attempt.id)).toEqual({
        affectedResumes: attempt.affectedResumes,
        blocked: true,
      });
      const result = runStep(lib, { action: 'delete', type: attempt.type, id: attempt.id });
      expect(result).toEqual({ status: attempt.status, code: attempt.code, affectedResumes: attempt.affectedResumes });
      expect(dumpRows(lib.db)).toEqual(before);
    });
  }
});

describe('T07/T20 entry, project, accomplishment, variant and skill deletes', () => {
  const oracle = readFixture('deletion-more.expected.json');
  for (const attempt of oracle.attempts) {
    it(`${attempt.case} ${attempt.type} ${attempt.id} -> ${attempt.status}`, () => {
      const lib = freshLibrary(attempt.input);
      const before = dumpRows(lib.db);
      const result = runStep(lib, { action: 'delete', type: attempt.type, id: attempt.id });
      expect(result.status).toBe(attempt.status);
      if (attempt.status >= 400) {
        expect(result.code).toBe(attempt.code);
        expect(result.affectedResumes).toEqual(attempt.affectedResumes);
        expect(dumpRows(lib.db)).toEqual(before);
      } else {
        // Allowed deletes touch only unreferenced records: every saved
        // configuration row is unchanged (the export check follows in Phase 2).
        expect(selections(dumpRows(lib.db))).toEqual(selections(before));
      }
      for (const id of attempt.recordsAbsent ?? []) expect(recordExists(lib, id)).toBe(false);
      for (const id of attempt.recordsStillPresent ?? []) expect(recordExists(lib, id)).toBe(true);
    });
  }

  it('T07 continued: deleting r-security removes only its configuration', () => {
    const lib = freshLibrary('primary.input.json');
    const before = dumpRows(lib.db);
    expect(runStep(lib, { action: 'delete', type: 'experience', id: 'e1' }).status).toBe(409);
    lib.deleteResume('r-security');
    const after = dumpRows(lib.db);
    for (const table of ['profile', 'entries', 'accomplishments', 'variants', 'skills'] as const) {
      expect(after[table]).toEqual(before[table]);
    }
    expect(() => lib.getResume('r-security')).toThrow(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
    // Engineering's stored configuration is exactly what the fixture saved.
    expect(lib.getResume('r-engineering')).toEqual({
      id: 'r-engineering',
      name: 'Engineering',
      experiences: [
        { experienceId: 'e2', bullets: [{ accomplishmentId: 'a3', variantId: 'v32' }] },
        { experienceId: 'e1', bullets: [{ accomplishmentId: 'a1', variantId: 'v12' }] },
      ],
      projects: [],
      skills: [],
    });
  });
});

describe('T06 unreferenced records delete with their children', () => {
  it('v41, then a4, then e3 (with a5 and v51)', () => {
    const lib = freshLibrary('primary.input.json');
    const before = selections(dumpRows(lib.db));
    for (const [type, id] of [
      ['variant', 'v41'],
      ['accomplishment', 'a4'],
      ['experience', 'e3'],
    ] as const) {
      expect(runStep(lib, { action: 'delete', type, id })).toEqual({ status: 204 });
    }
    for (const id of ['v41', 'a4', 'e3', 'a5', 'v51']) expect(recordExists(lib, id)).toBe(false);
    for (const id of ['e1', 'e2', 'a1', 'a2', 'a3', 'v11', 'v12', 'v21', 'v22', 'v31', 'v32']) {
      expect(recordExists(lib, id)).toBe(true);
    }
    expect(selections(dumpRows(lib.db))).toEqual(before);
  });

  it('a missing or wrong-kind record is NOT_FOUND, not RECORD_IN_USE', () => {
    const lib = freshLibrary('sections.input.json');
    expect(runStep(lib, { action: 'delete', type: 'variant', id: 'nope' })).toMatchObject({ status: 404 });
    // p1 exists, but as a project: deleting it as an experience addresses nothing.
    expect(runStep(lib, { action: 'delete', type: 'experience', id: 'p1' })).toMatchObject({ status: 404 });
  });
});

describe('T15 last unreferenced variant', () => {
  it('deletes, leaves a draft accomplishment, and the missing variant cannot be selected', () => {
    const lib = freshLibrary('primary.input.json');
    expect(runStep(lib, { action: 'delete', type: 'variant', id: 'v41' })).toEqual({ status: 204 });
    expect(recordExists(lib, 'a4')).toBe(true);
    expect([...lib.snapshot().variants.values()].filter((v) => v.accomplishmentId === 'a4')).toEqual([]);
    const before = dumpRows(lib.db);
    const result = runStep(lib, {
      action: 'saveResume',
      id: 'r-security',
      payload: {
        name: 'Security',
        experiences: [{ experienceId: 'e2', bullets: [{ accomplishmentId: 'a4', variantId: 'v41' }] }],
      },
    });
    expect(result).toEqual({ status: 400, code: 'INVALID_REFERENCE' });
    expect(dumpRows(lib.db)).toEqual(before);
  });
});
