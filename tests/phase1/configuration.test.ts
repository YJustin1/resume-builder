// Phase 1 gate, service level: configuration validation and storage
// (SPEC §4 invariants, FR-02). T08 (invalid-configs.json) plus the direct-SQL
// constraint backstop, contiguous ordering, and configuration round trips.

import { describe, expect, it } from 'vitest';
import { dumpRows, freshLibrary, readFixture, runStep } from '../support/harness.ts';

describe('T08 invalid configurations are rejected and change nothing', () => {
  const oracle = readFixture('invalid-configs.json');
  for (const req of oracle.requests) {
    it(`${req.id}: ${req.description}`, () => {
      const lib = freshLibrary(req.input);
      const before = dumpRows(lib.db);
      const result = runStep(lib, { action: 'saveResume', id: req.resume, payload: req.payload });
      expect(result).toEqual({ status: req.status, code: req.code });
      expect(dumpRows(lib.db)).toEqual(before);
    });
  }
});

describe('T08 database constraints are a backstop for mismatched references', () => {
  const attempts: [string, string][] = [
    [
      'variant of another accomplishment',
      "INSERT INTO resume_bullets VALUES ('r-engineering', 'e1', 'a2', 'v31', 1)",
    ],
    [
      'accomplishment under the wrong experience',
      "INSERT INTO resume_bullets VALUES ('r-engineering', 'e1', 'a3', 'v31', 1)",
    ],
    ['project selected as work', "INSERT INTO resume_entries VALUES ('r-engineering', 'e3', 'project', 2)"],
    ['bullet for an unselected entry', "INSERT INTO resume_bullets VALUES ('r-engineering', 'e3', 'a5', 'v51', 0)"],
    ['delete a referenced variant directly', "DELETE FROM variants WHERE id = 'v12'"],
    ['delete a referenced experience directly', "DELETE FROM entries WHERE id = 'e2'"],
  ];
  for (const [what, sql] of attempts) {
    it(what, () => {
      const lib = freshLibrary('primary.input.json');
      const before = dumpRows(lib.db);
      expect(() => lib.db.exec(sql)).toThrow(/constraint failed/);
      expect(dumpRows(lib.db)).toEqual(before);
    });
  }
});

describe('saved configurations', () => {
  it('round-trip exactly, in saved order, with contiguous positions from zero', () => {
    const lib = freshLibrary('sections.input.json');
    const fixture = readFixture('sections.input.json');
    for (const saved of fixture.resumes) {
      const { id, ...config } = saved;
      expect(lib.getResume(id)).toEqual({ id, projects: [], skills: [], ...config });
    }
    const groups = lib.db
      .prepare(
        `SELECT resume_id, 'entries:' || kind AS grp, group_concat(sort_index) AS idx FROM
           (SELECT * FROM resume_entries ORDER BY sort_index) GROUP BY resume_id, kind
         UNION ALL SELECT resume_id, 'bullets:' || entry_id, group_concat(sort_index) FROM
           (SELECT * FROM resume_bullets ORDER BY sort_index) GROUP BY resume_id, entry_id
         UNION ALL SELECT resume_id, 'skills', group_concat(sort_index) FROM
           (SELECT * FROM resume_skills ORDER BY sort_index) GROUP BY resume_id`,
      )
      .all() as { idx: string }[];
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      const idx = String(g.idx).split(',').map(Number);
      expect(idx).toEqual(idx.map((_, i) => i));
    }
  });

  it('a save replaces only the target resume, and reordering takes effect', () => {
    const lib = freshLibrary('primary.input.json');
    const engineeringBefore = lib.getResume('r-engineering');
    const payload = {
      name: 'Security',
      experiences: [
        { experienceId: 'e2', bullets: [{ accomplishmentId: 'a3', variantId: 'v31' }] },
        {
          experienceId: 'e1',
          bullets: [
            { accomplishmentId: 'a1', variantId: 'v12' },
            { accomplishmentId: 'a2', variantId: 'v21' },
          ],
        },
      ],
    };
    expect(runStep(lib, { action: 'saveResume', id: 'r-security', payload }).status).toBe(200);
    expect(lib.getResume('r-security')).toEqual({ id: 'r-security', projects: [], skills: [], ...payload });
    expect(lib.getResume('r-engineering')).toEqual(engineeringBefore);
  });

  it('rejects unknown keys, client ordinals and a missing resume', () => {
    const lib = freshLibrary('primary.input.json');
    expect(runStep(lib, { action: 'saveResume', id: 'r-security', payload: { name: 'S', sortIndex: 3 } })).toEqual({
      status: 400,
      code: 'INVALID_INPUT',
    });
    expect(
      runStep(lib, {
        action: 'saveResume',
        id: 'r-security',
        payload: { name: 'S', experiences: [{ experienceId: 'e1', bullets: [], position: 0 }] },
      }),
    ).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(runStep(lib, { action: 'saveResume', id: 'r-missing', payload: { name: 'S' } })).toEqual({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
