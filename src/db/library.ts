// Service layer (SPEC §5 FR-01, FR-01a, FR-02, FR-03). Every public method
// validates its whole input before writing, runs in one transaction, and
// throws a ServiceError on failure, so a failed call changes nothing.

import { randomUUID } from 'node:crypto';
import { validateConfiguration } from '../core/configuration.ts';
import { invalidInput, notFound, ServiceError } from '../core/errors.ts';
import { id as checkId, text } from '../core/fields.ts';
import { deleteImpact, recordInUse, type DeletableType, type Impact } from '../core/impact.ts';
import type {
  Accomplishment,
  Entry,
  EntryKind,
  Profile,
  ResumeConfiguration,
  ResumeSummary,
  Skill,
  Snapshot,
  Variant,
} from '../core/types.ts';
import { transaction, type Db } from './database.ts';
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
import { readConfiguration, readProfile, readSnapshot, rowToEntry } from './snapshot.ts';

/** Test-harness and seed-loader option: create a record with a fixed ID. */
export interface CreateOptions {
  id?: string;
}

const nullable = (v: unknown) => (v === undefined ? null : (v as string));

export class Library {
  readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  snapshot(): Snapshot {
    return readSnapshot(this.db);
  }

  private newId(opts: CreateOptions | undefined, table: string): string {
    const id = opts?.id === undefined ? randomUUID() : checkId(opts.id, 'id');
    if (this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
      throw invalidInput(`id ${id} already exists`);
    }
    return id;
  }

  // ---- Profile (FR-01, FR-01a) -------------------------------------------

  getProfile(): Profile | null {
    return readProfile(this.db);
  }

  /** Replace or create. Returns whether the profile was created (201) or replaced (200). */
  putProfile(body: unknown): { created: boolean; profile: Profile } {
    const p = build(body, PROFILE_RULES, 'profile');
    return transaction(this.db, () => {
      const created = readProfile(this.db) === null;
      this.writeProfile(p);
      return { created, profile: readProfile(this.db) as Profile };
    });
  }

  patchProfile(patch: unknown): Profile {
    return transaction(this.db, () => {
      const current = readProfile(this.db);
      if (!current) throw new ServiceError('PROFILE_REQUIRED', 'Set your name in the profile before editing it');
      const p = build(patch, PROFILE_RULES, 'profile', { ...current });
      this.writeProfile(p);
      return readProfile(this.db) as Profile;
    });
  }

