// Phase 1 gate, service level: the step-sequence fixtures.
// Every step's status, code and affected resumes are checked now, and every
// rejected step must leave all rows unchanged. Assertions that need the
// assembler (Phase 2) or the renderer (Phase 3) are listed as todo, never
// silently skipped.

import { describe, expect, it } from 'vitest';
import { dumpRows, freshLibrary, readFixture, recordExists, runStep } from '../support/harness.ts';

interface StepCase {
  case: string;
  steps: any[];
  expected?: unknown;
  recordsAbsent?: string[];
  recordsStillPresent?: string[];
}

const FILES: [string, (c: StepCase) => boolean][] = [
  ['primary-mutations.expected.json', () => true],
  ['sections-mutations.expected.json', () => true],
  ['text-handling.expected.json', (c) => Array.isArray(c.steps)], // T26; T16/T16b are Phase 3
];

for (const [file, include] of FILES) {
  const fixture = readFixture(file);
  describe(file, () => {
    for (const c of (fixture.cases as StepCase[]).filter(include)) {
      it(`${c.case} statuses, codes and atomicity`, () => {
        const lib = freshLibrary(fixture.input);
        c.steps.forEach((step, i) => {
          const before = dumpRows(lib.db);
          const result = runStep(lib, step);
          if (result.deferred) return; // reported by the todo entry below
          const where = `${c.case} step ${i + 1} (${step.action})`;
          expect(result.status, where).toBe(step.status);
          if (step.code) expect(result.code, where).toBe(step.code);
          if (step.affectedResumes) expect(result.affectedResumes, where).toEqual(step.affectedResumes);
          if (step.status >= 400) expect(dumpRows(lib.db), `${where} must change nothing`).toEqual(before);
          if (step.action === 'delete' && step.status === 204) {
            // A successful delete must actually remove the record. Variants and
            // skills have no children, so every other row must be unchanged.
            expect(recordExists(lib, step.id), `${where} removed ${step.id}`).toBe(false);
            if (step.type === 'variant' || step.type === 'skill') {
              const table = step.type === 'variant' ? 'variants' : 'skills';
              const expected = { ...before, [table]: before[table]!.filter((r: any) => r.id !== step.id) };
              expect(dumpRows(lib.db), `${where} removes only ${step.id}`).toEqual(expected);
            }
          }
          if (step.expectedBody) expect(result.body, where).toEqual(step.expectedBody);
        });
        for (const id of c.recordsAbsent ?? []) expect(recordExists(lib, id), id).toBe(false);
        for (const id of c.recordsStillPresent ?? []) expect(recordExists(lib, id), id).toBe(true);
      });
      it.todo(`${c.case} export and impact assertions (Phase 2/3: expected exports, expectedImpact, rendered output)`);
    }
  });
}
