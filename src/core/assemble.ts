// Resume assembly (SPEC FR-05): a deterministic, side-effect-free mapping from
// a snapshot and a saved configuration to a JSON Resume document. It refuses
// (never returns partial output) when the profile is missing, stored ordering
// is inconsistent, a reference is broken, or the result fails the schema.

import { notFound, ServiceError } from './errors.ts';
import { validateResumeDocument } from './fields.ts';
import type { BulletRef, Entry, EntryKind, Snapshot } from './types.ts';

export interface JsonResume {
  basics: Record<string, string>;
  work: Record<string, unknown>[];
  education?: Record<string, unknown>[];
  projects?: Record<string, unknown>[];
  skills?: Record<string, unknown>[];
}

const failed = (message: string) => new ServiceError('ASSEMBLY_FAILED', message);

/** Copy only the listed keys that are present (absent optional fields stay absent). */
function pick(source: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function highlights(snap: Snapshot, entry: Entry, bullets: BulletRef[]): string[] {
  return bullets.map((b) => {
    const acc = snap.accomplishments.get(b.accomplishmentId);
    if (!acc || acc.entryId !== entry.id) throw failed(`accomplishment ${b.accomplishmentId} is not part of ${entry.id}`);
    const variant = snap.variants.get(b.variantId);
    if (!variant || variant.accomplishmentId !== acc.id) {
      throw failed(`variant ${b.variantId} is not a wording of ${acc.id}`);
    }
    return variant.text;
  });
}

function entryOf(snap: Snapshot, id: string, kind: EntryKind): Entry {
  const entry = snap.entries.get(id);
  if (!entry || entry.kind !== kind) throw failed(`${id} is not a ${kind} entry`);
  return entry;
}

/** Each entry, accomplishment and skill may appear at most once per resume. */
function assertUnique(ids: string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw failed(`${what} ${id} is selected more than once`);
    seen.add(id);
  }
}

/** Every exported string must be nonempty after trimming (FR-05: never emit empty strings). */
function assertNoBlankStrings(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (value.trim() === '') throw failed(`${path} is empty`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBlankStrings(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) assertNoBlankStrings(v, `${path}.${k}`);
  }
}

export function assembleResume(snap: Snapshot, resumeId: string): JsonResume {
  const config = snap.resumes.get(resumeId);
  if (!config) throw notFound(`resume ${resumeId} does not exist`);
  if (!snap.profile || typeof snap.profile.name !== 'string' || snap.profile.name.trim() === '') {
    throw new ServiceError('PROFILE_REQUIRED', 'Set your name in the profile before exporting');
  }
  const ordering = snap.orderingProblems.get(resumeId);
  if (ordering) throw failed(`stored ordering is inconsistent: ${ordering.join('; ')}`);
  assertUnique([...config.experiences.map((s) => s.experienceId), ...config.projects.map((s) => s.projectId)], 'entry');
  assertUnique(
    [...config.experiences, ...config.projects].flatMap((s) => s.bullets.map((b) => b.accomplishmentId)),
    'accomplishment',
  );
  assertUnique(config.skills, 'skill');

  const resume: JsonResume = {
    basics: pick(snap.profile, ['name', 'label', 'email', 'phone', 'url']) as Record<string, string>,
    work: config.experiences.map((sel) => {
      const entry = entryOf(snap, sel.experienceId, 'work');
      return {
        ...pick(entry, ['name', 'position', 'location', 'url', 'startDate', 'endDate']),
        highlights: highlights(snap, entry, sel.bullets),
      };
    }),
  };
  if (snap.profile.education.length > 0) {
    resume.education = snap.profile.education.map((e) =>
      pick(e, ['institution', 'area', 'studyType', 'startDate', 'endDate']),
    );
  }
  if (config.projects.length > 0) {
    resume.projects = config.projects.map((sel) => {
      const entry = entryOf(snap, sel.projectId, 'project');
      return { ...pick(entry, ['name', 'url', 'startDate', 'endDate']), highlights: highlights(snap, entry, sel.bullets) };
    });
  }
  if (config.skills.length > 0) {
    resume.skills = config.skills.map((skillId) => {
      const skill = snap.skills.get(skillId);
      if (!skill) throw failed(`skill ${skillId} does not exist`);
      return { ...pick(skill, ['name', 'level']), ...(skill.keywords.length > 0 ? { keywords: [...skill.keywords] } : {}) };
    });
  }

  assertNoBlankStrings(resume, 'resume');
  const errors = validateResumeDocument(resume);
  if (errors.length > 0) throw failed(`assembled document is not valid JSON Resume: ${errors.join('; ')}`);
  return resume;
}
