// Domain model (SPEC §4). Plain data shared by the database layer, the
// service layer and pure core functions.

export type EntryKind = 'work' | 'project';

export interface EducationItem {
  institution: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
}

export interface Profile {
  name: string;
  label?: string;
  email?: string;
  phone?: string;
  url?: string;
  education: EducationItem[];
}

export interface Entry {
  id: string;
  kind: EntryKind;
  name: string;
  /** Work only (required for work). Exported as `position`. */
  position?: string;
  location?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
}

export interface Accomplishment {
  id: string;
  entryId: string;
  fact: string;
  tags: string[];
}

/** A wording variant of an accomplishment (D15). */
export interface Variant {
  id: string;
  accomplishmentId: string;
  text: string;
}

export interface Skill {
  id: string;
  name: string;
  level?: string;
  keywords: string[];
}

export interface ResumeSummary {
  id: string;
  name: string;
}

export interface BulletRef {
  accomplishmentId: string;
  variantId: string;
}

export interface ExperienceSelection {
  experienceId: string;
  bullets: BulletRef[];
}

export interface ProjectSelection {
  projectId: string;
  bullets: BulletRef[];
}

/** A saved resume configuration: IDs and order only, never copied text. */
export interface ResumeConfiguration {
  id: string;
  name: string;
  experiences: ExperienceSelection[];
  projects: ProjectSelection[];
  skills: string[];
}

/** A consistent read of the whole database, input to pure core functions. */
export interface Snapshot {
  profile: Profile | null;
  entries: Map<string, Entry>;
  accomplishments: Map<string, Accomplishment>;
  variants: Map<string, Variant>;
  skills: Map<string, Skill>;
  resumes: Map<string, ResumeConfiguration>;
  /**
   * Stored selection problems per resume ID: positions not contiguous from
   * zero, or selection rows whose references are broken (e.g. written outside
   * the service layer). The assembler refuses to export these resumes (FR-05
   * step 1); saving the resume repairs them.
   */
  integrityProblems: Map<string, string[]>;
}
