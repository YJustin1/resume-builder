// Phase 2 gate: every fixture through the HTTP API, with exact expected exports
// and impact sets. Rendering assertions (Phase 3) are listed as todo.

import { describe, expect, it } from 'vitest';
import { dumpRows, freshLibrary, readFixture, recordExists } from '../support/harness.ts';
import { Api, checkStep, expectExports, resolveExpected } from '../support/http.ts';

const LIBRARY_TABLES = ['profile', 'entries', 'accomplishments', 'variants', 'skills'] as const;
const library = (rows: Record<string, unknown[]>) => Object.fromEntries(LIBRARY_TABLES.map((t) => [t, rows[t]]));

interface StepCase {
  case: string;
  steps: any[];
  expected?: Record<string, unknown>;
  expectedSkills?: Record<string, unknown>;
  libraryUnchanged?: boolean;
  factsUnchanged?: boolean;
  recordsAbsent?: string[];
  recordsStillPresent?: string[];
}

async function runCase(input: string | undefined, c: StepCase): Promise<string[]> {
  const api = new Api(freshLibrary(input));
  const initial = dumpRows(api.lib.db);
  const deferred: string[] = [];
  for (const [i, step] of c.steps.entries()) {
    deferred.push(...(await checkStep(api, step, `${c.case} step ${i + 1} (${step.action})`)));
  }
  if (c.expected) await expectExports(api, c.expected, c.case);
  for (const [resumeId, skills] of Object.entries(c.expectedSkills ?? {})) {
    expect((await api.exportJson(resumeId)).body.skills, `${c.case}: ${resumeId} skills`).toEqual(skills);
  }
  if (c.libraryUnchanged) expect(library(dumpRows(api.lib.db))).toEqual(library(initial));
  if (c.factsUnchanged) expect(dumpRows(api.lib.db).accomplishments).toEqual(initial.accomplishments);
  for (const id of c.recordsAbsent ?? []) expect(recordExists(api.lib, id), id).toBe(false);
  for (const id of c.recordsStillPresent ?? []) expect(recordExists(api.lib, id), id).toBe(true);
  return deferred;
}

for (const file of ['primary-mutations.expected.json', 'sections-mutations.expected.json']) {
  const fixture = readFixture(file);
  describe(file, () => {
    for (const c of fixture.cases as StepCase[]) {
      it(`${c.case} through HTTP with exact exports and impact`, async () => {
        expect(await runCase(fixture.input, c)).toEqual([]);
      });
    }
  });
}

describe('text-handling.expected.json (JSON part)', () => {
  const fixture = readFixture('text-handling.expected.json');
  for (const c of fixture.cases) {
    if (Array.isArray(c.steps)) {
      it(`${c.case} write and JSON steps`, async () => {
        const deferred = await runCase(fixture.input, c);
        expect(deferred.every((d) => d.includes('Phase 3'))).toBe(true);
      });
      it.todo(`${c.case} printed HTML, PDF and direct-SQL runtime policy (Phase 3)`);
    } else {
      it(`${c.case} JSON keeps the text exactly as entered`, async () => {
        const api = new Api(freshLibrary(fixture.input));
        const res = await api.call('PATCH', `/api/variants/${c.edit.id}`, { text: c.edit.text });
        expect(res.status).toBe(200);
        const doc = (await api.exportJson('r-security')).body;
        expect(doc.work[0].highlights).toContain(c.expectedJsonHighlight);
      });
      it.todo(`${c.case} printed text (Phase 3)`);
    }
  }
});

describe('T21 shared correction across three resumes (shared-edit.expected.json)', () => {
  it('before, impact, one edit, after', async () => {
    const oracle = readFixture('shared-edit.expected.json');
    const api = new Api(freshLibrary(oracle.input));
    await expectExports(api, oracle.before, 'T21 before');
    const change = { op: 'edit', type: oracle.edit.type, id: oracle.edit.id, patch: { text: oracle.edit.text } };
    expect((await api.call('POST', '/api/impact', change)).body).toEqual({ affectedResumes: oracle.expectedImpact, blocked: false });
    expect((await api.call('PATCH', `/api/variants/${oracle.edit.id}`, { text: oracle.edit.text })).status).toBe(200);
    await expectExports(api, oracle.after, 'T21 after');
  });
});

describe('T27 first run (first-run.expected.json)', () => {
  it('from an empty database through profile creation', async () => {
    const fixture = readFixture('first-run.expected.json');
    expect(await runCase(undefined, fixture)).toEqual([]);
  });
});

