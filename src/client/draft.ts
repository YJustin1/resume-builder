// Pure editing logic for one resume configuration (FR-02). The UI edits a
// local draft; nothing reaches the server until Save, and "unsaved" is simply
// draft !== saved. Every operation returns a new draft.

import type { ResumeConfiguration } from '../core/types.ts';
import type { EntryView, LibraryData } from './api.ts';

export interface BulletDraft {
  accomplishmentId: string;
  /** '' until the user picks a wording: no variant is ever chosen silently (FR-01). */
  variantId: string;
}

export interface SelectionDraft {
  entryId: string;
  bullets: BulletDraft[];
}

export type SectionKey = 'work' | 'projects';

export interface Draft {
  name: string;
  work: SelectionDraft[];
  projects: SelectionDraft[];
  skills: string[];
}

export function fromConfiguration(c: ResumeConfiguration): Draft {
  return {
    name: c.name,
    work: c.experiences.map((s) => ({ entryId: s.experienceId, bullets: s.bullets.map((b) => ({ ...b })) })),
    projects: c.projects.map((s) => ({ entryId: s.projectId, bullets: s.bullets.map((b) => ({ ...b })) })),
    skills: [...c.skills],
  };
}

/** The `PUT /api/resumes/:id` body (SPEC §6): array order is the saved order. */
export function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    experiences: d.work.map((s) => ({ experienceId: s.entryId, bullets: s.bullets })),
    projects: d.projects.map((s) => ({ projectId: s.entryId, bullets: s.bullets })),
    skills: d.skills,
  };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Problems that block saving, in words the user can act on. */
export function draftProblems(d: Draft): string[] {
  const problems: string[] = [];
  if (d.name.trim() === '') problems.push('Give the resume a name.');
  const missing = [...d.work, ...d.projects].flatMap((s) => s.bullets).filter((b) => b.variantId === '').length;
  if (missing > 0) problems.push(`Choose a wording for ${missing === 1 ? 'one bullet' : `${missing} bullets`}.`);
  return problems;
}

/**
 * References in the draft to records deleted in the Library since they were
 * chosen (the editor stays mounted while the Library is open). Saving is
 * blocked until each is replaced or removed (Codex Phase 4 verification, 6).
 */
export function referenceProblems(d: Draft, library: LibraryData): string[] {
  const problems: string[] = [];
  let missingEntries = 0;
  let missingBullets = 0;
  let missingWordings = 0;
  for (const key of ['work', 'projects'] as const) {
    for (const sel of d[key]) {
      const entry = entriesFor(library, key).find((e) => e.id === sel.entryId);
      if (!entry) {
        missingEntries++;
        continue;
      }
      for (const b of sel.bullets) {
        const a = entry.accomplishments.find((x) => x.id === b.accomplishmentId);
        if (!a) missingBullets++;
        else if (b.variantId !== '' && !a.variants.some((v) => v.id === b.variantId)) missingWordings++;
      }
    }
  }
  const missingSkills = d.skills.filter((id) => !library.skills.some((s) => s.id === id)).length;
  const n = (count: number, one: string, many: string) => (count === 1 ? one : `${count} ${many}`);
  if (missingWordings) problems.push(`Choose a replacement for ${n(missingWordings, 'one bullet', 'bullets')} whose wording was deleted.`);
  if (missingBullets) problems.push(`Remove ${n(missingBullets, 'one bullet', 'bullets')} whose accomplishment was deleted.`);
  if (missingEntries) problems.push(`Remove ${n(missingEntries, 'one entry', 'entries')} that ${missingEntries === 1 ? 'was' : 'were'} deleted.`);
  if (missingSkills) problems.push(`Remove ${n(missingSkills, 'one skill', 'skills')} that ${missingSkills === 1 ? 'was' : 'were'} deleted.`);
  return problems;
}

/** Move item `index` by `delta` (-1 up, +1 down); out-of-range moves return the list unchanged. */
export function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

const withSection = (d: Draft, key: SectionKey, f: (s: SelectionDraft[]) => SelectionDraft[]): Draft => ({ ...d, [key]: f(d[key]) });

export const addEntry = (d: Draft, key: SectionKey, entryId: string): Draft =>
  d[key].some((s) => s.entryId === entryId) ? d : withSection(d, key, (s) => [...s, { entryId, bullets: [] }]);

export const removeEntry = (d: Draft, key: SectionKey, index: number): Draft => withSection(d, key, (s) => s.filter((_, i) => i !== index));

export const moveEntry = (d: Draft, key: SectionKey, index: number, delta: -1 | 1): Draft => withSection(d, key, (s) => move(s, index, delta));

function withBullets(d: Draft, key: SectionKey, entryIndex: number, f: (b: BulletDraft[]) => BulletDraft[]): Draft {
  return withSection(d, key, (s) => s.map((sel, i) => (i === entryIndex ? { ...sel, bullets: f(sel.bullets) } : sel)));
}

export const addBullet = (d: Draft, key: SectionKey, entryIndex: number, accomplishmentId: string, variantId: string): Draft =>
  withBullets(d, key, entryIndex, (b) => (b.some((x) => x.accomplishmentId === accomplishmentId) ? b : [...b, { accomplishmentId, variantId }]));

export const removeBullet = (d: Draft, key: SectionKey, entryIndex: number, bulletIndex: number): Draft =>
  withBullets(d, key, entryIndex, (b) => b.filter((_, i) => i !== bulletIndex));

export const moveBullet = (d: Draft, key: SectionKey, entryIndex: number, bulletIndex: number, delta: -1 | 1): Draft =>
  withBullets(d, key, entryIndex, (b) => move(b, bulletIndex, delta));

export const setVariant = (d: Draft, key: SectionKey, entryIndex: number, bulletIndex: number, variantId: string): Draft =>
  withBullets(d, key, entryIndex, (b) => b.map((x, i) => (i === bulletIndex ? { ...x, variantId } : x)));

export const addSkill = (d: Draft, skillId: string): Draft => (d.skills.includes(skillId) ? d : { ...d, skills: [...d.skills, skillId] });
export const removeSkill = (d: Draft, index: number): Draft => ({ ...d, skills: d.skills.filter((_, i) => i !== index) });
export const moveSkill = (d: Draft, index: number, delta: -1 | 1): Draft => ({ ...d, skills: move(d.skills, index, delta) });

export function entriesFor(library: LibraryData, key: SectionKey): EntryView[] {
  return key === 'work' ? library.experiences : library.projects;
}

/** Accomplishments of an entry that can be added as a bullet: not yet selected, and with at least one wording. */
export function addableAccomplishments(entry: EntryView, selection: SelectionDraft) {
  const used = new Set(selection.bullets.map((b) => b.accomplishmentId));
  return entry.accomplishments.filter((a) => !used.has(a.id) && a.variants.length > 0);
}
