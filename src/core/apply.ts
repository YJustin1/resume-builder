// Pure create/patch functions for library records. The service layer writes
// what these return, and edit-impact analysis (FR-04) applies the same
// functions to a snapshot, so a proposal is validated and normalized exactly
// as the real write would be.

import { invalidInput } from './errors.ts';
import {
  ACCOMPLISHMENT_RULES,
  build,
  checkDates,
  PROFILE_RULES,
  PROJECT_RULES,
  SKILL_RULES,
  VARIANT_RULES,
  WORK_RULES,
} from './rules.ts';
import type { Accomplishment, EducationItem, Entry, EntryKind, Profile, Skill, Variant } from './types.ts';

type Fields = Record<string, unknown>;

/** Drop undefined values so absent optional fields stay absent. */
function defined<T>(record: Fields): T {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as T;
}

const entryWhat = (kind: EntryKind) => (kind === 'work' ? 'experience' : 'project');
const entryRules = (kind: EntryKind) => (kind === 'work' ? WORK_RULES : PROJECT_RULES);

export function newEntry(kind: EntryKind, id: string, body: unknown): Entry {
  const fields = build(body, entryRules(kind), entryWhat(kind));
  checkDates(fields);
  return defined<Entry>({ id, kind, ...fields });
}

export function patchedEntry(entry: Entry, patch: unknown): Entry {
  const { id, kind, ...current } = entry;
  const fields = build(patch, entryRules(kind), entryWhat(kind), current);
  checkDates(fields);
  return defined<Entry>({ id, kind, ...fields });
}

export function newAccomplishment(id: string, entryId: string, body: unknown): Accomplishment {
  const f = build(body, ACCOMPLISHMENT_RULES, 'accomplishment');
  return { id, entryId, fact: f.fact as string, tags: (f.tags as string[] | undefined) ?? [] };
}

export function patchedAccomplishment(a: Accomplishment, patch: unknown): Accomplishment {
  const { id, entryId, ...current } = a;
  const f = build(patch, ACCOMPLISHMENT_RULES, 'accomplishment', current);
  return { id, entryId, fact: f.fact as string, tags: (f.tags as string[] | undefined) ?? [] };
}

export function newVariant(id: string, accomplishmentId: string, body: unknown): Variant {
  const f = build(body, VARIANT_RULES, 'variant');
  return { id, accomplishmentId, text: f.text as string };
}

export function patchedVariant(v: Variant, patch: unknown): Variant {
  const { id, accomplishmentId, ...current } = v;
  const f = build(patch, VARIANT_RULES, 'variant', current);
  return { id, accomplishmentId, text: f.text as string };
}

export function newSkill(id: string, body: unknown): Skill {
  const f = build(body, SKILL_RULES, 'skill');
  return defined<Skill>({ id, ...f, keywords: (f.keywords as string[] | undefined) ?? [] });
}

export function patchedSkill(s: Skill, patch: unknown): Skill {
  const { id, ...current } = s;
  const f = build(patch, SKILL_RULES, 'skill', current);
  return defined<Skill>({ id, ...f, keywords: (f.keywords as string[] | undefined) ?? [] });
}

/** A full profile body (PUT, or a creation proposal). `name` is required. */
export function newProfile(body: unknown): Profile {
  const f = build(body, PROFILE_RULES, 'profile');
  return defined<Profile>({ ...f, education: (f.education as EducationItem[] | undefined) ?? [] });
}

export function patchedProfile(p: Profile, patch: unknown): Profile {
  const f = build(patch, PROFILE_RULES, 'profile', { ...p });
  if (typeof f.name !== 'string') throw invalidInput('profile.name is required');
  return defined<Profile>({ ...f, education: (f.education as EducationItem[] | undefined) ?? [] });
}