describe('HTTP versions of the deletion and configuration gates', () => {
  it('T04 deletion.expected.json: 409 bodies, unchanged rows and exports', async () => {
    const oracle = readFixture('deletion.expected.json');
    for (const attempt of oracle.attempts) {
      const api = new Api(freshLibrary('primary.input.json'));
      const before = dumpRows(api.lib.db);
      const path = attempt.type === 'variant' ? 'variants' : 'accomplishments';
      const res = await api.call('DELETE', `/api/${path}/${attempt.id}`);
      expect(res.status).toBe(attempt.status);
      expect(res.body).toEqual({
        error: { code: attempt.code, message: 'Record is used by saved resumes.', affectedResumes: attempt.affectedResumes },
      });
      expect(dumpRows(api.lib.db)).toEqual(before);
      for (const file of oracle.unchangedExports) {
        const id = file.startsWith('security') ? 'r-security' : 'r-engineering';
        expect((await api.exportJson(id)).body).toEqual(readFixture(file));
      }
    }
  });

  it('T07/T20 deletion-more.expected.json with unchanged exports', async () => {
    const oracle = readFixture('deletion-more.expected.json');
    const paths: Record<string, string> = {
      experience: 'experiences',
      project: 'projects',
      accomplishment: 'accomplishments',
      variant: 'variants',
      skill: 'skills',
    };
    for (const a of oracle.attempts) {
      const api = new Api(freshLibrary(a.input));
      const res = await api.call('DELETE', `/api/${paths[a.type]}/${a.id}`);
      expect(res.status, a.case).toBe(a.status);
      if (a.status >= 400) expect(res.body.error, a.case).toEqual(expect.objectContaining({ code: a.code, affectedResumes: a.affectedResumes }));
      for (const [resumeId, file] of Object.entries(a.unchangedExports as Record<string, string>)) {
        expect((await api.exportJson(resumeId)).body, `${a.case} ${resumeId}`).toEqual(readFixture(file));
      }
      for (const id of a.recordsAbsent ?? []) expect(recordExists(api.lib, id), `${a.case} ${id} absent`).toBe(false);
      for (const id of a.recordsStillPresent ?? []) expect(recordExists(api.lib, id), `${a.case} ${id} present`).toBe(true);
    }
  });

  it('T06 HTTP: unused v41, a4 and e3 delete with their children; both exports unchanged', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    for (const path of ['/api/variants/v41', '/api/accomplishments/a4', '/api/experiences/e3']) {
      expect((await api.call('DELETE', path)).status, path).toBe(204);
    }
    for (const id of ['v41', 'a4', 'e3', 'a5', 'v51']) expect(recordExists(api.lib, id), id).toBe(false);
    for (const id of ['e1', 'e2', 'a1', 'a2', 'a3', 'v11', 'v12', 'v21', 'v22', 'v31', 'v32']) {
      expect(recordExists(api.lib, id), id).toBe(true);
    }
    expect((await api.exportJson('r-security')).body).toEqual(readFixture('security.expected.json'));
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
  });

  it('T07 continued: deleting r-security; Engineering identical; lookup 404', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const before = library(dumpRows(api.lib.db));
    expect((await api.call('DELETE', '/api/resumes/r-security')).status).toBe(204);
    expect(library(dumpRows(api.lib.db))).toEqual(before);
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
    const missing = await api.call('GET', '/api/resumes/r-security');
    expect(missing.status).toBe(404);
    expect(missing.code).toBe('NOT_FOUND');
  });

  it('T08 invalid-configs.json: HTTP 400s with unchanged exports', async () => {
    const oracle = readFixture('invalid-configs.json');
    for (const req of oracle.requests) {
      const api = new Api(freshLibrary(req.input));
      const res = await api.call('PUT', `/api/resumes/${req.resume}`, req.payload);
      expect([res.status, res.code], req.id).toEqual([req.status, req.code]);
      expect((await api.exportJson(req.resume)).body, req.id).toEqual(readFixture(req.unchangedExport));
    }
  });

  it('T15 HTTP: last unreferenced variant, then selecting it is INVALID_REFERENCE', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    expect((await api.call('DELETE', '/api/variants/v41')).status).toBe(204);
    const res = await api.call('PUT', '/api/resumes/r-security', {
      name: 'Security',
      experiences: [{ experienceId: 'e2', bullets: [{ accomplishmentId: 'a4', variantId: 'v41' }] }],
    });
    expect([res.status, res.code]).toEqual([400, 'INVALID_REFERENCE']);
    expect((await api.exportJson('r-security')).body).toEqual(readFixture('security.expected.json'));
  });
});

describe('expected documents are themselves valid', () => {
  it('every expected export file passes the pinned schema', async () => {
    const { validateResumeDocument } = await import('../../src/core/fields.ts');
    for (const file of [
      'security.expected.json',
      'engineering.expected.json',
      'sections.platform.expected.json',
      'sections.data.expected.json',
      'overflow.expected.json',
    ]) {
      expect(validateResumeDocument(resolveExpected(`file:${file}`)), file).toEqual([]);
    }
  });
});
