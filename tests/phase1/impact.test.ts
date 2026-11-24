// Phase 1: deleteImpact is a pure function of the snapshot (SPEC FR-04). Its
// output order is part of the contract (sorted by resume ID), independent of
// the order in which the snapshot happens to list resumes.

import { describe, expect, it } from 'vitest';
import { deleteImpact } from '../../src/core/impact.ts';
import type { Snapshot } from '../../src/core/types.ts';
import { freshLibrary } from '../support/harness.ts';

function reversedResumes(snap: Snapshot): Snapshot {
  return { ...snap, resumes: new Map([...snap.resumes.entries()].reverse()) };
}

describe('deleteImpact', () => {
  it('sorts affected resumes by ID even when the snapshot lists them in reverse', () => {
    const snap = reversedResumes(freshLibrary('primary.input.json').snapshot());
    expect([...snap.resumes.keys()]).toEqual(['r-security', 'r-engineering']);
    expect(deleteImpact(snap, { op: 'delete', type: 'accomplishment', id: 'a1' }).affectedResumes).toEqual([
      { id: 'r-engineering', name: 'Engineering' },
      { id: 'r-security', name: 'Security' },
    ]);
  });

  it('counts references through children and across both sections', () => {
    const snap = freshLibrary('sections.input.json').snapshot();
    const ids = (type: 'experience' | 'project' | 'accomplishment' | 'variant' | 'skill', id: string) =>
      deleteImpact(snap, { op: 'delete', type, id }).affectedResumes.map((r) => r.id);
    expect(ids('experience', 'w1')).toEqual(['r-data', 'r-platform']);
    expect(ids('project', 'p2')).toEqual(['r-data']);
    expect(ids('accomplishment', 'ap1')).toEqual(['r-data', 'r-platform']);
    expect(ids('variant', 'vw11')).toEqual(['r-platform']);
    expect(ids('skill', 's1')).toEqual(['r-platform']);
    expect(ids('variant', 'vw22')).toEqual([]);
  });

  it('does not mutate the snapshot', () => {
    const snap = freshLibrary('primary.input.json').snapshot();
    const copy = structuredClone(snap);
    deleteImpact(snap, { op: 'delete', type: 'variant', id: 'v11' });
    expect(snap).toEqual(copy);
  });
});