  private writeProfile(p: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT INTO profile (id, name, label, email, phone, url, education_json) VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, label = excluded.label, email = excluded.email,
           phone = excluded.phone, url = excluded.url, education_json = excluded.education_json`,
      )
      .run(
        p.name as string,
        nullable(p.label),
        nullable(p.email),
        nullable(p.phone),
        nullable(p.url),
        JSON.stringify(p.education ?? []),
      );
  }

  // ---- Entries: experiences (work) and projects ----------------------------

  getEntry(kind: EntryKind, id: string): Entry {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ? AND kind = ?').get(id, kind);
    if (!row) throw notFound(`${kind === 'work' ? 'experience' : 'project'} ${id} does not exist`);
    return rowToEntry(row as Record<string, string>);
  }

  createEntry(kind: EntryKind, body: unknown, opts?: CreateOptions): Entry {
    const rules = kind === 'work' ? WORK_RULES : PROJECT_RULES;
    const e = build(body, rules, kind === 'work' ? 'experience' : 'project');
    checkDates(e);
    return transaction(this.db, () => {
      const id = this.newId(opts, 'entries');
      this.db
        .prepare(
          `INSERT INTO entries (id, kind, name, role_title, location, url, start_date, end_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, kind, e.name as string, nullable(e.position), nullable(e.location), nullable(e.url),
          nullable(e.startDate), nullable(e.endDate));
      return this.getEntry(kind, id);
    });
  }

  patchEntry(kind: EntryKind, id: string, patch: unknown): Entry {
    return transaction(this.db, () => {
      const { id: _id, kind: _kind, ...current } = this.getEntry(kind, id);
      const rules = kind === 'work' ? WORK_RULES : PROJECT_RULES;
      const e = build(patch, rules, kind === 'work' ? 'experience' : 'project', current);
      checkDates(e);
      this.db
        .prepare(
          `UPDATE entries SET name = ?, role_title = ?, location = ?, url = ?, start_date = ?, end_date = ?
           WHERE id = ? AND kind = ?`,
        )
        .run(e.name as string, nullable(e.position), nullable(e.location), nullable(e.url),
          nullable(e.startDate), nullable(e.endDate), id, kind);
      return this.getEntry(kind, id);
    });
  }

  // ---- Accomplishments and wording variants ---------------------------------

  createAccomplishment(kind: EntryKind, entryId: string, body: unknown, opts?: CreateOptions): Accomplishment {
    const a = build(body, ACCOMPLISHMENT_RULES, 'accomplishment');
    return transaction(this.db, () => {
      this.getEntry(kind, entryId);
      const id = this.newId(opts, 'accomplishments');
      this.db
        .prepare('INSERT INTO accomplishments (id, entry_id, fact, tags_json) VALUES (?, ?, ?, ?)')
        .run(id, entryId, a.fact as string, JSON.stringify(a.tags ?? []));
      return this.getAccomplishment(id);
    });
  }

  getAccomplishment(id: string): Accomplishment {
    const a = this.snapshot().accomplishments.get(id);
    if (!a) throw notFound(`accomplishment ${id} does not exist`);
    return a;
  }

  patchAccomplishment(id: string, patch: unknown): Accomplishment {
    return transaction(this.db, () => {
      const { id: _id, entryId: _entryId, ...current } = this.getAccomplishment(id);
      const a = build(patch, ACCOMPLISHMENT_RULES, 'accomplishment', current);
      this.db
        .prepare('UPDATE accomplishments SET fact = ?, tags_json = ? WHERE id = ?')
        .run(a.fact as string, JSON.stringify(a.tags ?? []), id);
      return this.getAccomplishment(id);
    });
  }

  createVariant(accomplishmentId: string, body: unknown, opts?: CreateOptions): Variant {
    const v = build(body, VARIANT_RULES, 'variant');
    return transaction(this.db, () => {
      this.getAccomplishment(accomplishmentId);
      const id = this.newId(opts, 'variants');
      this.db
        .prepare('INSERT INTO variants (id, accomplishment_id, text) VALUES (?, ?, ?)')
        .run(id, accomplishmentId, v.text as string);
      return this.getVariant(id);
    });
  }

  getVariant(id: string): Variant {
    const v = this.snapshot().variants.get(id);
    if (!v) throw notFound(`variant ${id} does not exist`);
    return v;
  }

  patchVariant(id: string, patch: unknown): Variant {
    return transaction(this.db, () => {
      const { id: _id, accomplishmentId: _parent, ...current } = this.getVariant(id);
      const v = build(patch, VARIANT_RULES, 'variant', current);
      this.db.prepare('UPDATE variants SET text = ? WHERE id = ?').run(v.text as string, id);
      return this.getVariant(id);
    });
  }

  // ---- Skills ----------------------------------------------------------------

  createSkill(body: unknown, opts?: CreateOptions): Skill {
    const s = build(body, SKILL_RULES, 'skill');
    return transaction(this.db, () => {
      const id = this.newId(opts, 'skills');
      this.db
        .prepare('INSERT INTO skills (id, name, level, keywords_json) VALUES (?, ?, ?, ?)')
        .run(id, s.name as string, nullable(s.level), JSON.stringify(s.keywords ?? []));
      return this.getSkill(id);
    });
  }

  getSkill(id: string): Skill {
    const s = this.snapshot().skills.get(id);
    if (!s) throw notFound(`skill ${id} does not exist`);
    return s;
  }

  patchSkill(id: string, patch: unknown): Skill {
    return transaction(this.db, () => {
      const { id: _id, ...current } = this.getSkill(id);
      const s = build(patch, SKILL_RULES, 'skill', current);
      this.db
        .prepare('UPDATE skills SET name = ?, level = ?, keywords_json = ? WHERE id = ?')
        .run(s.name as string, nullable(s.level), JSON.stringify(s.keywords ?? []), id);
      return this.getSkill(id);
    });
  }

  // ---- Restricted deletion (FR-03) -------------------------------------------

  /** Impact of deleting a record (FR-04, delete form); NOT_FOUND if it does not exist. */
  deleteImpact(type: DeletableType, id: string): Impact {
    return deleteImpact(this.snapshot(), { op: 'delete', type, id });
  }

  /**
   * Delete a library record if no saved resume references it. The check and
   * the delete run in one IMMEDIATE transaction; a blocked delete throws
   * RECORD_IN_USE and changes nothing.
   */
  deleteRecord(type: DeletableType, id: string): void {
    transaction(this.db, () => {
      const impact = deleteImpact(this.snapshot(), { op: 'delete', type, id });
      if (impact.blocked) throw recordInUse(impact);
      const table =
        type === 'variant' ? 'variants' : type === 'accomplishment' ? 'accomplishments' : type === 'skill' ? 'skills' : 'entries';
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    });
  }

  // ---- Resumes and configurations (FR-02) -----------------------------------

  listResumes(): ResumeSummary[] {
    return (this.db.prepare('SELECT id, name FROM resumes ORDER BY name, id').all() as { id: string; name: string }[]).map(
      (r) => ({ id: r.id, name: r.name }),
    );
  }

  createResume(body: unknown, opts?: CreateOptions): ResumeConfiguration {
    const r = build(body, { name: { required: true, check: text } }, 'resume');
    return transaction(this.db, () => {
      const id = this.newId(opts, 'resumes');
      this.db.prepare('INSERT INTO resumes (id, name) VALUES (?, ?)').run(id, r.name as string);
      return this.getResume(id);
    });
  }

  getResume(id: string): ResumeConfiguration {
    const row = this.db.prepare('SELECT name FROM resumes WHERE id = ?').get(id) as { name: string } | undefined;
    if (!row) throw notFound(`resume ${id} does not exist`);
    return readConfiguration(this.db, id, row.name);
  }

  /**
   * Replace a resume's name and whole configuration. The payload is validated
   * against a consistent snapshot first; then that resume's selection rows are
   * deleted and re-inserted with contiguous positions derived from array order.
   */
  saveResume(id: string, payload: unknown): ResumeConfiguration {
    return transaction(this.db, () => {
      this.getResume(id);
      const config = validateConfiguration(this.snapshot(), payload);
      this.db.prepare('UPDATE resumes SET name = ? WHERE id = ?').run(config.name, id);
      this.db.prepare('DELETE FROM resume_skills WHERE resume_id = ?').run(id);
      this.db.prepare('DELETE FROM resume_entries WHERE resume_id = ?').run(id); // cascades bullets
      const insertEntry = this.db.prepare(
        'INSERT INTO resume_entries (resume_id, entry_id, kind, sort_index) VALUES (?, ?, ?, ?)',
      );
      const insertBullet = this.db.prepare(
        `INSERT INTO resume_bullets (resume_id, entry_id, accomplishment_id, variant_id, sort_index)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const sections: [EntryKind, { entryId: string; bullets: { accomplishmentId: string; variantId: string }[] }[]][] = [
        ['work', config.experiences.map((s) => ({ entryId: s.experienceId, bullets: s.bullets }))],
        ['project', config.projects.map((s) => ({ entryId: s.projectId, bullets: s.bullets }))],
      ];
      for (const [kind, selections] of sections) {
        selections.forEach((sel, i) => {
          insertEntry.run(id, sel.entryId, kind, i);
          sel.bullets.forEach((b, j) => insertBullet.run(id, sel.entryId, b.accomplishmentId, b.variantId, j));
        });
      }
      const insertSkill = this.db.prepare('INSERT INTO resume_skills (resume_id, skill_id, sort_index) VALUES (?, ?, ?)');
      config.skills.forEach((skillId, i) => insertSkill.run(id, skillId, i));
      return this.getResume(id);
    });
  }

  /** Deleting a resume removes only its configuration rows (FR-02). */
  deleteResume(id: string): void {
    transaction(this.db, () => {
      this.getResume(id);
      this.db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
    });
  }
}
