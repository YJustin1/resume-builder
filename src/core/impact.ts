// Impact analysis (SPEC FR-04). Pure function over a snapshot.
//
// Phase 1 implements deletes: the resumes whose saved configurations
// reference the record directly or through its children. Edit impact is
// defined on assembled JSON and arrives with the assembler in Phase 2.

import { notFound, ServiceError } from './errors.ts';
import type { ResumeSummary, Snapshot } from './types.ts';

export type DeletableType = 'experience' | 'project' | 'accomplishment' | 'variant' | 'skill';

export interface DeleteChange {
  op: 'delete';
  type: DeletableType;
  id: string;
}

export interface Impact {
  affectedResumes: ResumeSummary[];
  blocked: boolean;
}

function referencesRecord(snap: Snapshot, change: DeleteChange, resumeId: string): boolean {
  const config = snap.resumes.get(resumeId);
  if (!config) return false;
  const allBullets = [...config.experiences, ...config.projects].flatMap((s) => s.bullets);
  switch (change.type) {
    case 'variant':
      return allBullets.some((b) => b.variantId === change.id);
    case 'accomplishment':
      return allBullets.some((b) => b.accomplishmentId === change.id);
    case 'experience':
      return config.experiences.some((s) => s.experienceId === change.id);
    case 'project':
      return config.projects.some((s) => s.projectId === change.id);
    case 'skill':
      return config.skills.includes(change.id);
  }
}

function assertExists(snap: Snapshot, change: DeleteChange): void {
  const found =
    change.type === 'variant'
      ? snap.variants.has(change.id)
      : change.type === 'accomplishment'
        ? snap.accomplishments.has(change.id)
        : change.type === 'skill'
          ? snap.skills.has(change.id)
          : snap.entries.get(change.id)?.kind === (change.type === 'experience' ? 'work' : 'project');
  if (!found) throw notFound(`${change.type} ${change.id} does not exist`);
}

/** Resumes that block a delete, deduplicated and sorted by ID. */
export function deleteImpact(snap: Snapshot, change: DeleteChange): Impact {
  assertExists(snap, change);
  const affectedResumes = [...snap.resumes.values()]
    .filter((r) => referencesRecord(snap, change, r.id))
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { affectedResumes, blocked: affectedResumes.length > 0 };
}

export function recordInUse(impact: Impact): ServiceError {
  return new ServiceError('RECORD_IN_USE', 'Record is used by saved resumes.', impact.affectedResumes);
}
