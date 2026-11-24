// Validation of a resume configuration payload (SPEC §4 invariants, §6 PUT,
// T08). Pure: checks the payload against a snapshot and returns the
// normalized configuration, or throws before anything is written.
//
// Error rule (fixtures/invalid-configs.json): an ID that exists but is used in
// the wrong role or under the wrong parent is INVALID_INPUT; an ID that does
// not exist at all is INVALID_REFERENCE.

import { invalidInput, invalidReference } from './errors.ts';
import { id as checkId, onlyKeys, plainText } from './fields.ts';
import type { BulletRef, EntryKind, ResumeConfiguration, Snapshot } from './types.ts';

export type ConfigurationInput = Omit<ResumeConfiguration, 'id'>;

/** True if the ID names any record of any type. */
function existsAnywhere(snap: Snapshot, id: string): boolean {
  return (
    snap.entries.has(id) ||
    snap.accomplishments.has(id) ||
    snap.variants.has(id) ||
    snap.skills.has(id) ||
    snap.resumes.has(id)
  );
}

/** A lookup miss: wrong role if the ID exists elsewhere, else a missing reference. */
function missing(snap: Snapshot, id: string, message: string) {
  return existsAnywhere(snap, id)
    ? invalidInput(`${message} (the ID belongs to a different kind of record)`)
    : invalidReference(`${message} (no record has this ID)`);
}

function bullets(
  snap: Snapshot,
  raw: unknown,
  entryId: string,
  where: string,
  seenAccomplishments: Set<string>,
): BulletRef[] {
  if (!Array.isArray(raw)) throw invalidInput(`${where}.bullets must be an array`);
  return raw.map((item, i) => {
    const at = `${where}.bullets[${i}]`;
    const b = onlyKeys(item, ['accomplishmentId', 'variantId'], at);
    const accomplishmentId = checkId(b.accomplishmentId, `${at}.accomplishmentId`);
    const variantId = checkId(b.variantId, `${at}.variantId`);
    const acc = snap.accomplishments.get(accomplishmentId);
    if (!acc) throw missing(snap, accomplishmentId, `${at}: ${accomplishmentId} is not an accomplishment`);
    if (acc.entryId !== entryId) {
      throw invalidInput(`${at}: accomplishment ${accomplishmentId} does not belong to ${entryId}`);
    }
    if (seenAccomplishments.has(accomplishmentId)) {
      throw invalidInput(`${at}: accomplishment ${accomplishmentId} is selected more than once`);
    }
    seenAccomplishments.add(accomplishmentId);
    const variant = snap.variants.get(variantId);
    if (!variant) throw missing(snap, variantId, `${at}: ${variantId} is not a variant`);
    if (variant.accomplishmentId !== accomplishmentId) {
      throw invalidInput(`${at}: variant ${variantId} does not belong to accomplishment ${accomplishmentId}`);
    }
    return { accomplishmentId, variantId };
  });
}

function section(
  snap: Snapshot,
  raw: unknown,
  kind: EntryKind,
  seenAccomplishments: Set<string>,
): { entryId: string; bullets: BulletRef[] }[] {
  const key = kind === 'work' ? 'experiences' : 'projects';
  const idKey = kind === 'work' ? 'experienceId' : 'projectId';
  if (raw === undefined) {
    // SPEC §6: experiences is required so a partial body cannot clear work
    // selections; projects defaults to [].
    if (kind === 'work') throw invalidInput('experiences is required (use [] for none)');
    return [];
  }
  if (!Array.isArray(raw)) throw invalidInput(`${key} must be an array`);
  const seenEntries = new Set<string>();
  return raw.map((item, i) => {
    const at = `${key}[${i}]`;
    const sel = onlyKeys(item, [idKey, 'bullets'], at);
    const entryId = checkId(sel[idKey], `${at}.${idKey}`);
    const entry = snap.entries.get(entryId);
    if (!entry) throw missing(snap, entryId, `${at}: ${entryId} is not an entry`);
    if (entry.kind !== kind) throw invalidInput(`${at}: ${entryId} is a ${entry.kind} entry, not ${kind}`);
    if (seenEntries.has(entryId)) throw invalidInput(`${at}: ${entryId} is selected more than once`);
    seenEntries.add(entryId);
    return { entryId, bullets: bullets(snap, sel.bullets, entryId, at, seenAccomplishments) };
  });
}

export function validateConfiguration(snap: Snapshot, payload: unknown): ConfigurationInput {
  const body = onlyKeys(payload, ['name', 'experiences', 'projects', 'skills'], 'configuration');
  const name = plainText(body.name, 'name');
  const seenAccomplishments = new Set<string>();
  const experiences = section(snap, body.experiences, 'work', seenAccomplishments).map((s) => ({
    experienceId: s.entryId,
    bullets: s.bullets,
  }));
  const projects = section(snap, body.projects, 'project', seenAccomplishments).map((s) => ({
    projectId: s.entryId,
    bullets: s.bullets,
  }));
  let skills: string[] = [];
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills)) throw invalidInput('skills must be an array');
    const seen = new Set<string>();
    skills = body.skills.map((raw, i) => {
      const skillId = checkId(raw, `skills[${i}]`);
      if (!snap.skills.has(skillId)) throw missing(snap, skillId, `skills[${i}]: ${skillId} is not a skill`);
      if (seen.has(skillId)) throw invalidInput(`skills[${i}]: skill ${skillId} is selected more than once`);
      seen.add(skillId);
      return skillId;
    });
  }
  return { name, experiences, projects, skills };
}
