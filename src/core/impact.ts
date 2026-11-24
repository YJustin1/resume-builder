// Impact analysis (SPEC FR-04). Pure functions over a snapshot.
//
// Deletes: the resumes whose saved configurations reference the record
// directly or through its children (these block the delete).
// Edits: the resumes whose assembled JSON differs between the snapshot and the
// snapshot with the normalized patch applied. A failed assembly counts as its
// own state (e.g. "unexportable" before a profile exists, FR-01a).

import { isDeepStrictEqual } from 'node:util';
import {
  newProfile,
  patchedAccomplishment,
  patchedEntry,
  patchedProfile,
  patchedSkill,
  patchedVariant,
} from './apply.ts';
import { assembleResume } from './assemble.ts';
import { invalidInput, notFound, ServiceError } from './errors.ts';
import { id as checkId, onlyKeys } from './fields.ts';
import type { ResumeSummary, Snapshot } from './types.ts';

export type DeletableType = 'experience' | 'project' | 'accomplishment' | 'variant' | 'skill';
export type EditableType = DeletableType | 'profile';

export interface DeleteChange {
  op: 'delete';
  type: DeletableType;
  id: string;
}

export interface EditChange {
  op: 'edit';
  type: EditableType;
  id?: string;
  patch: unknown;
}

export interface Impact {
  affectedResumes: ResumeSummary[];
  blocked: boolean;
}

const DELETABLE: readonly string[] = ['experience', 'project', 'accomplishment', 'variant', 'skill'];

const byId = (a: ResumeSummary, b: ResumeSummary) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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

function assertExists(snap: Snapshot, type: DeletableType, id: string): void {
  const found =
    type === 'variant'
      ? snap.variants.has(id)
      : type === 'accomplishment'
        ? snap.accomplishments.has(id)
        : type === 'skill'
          ? snap.skills.has(id)
          : snap.entries.get(id)?.kind === (type === 'experience' ? 'work' : 'project');
  if (!found) throw notFound(`${type} ${id} does not exist`);
}

/** Resumes that block a delete, deduplicated and sorted by ID. */
export function deleteImpact(snap: Snapshot, change: DeleteChange): Impact {
  assertExists(snap, change.type, change.id);
  const affectedResumes = [...snap.resumes.values()]
    .filter((r) => referencesRecord(snap, change, r.id))
    .map((r) => ({ id: r.id, name: r.name }))
    .sort(byId);
  return { affectedResumes, blocked: affectedResumes.length > 0 };
}

/** The snapshot with one normalized edit applied (the write's own rules). */
function applyEdit(snap: Snapshot, change: EditChange): Snapshot {
  const next: Snapshot = { ...snap };
  const id = change.id as string;
  switch (change.type) {
    case 'profile':
      next.profile = snap.profile ? patchedProfile(snap.profile, change.patch) : newProfile(change.patch);
      return next;
    case 'experience':
    case 'project': {
      assertExists(snap, change.type, id);
      next.entries = new Map(snap.entries).set(id, patchedEntry(snap.entries.get(id)!, change.patch));
      return next;
    }
    case 'accomplishment':
      assertExists(snap, 'accomplishment', id);
      next.accomplishments = new Map(snap.accomplishments).set(
        id,
        patchedAccomplishment(snap.accomplishments.get(id)!, change.patch),
      );
      return next;
    case 'variant':
      assertExists(snap, 'variant', id);
      next.variants = new Map(snap.variants).set(id, patchedVariant(snap.variants.get(id)!, change.patch));
      return next;
    case 'skill':
      assertExists(snap, 'skill', id);
      next.skills = new Map(snap.skills).set(id, patchedSkill(snap.skills.get(id)!, change.patch));
      return next;
  }
}

/** Assembled JSON, or a marker for the failure state (e.g. unexportable). */
function exportState(snap: Snapshot, resumeId: string): unknown {
  try {
    return assembleResume(snap, resumeId);
  } catch (error) {
    if (error instanceof ServiceError) return { state: error.code };
    throw error;
  }
}

/** Resumes whose assembled JSON would change, sorted by ID. Never blocked. */
export function editImpact(snap: Snapshot, change: EditChange): Impact {
  const after = applyEdit(snap, change);
  const affectedResumes = [...snap.resumes.values()]
    .filter((r) => !isDeepStrictEqual(exportState(snap, r.id), exportState(after, r.id)))
    .map((r) => ({ id: r.id, name: r.name }))
    .sort(byId);
  return { affectedResumes, blocked: false };
}

/** Validate a change proposal (POST /api/impact body) and compute its impact. */
export function impactOf(snap: Snapshot, raw: unknown): Impact {
  const change = onlyKeys(raw, ['op', 'type', 'id', 'patch'], 'change');
  if (change.op === 'delete') {
    if (typeof change.type !== 'string' || !DELETABLE.includes(change.type)) throw invalidInput('change.type is not deletable');
    if (change.patch !== undefined) throw invalidInput('a delete change has no patch');
    return deleteImpact(snap, { op: 'delete', type: change.type as DeletableType, id: checkId(change.id, 'change.id') });
  }
  if (change.op === 'edit') {
    if (change.type === 'profile') {
      if (change.id !== undefined) throw invalidInput('a profile change has no id');
      return editImpact(snap, { op: 'edit', type: 'profile', patch: change.patch });
    }
    if (typeof change.type !== 'string' || !DELETABLE.includes(change.type)) throw invalidInput('change.type is not editable');
    return editImpact(snap, {
      op: 'edit',
      type: change.type as DeletableType,
      id: checkId(change.id, 'change.id'),
      patch: change.patch,
    });
  }
  throw invalidInput('change.op must be "edit" or "delete"');
}

export function recordInUse(impact: Impact): ServiceError {
  return new ServiceError('RECORD_IN_USE', 'Record is used by saved resumes.', impact.affectedResumes);
}
