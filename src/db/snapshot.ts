// Read the whole database into a Snapshot (SPEC §3.1 "Read consistency").
// Every query orders explicitly; nothing relies on insertion or ID order.

import type { Db } from './database.ts';
import type {
  Accomplishment,
  EducationItem,
  Entry,
  EntryKind,
  Profile,
  ResumeConfiguration,
  Skill,
  Snapshot,
  Variant,
} from '../core/types.ts';

type Row = Record<string, string | number | null>;

const str = (v: unknown): string => String(v);
const opt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

/** Copy only defined optional fields, so absent values stay absent. */
function withOptional<T extends object>(base: T, optional: Record<string, string | undefined>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(optional)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function readProfile(db: Db): Profile | null {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get() as Row | undefined;
  if (!row) return null;
  return withOptional<Profile>(
    { name: str(row.name), education: JSON.parse(str(row.education_json)) as EducationItem[] },
    { label: opt(row.label), email: opt(row.email), phone: opt(row.phone), url: opt(row.url) },
  );
}

export function rowToEntry(row: Row): Entry {
  return withOptional<Entry>(
    { id: str(row.id), kind: str(row.kind) as EntryKind, name: str(row.name) },
    {
      position: opt(row.role_title),
      location: opt(row.location),
      url: opt(row.url),
      startDate: opt(row.start_date),
      endDate: opt(row.end_date),
    },
  );
}

export function readSnapshot(db: Db): Snapshot {
  const entries = new Map<string, Entry>();
  for (const row of db.prepare('SELECT * FROM entries ORDER BY id').all() as Row[]) {
    const e = rowToEntry(row);
    entries.set(e.id, e);
  }
  const accomplishments = new Map<string, Accomplishment>();
  for (const row of db.prepare('SELECT * FROM accomplishments ORDER BY id').all() as Row[]) {
    accomplishments.set(str(row.id), {
      id: str(row.id),
      entryId: str(row.entry_id),
      fact: str(row.fact),
      tags: JSON.parse(str(row.tags_json)) as string[],
    });
  }
  const variants = new Map<string, Variant>();
  for (const row of db.prepare('SELECT * FROM variants ORDER BY id').all() as Row[]) {
    variants.set(str(row.id), { id: str(row.id), accomplishmentId: str(row.accomplishment_id), text: str(row.text) });
  }
  const skills = new Map<string, Skill>();
  for (const row of db.prepare('SELECT * FROM skills ORDER BY id').all() as Row[]) {
    skills.set(
      str(row.id),
      withOptional<Skill>(
        { id: str(row.id), name: str(row.name), keywords: JSON.parse(str(row.keywords_json)) as string[] },
        { level: opt(row.level) },
      ),
    );
  }
  const resumes = new Map<string, ResumeConfiguration>();
  for (const row of db.prepare('SELECT * FROM resumes ORDER BY id').all() as Row[]) {
    resumes.set(str(row.id), readConfiguration(db, str(row.id), str(row.name)));
  }
  return { profile: readProfile(db), entries, accomplishments, variants, skills, resumes };
}

export function readConfiguration(db: Db, resumeId: string, name: string): ResumeConfiguration {
  const selected = db
    .prepare('SELECT entry_id, kind FROM resume_entries WHERE resume_id = ? ORDER BY kind, sort_index')
    .all(resumeId) as Row[];
  const bulletStmt = db.prepare(
    'SELECT accomplishment_id, variant_id FROM resume_bullets WHERE resume_id = ? AND entry_id = ? ORDER BY sort_index',
  );
  const bulletsOf = (entryId: string) =>
    (bulletStmt.all(resumeId, entryId) as Row[]).map((b) => ({
      accomplishmentId: str(b.accomplishment_id),
      variantId: str(b.variant_id),
    }));
  const skills = (
    db.prepare('SELECT skill_id FROM resume_skills WHERE resume_id = ? ORDER BY sort_index').all(resumeId) as Row[]
  ).map((r) => str(r.skill_id));
  return {
    id: resumeId,
    name,
    experiences: selected
      .filter((r) => r.kind === 'work')
      .map((r) => ({ experienceId: str(r.entry_id), bullets: bulletsOf(str(r.entry_id)) })),
    projects: selected
      .filter((r) => r.kind === 'project')
      .map((r) => ({ projectId: str(r.entry_id), bullets: bulletsOf(str(r.entry_id)) })),
    skills,
  };
}
