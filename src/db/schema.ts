// SQLite schema (SPEC §4 "Suggested relational structure"). Resume references
// are always RESTRICT; library-internal cascades only run as part of an
// allowed library deletion. The application checks references first (to
// report affected resumes); these constraints are the backstop.

export const SCHEMA_VERSION = 1;

export const DDL = `
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  label TEXT,
  email TEXT,
  phone TEXT,
  url TEXT,
  education_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'project')),
  name TEXT NOT NULL,
  role_title TEXT,
  location TEXT,
  url TEXT,
  start_date TEXT,
  end_date TEXT,
  UNIQUE (id, kind),
  CHECK (kind = 'project' OR role_title IS NOT NULL)
);

CREATE TABLE accomplishments (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (id, entry_id)
);

CREATE TABLE variants (
  id TEXT PRIMARY KEY,
  accomplishment_id TEXT NOT NULL REFERENCES accomplishments (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  UNIQUE (id, accomplishment_id)
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE resume_entries (
  resume_id TEXT NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_index INTEGER NOT NULL CHECK (sort_index >= 0),
  PRIMARY KEY (resume_id, entry_id),
  UNIQUE (resume_id, kind, sort_index),
  FOREIGN KEY (entry_id, kind) REFERENCES entries (id, kind) ON DELETE RESTRICT
);

CREATE TABLE resume_bullets (
  resume_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  accomplishment_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL CHECK (sort_index >= 0),
  PRIMARY KEY (resume_id, accomplishment_id),
  UNIQUE (resume_id, entry_id, sort_index),
  FOREIGN KEY (resume_id, entry_id) REFERENCES resume_entries (resume_id, entry_id) ON DELETE CASCADE,
  FOREIGN KEY (accomplishment_id, entry_id) REFERENCES accomplishments (id, entry_id) ON DELETE RESTRICT,
  FOREIGN KEY (variant_id, accomplishment_id) REFERENCES variants (id, accomplishment_id) ON DELETE RESTRICT
);

CREATE TABLE resume_skills (
  resume_id TEXT NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  sort_index INTEGER NOT NULL CHECK (sort_index >= 0),
  PRIMARY KEY (resume_id, skill_id),
  UNIQUE (resume_id, sort_index)
);
`;

/** Every table, in a fixed order, for whole-database comparisons in tests. */
export const TABLES = [
  'profile',
  'entries',
  'accomplishments',
  'variants',
  'skills',
  'resumes',
  'resume_entries',
  'resume_bullets',
  'resume_skills',
] as const;
