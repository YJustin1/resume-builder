// Library view (SPEC §6 view 1, FR-01, FR-01a, FR-03): the shared records
// every resume draws from. Edits to rendered shared fields go through the
// impact prompt; facts and tags are internal and save directly; deletes are
// checked against every saved resume.

import { useState, type ReactNode } from 'react';
import { api, type AccomplishmentView, type EntryKind, type EntryView, type LibraryData, type Profile, type SkillView, type VariantView } from './api.ts';
import {
  createBody,
  patchBody,
  ProblemBox,
  problemOf,
  TextField,
  useCheckedDelete,
  useSharedSave,
  valuesOf,
  type FormValues,
  type Problem,
} from './ui.tsx';

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
}

const DATE_HINT = 'YYYY, YYYY-MM or YYYY-MM-DD';
const WORK_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Organization', required: true },
  { key: 'position', label: 'Position', required: true },
  { key: 'location', label: 'Location' },
  { key: 'url', label: 'URL', hint: 'http:// or https://' },
  { key: 'startDate', label: 'Start date', hint: DATE_HINT },
  { key: 'endDate', label: 'End date', hint: DATE_HINT },
];
const PROJECT_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Project name', required: true },
  { key: 'url', label: 'URL', hint: 'http:// or https://' },
  { key: 'startDate', label: 'Start date', hint: DATE_HINT },
  { key: 'endDate', label: 'End date', hint: DATE_HINT },
];
const ACCOMPLISHMENT_FIELDS: FieldDef[] = [
  { key: 'fact', label: 'Fact (what actually happened; internal)', required: true, wide: true },
  { key: 'tags', label: 'Tags (one per line; internal)', wide: true, multiline: true },
];
const VARIANT_FIELDS: FieldDef[] = [{ key: 'text', label: 'Wording (printed as a bullet)', required: true, wide: true }];
const SKILL_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Skill', required: true },
  { key: 'level', label: 'Level' },
  { key: 'keywords', label: 'Keywords (one per line)', wide: true, multiline: true },
];
const PROFILE_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'label', label: 'Headline' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'url', label: 'Website', hint: 'http:// or https://' },
];
const EDUCATION_FIELDS: FieldDef[] = [
  { key: 'institution', label: 'Institution', required: true },
  { key: 'studyType', label: 'Degree' },
  { key: 'area', label: 'Area' },
  { key: 'startDate', label: 'Start date', hint: DATE_HINT },
  { key: 'endDate', label: 'End date', hint: DATE_HINT },
];
const keys = (fields: FieldDef[]) => fields.map((f) => f.key);
const LISTS = ['tags', 'keywords'];

// ---------------------------------------------------------------- generic form

function RecordForm(props: {
  fields: FieldDef[];
  initial: FormValues;
  submitLabel: string;
  /** Resolve false to keep the form open (e.g. the user cancelled an impact prompt). */
  onSubmit: (values: FormValues) => Promise<boolean>;
  onCancel: () => void;
  legend: string;
}) {
  const [values, setValues] = useState(props.initial);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="record-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem(null);
        try {
          if (await props.onSubmit(values)) props.onCancel();
        } catch (error) {
          setProblem(problemOf(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <legend>{props.legend}</legend>
        <div className="fields">
          {props.fields.map((f) => (
            <TextField
              key={f.key}
              label={f.label}
              required={f.required}
              hint={f.hint}
              wide={f.wide}
              multiline={f.multiline}
              value={values[f.key] ?? ''}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
            />
          ))}
        </div>
        <ProblemBox problem={problem} />
        <div className="actions">
          <button type="submit" className="primary">
            {props.submitLabel}
          </button>
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** A button that reveals a create form. */
function AddRecord(props: { label: string; fields: FieldDef[]; create: (body: Record<string, unknown>) => Promise<unknown>; refresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="add" onClick={() => setOpen(true)}>
        + {props.label}
      </button>
    );
  return (
    <RecordForm
      legend={props.label}
      fields={props.fields}
      initial={Object.fromEntries(keys(props.fields).map((k) => [k, '']))}
      submitLabel="Create"
      onCancel={() => setOpen(false)}
      onSubmit={async (values) => {
        await props.create(createBody(values, LISTS));
        await props.refresh();
        return true;
      }}
    />
  );
}

function Usage({ n }: { n: number }) {
  return <span className={n > 0 ? 'usage used' : 'usage'}>{n > 0 ? `Used by ${n} ${n === 1 ? 'resume' : 'resumes'}` : 'Unused'}</span>;
}

/** Edit and Delete controls plus the edit form and any problem, for one shared record. */
function RecordControls(props: {
  name: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onDelete: () => Promise<void>;
  children?: ReactNode;
  problem: Problem | null;
}) {
  return (
    <>
      <span className="controls">
        <button type="button" aria-label={`Edit ${props.name}`} onClick={() => props.setEditing(!props.editing)}>
          Edit
        </button>
        <button type="button" className="danger" aria-label={`Delete ${props.name}`} onClick={() => void props.onDelete()}>
          Delete
        </button>
      </span>
      {props.editing && props.children}
      <ProblemBox problem={props.problem} />
    </>
  );
}

/** Shared-record editing state: the edit toggle, problems, and the checked delete. */
function useRecord(refresh: () => Promise<void>) {
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const checkedDelete = useCheckedDelete();
  const sharedSave = useSharedSave();
  const remove = async (...args: Parameters<typeof checkedDelete>) => {
    setProblem(null);
    try {
      if (await checkedDelete(...args)) await refresh();
    } catch (error) {
      setProblem(problemOf(error));
    }
  };
  return { editing, setEditing, problem, remove, sharedSave };
}

// ---------------------------------------------------------------- profile and education

/**
 * Remounted (keyed) whenever the stored profile changes, so the form starts
 * from saved values; the saved notice therefore lives in the parent.
 */
function ProfileSection({ profile, refresh, notice, onNotice }: { profile: Profile | null; refresh: () => Promise<void>; notice: string; onNotice: (n: string) => void }) {
  const sharedSave = useSharedSave();
  const [values, setValues] = useState<FormValues>(() => valuesOf(profile ?? {}, keys(PROFILE_FIELDS)));
  const [education, setEducation] = useState<FormValues[]>(() => (profile?.education ?? []).map((e) => valuesOf(e, keys(EDUCATION_FIELDS))));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [status, setStatus] = useState('');
  // Locked from Save until the refresh: a refresh remounts this section, so an
  // edit made while the save is pending would be lost (Codex Phase 4 review, 11).
  const [busy, setBusy] = useState(false);

  if (!profile) {
    return (
      <section aria-labelledby="profile-h" className="first-run">
        <h2 id="profile-h">Welcome: start with your profile</h2>
        <p>Your name is required before any resume can be previewed or exported. Contact details are optional. You can add library records and resumes before or after this.</p>
        <RecordForm
          legend="Profile"
          fields={PROFILE_FIELDS}
          initial={values}
          submitLabel="Create profile"
          onCancel={() => setValues(valuesOf({}, keys(PROFILE_FIELDS)))}
          onSubmit={async (v) => {
            await api.putProfile({ ...createBody(v), education: [] });
            await refresh();
            return false;
          }}
        />
      </section>
    );
  }

  const originalEducation = profile.education.map((e) => createBody(valuesOf(e, keys(EDUCATION_FIELDS))));
  const save = async () => {
    setProblem(null);
    setStatus('');
    onNotice('');
    const patch = patchBody(valuesOf(profile, keys(PROFILE_FIELDS)), values);
    const nextEducation = education.map((e) => createBody(e));
    if (JSON.stringify(nextEducation) !== JSON.stringify(originalEducation)) patch.education = nextEducation;
    if (Object.keys(patch).length === 0) return setStatus('No changes to save.');
    setBusy(true);
    try {
      if (await sharedSave({ op: 'edit', type: 'profile', patch }, 'your profile', () => api.patchProfile(patch))) {
        onNotice('Profile saved.');
        await refresh();
      }
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  };
  const moveEdu = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= education.length) return;
    const next = [...education];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setEducation(next);
  };

  return (
    <section aria-labelledby="profile-h">
      <h2 id="profile-h">Profile and education</h2>
      <p className="muted">Printed on every resume.</p>
      <form
        className="record-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="plain" disabled={busy} aria-busy={busy}>
        <div className="fields">
          {PROFILE_FIELDS.map((f) => (
            <TextField key={f.key} label={f.label} required={f.required} hint={f.hint} value={values[f.key] ?? ''} onChange={(v) => setValues({ ...values, [f.key]: v })} />
          ))}
        </div>
        <h3>Education</h3>
        {education.length === 0 && <p className="blank">No education yet. Use “Add education” to add a school.</p>}
        {education.map((item, i) => (
          <fieldset key={i} className="education">
            <legend>Education {i + 1}</legend>
            <div className="fields">
              {EDUCATION_FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  hint={f.hint}
                  value={item[f.key] ?? ''}
                  onChange={(v) => setEducation(education.map((e, j) => (j === i ? { ...e, [f.key]: v } : e)))}
                />
              ))}
            </div>
            <span className="controls">
              <button type="button" aria-label={`Move education ${i + 1} up`} disabled={i === 0} onClick={() => moveEdu(i, -1)}>
                ↑
              </button>
              <button type="button" aria-label={`Move education ${i + 1} down`} disabled={i === education.length - 1} onClick={() => moveEdu(i, 1)}>
                ↓
              </button>
              <button type="button" className="danger" onClick={() => setEducation(education.filter((_, j) => j !== i))}>
                Remove education {i + 1}
              </button>
            </span>
          </fieldset>
        ))}
        <button type="button" className="add" onClick={() => setEducation([...education, valuesOf({}, keys(EDUCATION_FIELDS))])}>
          + Add education
        </button>
        <ProblemBox problem={problem} />
        <div className="actions">
          <button type="submit" className="primary">
            Save profile
          </button>
          <span role="status" className="muted">
            {busy ? 'Saving…' : status || notice}
          </span>
        </div>
        </fieldset>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- variants and accomplishments

function VariantItem({ variant, refresh }: { variant: VariantView; refresh: () => Promise<void> }) {
  const r = useRecord(refresh);
  const label = variant.text.length > 50 ? `${variant.text.slice(0, 47)}…` : variant.text;
  return (
    <li className="variant">
      <span className="wording">{variant.text}</span> <Usage n={variant.usage} />
      <RecordControls
        name={`wording “${label}”`}
        editing={r.editing}
        setEditing={r.setEditing}
        problem={r.problem}
        onDelete={() => r.remove({ op: 'delete', type: 'variant', id: variant.id }, label, '', () => api.deleteVariant(variant.id))}
      >
        <RecordForm
          legend="Edit wording (shared)"
          fields={VARIANT_FIELDS}
          initial={valuesOf(variant, ['text'])}
          submitLabel="Save wording"
          onCancel={() => r.setEditing(false)}
          onSubmit={async (v) => {
            const patch = patchBody(valuesOf(variant, ['text']), v);
            if (Object.keys(patch).length === 0) return true;
            const saved = await r.sharedSave({ op: 'edit', type: 'variant', id: variant.id, patch }, `wording “${label}”`, () => api.patchVariant(variant.id, patch));
            if (saved) await refresh();
            return saved;
          }}
        />
      </RecordControls>
    </li>
  );
}

function AccomplishmentItem({ accomplishment: a, refresh }: { accomplishment: AccomplishmentView; refresh: () => Promise<void> }) {
  const r = useRecord(refresh);
  const label = a.fact.length > 50 ? `${a.fact.slice(0, 47)}…` : a.fact;
  return (
    <li className="accomplishment">
      <div className="fact-line">
        <span className="tag-internal">Fact</span> <span>{a.fact}</span> <Usage n={a.usage} />
        {a.tags.length > 0 && (
          <span className="tags" aria-label="Tags (internal)">
            {a.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </span>
        )}
        <RecordControls
          name={`accomplishment “${label}”`}
          editing={r.editing}
          setEditing={r.setEditing}
          problem={r.problem}
          onDelete={() =>
            r.remove(
              { op: 'delete', type: 'accomplishment', id: a.id },
              label,
              a.variants.length > 0 ? `Its ${a.variants.length === 1 ? 'wording is' : `${a.variants.length} wordings are`} deleted with it.` : '',
              () => api.deleteAccomplishment(a.id),
            )
          }
        >
          <RecordForm
            legend="Edit fact and tags (internal, never exported)"
            fields={ACCOMPLISHMENT_FIELDS}
            initial={valuesOf(a, keys(ACCOMPLISHMENT_FIELDS), LISTS)}
            submitLabel="Save"
            onCancel={() => r.setEditing(false)}
            onSubmit={async (v) => {
              // Facts and tags are never exported: no resume changes, so no impact prompt (FR-01).
              const patch = patchBody(valuesOf(a, keys(ACCOMPLISHMENT_FIELDS), LISTS), v, LISTS);
              if (Object.keys(patch).length > 0) {
                await api.patchAccomplishment(a.id, patch);
                await refresh();
              }
              return true;
            }}
          />
        </RecordControls>
      </div>
      {a.variants.length === 0 ? (
        <p className="blank">No wording yet. This accomplishment can’t be selected in a resume until you add one.</p>
      ) : (
        <ul className="variants" aria-label={`Wordings for “${label}”`}>
          {a.variants.map((v) => (
            <VariantItem key={v.id} variant={v} refresh={refresh} />
          ))}
        </ul>
      )}
      <AddRecord label={`Add wording for “${label}”`} fields={VARIANT_FIELDS} create={(body) => api.createVariant(a.id, body)} refresh={refresh} />
    </li>
  );
}

// ---------------------------------------------------------------- entries

const dates = (e: { startDate?: string | undefined; endDate?: string | undefined }) =>
  e.startDate || e.endDate ? `${e.startDate ?? '?'} – ${e.endDate ?? 'present'}` : '';

function EntryCard({ entry, kind, refresh }: { entry: EntryView; kind: EntryKind; refresh: () => Promise<void> }) {
  const r = useRecord(refresh);
  const fields = kind === 'work' ? WORK_FIELDS : PROJECT_FIELDS;
  const type = kind === 'work' ? 'experience' : 'project';
  const title = entry.position ? `${entry.position}, ${entry.name}` : entry.name;
  const nested = entry.accomplishments.reduce((n, a) => n + 1 + a.variants.length, 0);
  return (
    <article className="card" aria-label={title}>
      <header>
        <h3>{title}</h3>
        <span className="muted">{[dates(entry), entry.location].filter(Boolean).join(' · ')}</span> <Usage n={entry.usage} />
        <RecordControls
          name={entry.name}
          editing={r.editing}
          setEditing={r.setEditing}
          problem={r.problem}
          onDelete={() =>
            r.remove({ op: 'delete', type, id: entry.id }, entry.name, nested > 0 ? 'Its accomplishments and wordings are deleted with it.' : '', () =>
              api.deleteEntry(kind, entry.id),
            )
          }
        >
          <RecordForm
            legend={`Edit ${kind === 'work' ? 'work entry' : 'project'} (shared)`}
            fields={fields}
            initial={valuesOf(entry, keys(fields))}
            submitLabel="Save"
            onCancel={() => r.setEditing(false)}
            onSubmit={async (v) => {
              const patch = patchBody(valuesOf(entry, keys(fields)), v);
              if (Object.keys(patch).length === 0) return true;
              const saved = await r.sharedSave({ op: 'edit', type, id: entry.id, patch }, entry.name, () => api.patchEntry(kind, entry.id, patch));
              if (saved) await refresh();
              return saved;
            }}
          />
        </RecordControls>
      </header>
      <h4>Accomplishments</h4>
      {entry.accomplishments.length === 0 && <p className="blank">No accomplishments yet. Add the underlying fact first, then one or more wordings for it.</p>}
      <ul className="accomplishments">
        {entry.accomplishments.map((a) => (
          <AccomplishmentItem key={a.id} accomplishment={a} refresh={refresh} />
        ))}
      </ul>
      <AddRecord label={`Add accomplishment to ${entry.name}`} fields={ACCOMPLISHMENT_FIELDS} create={(body) => api.createAccomplishment(kind, entry.id, body)} refresh={refresh} />
    </article>
  );
}

function EntriesSection({ kind, entries, refresh }: { kind: EntryKind; entries: EntryView[]; refresh: () => Promise<void> }) {
  const noun = kind === 'work' ? 'work entry' : 'project';
  return (
    <section aria-labelledby={`${kind}-h`}>
      <h2 id={`${kind}-h`}>{kind === 'work' ? 'Work entries' : 'Projects'}</h2>
      {entries.length === 0 && <p className="blank">No {kind === 'work' ? 'work entries' : 'projects'} yet. Use “Add {noun}” to create one.</p>}
      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} kind={kind} refresh={refresh} />
      ))}
      <AddRecord label={`Add ${noun}`} fields={kind === 'work' ? WORK_FIELDS : PROJECT_FIELDS} create={(body) => api.createEntry(kind, body)} refresh={refresh} />
    </section>
  );
}

// ---------------------------------------------------------------- skills

function SkillItem({ skill, refresh }: { skill: SkillView; refresh: () => Promise<void> }) {
  const r = useRecord(refresh);
  return (
    <li className="card skill">
      <strong>{skill.name}</strong>
      {skill.level && <span className="muted"> · {skill.level}</span>}
      {skill.keywords.length > 0 && <span className="muted"> · {skill.keywords.join(', ')}</span>} <Usage n={skill.usage} />
      <RecordControls
        name={`skill ${skill.name}`}
        editing={r.editing}
        setEditing={r.setEditing}
        problem={r.problem}
        onDelete={() => r.remove({ op: 'delete', type: 'skill', id: skill.id }, skill.name, '', () => api.deleteSkill(skill.id))}
      >
        <RecordForm
          legend="Edit skill (shared)"
          fields={SKILL_FIELDS}
          initial={valuesOf(skill, keys(SKILL_FIELDS), LISTS)}
          submitLabel="Save"
          onCancel={() => r.setEditing(false)}
          onSubmit={async (v) => {
            const patch = patchBody(valuesOf(skill, keys(SKILL_FIELDS), LISTS), v, LISTS);
            if (Object.keys(patch).length === 0) return true;
            const saved = await r.sharedSave({ op: 'edit', type: 'skill', id: skill.id, patch }, `skill ${skill.name}`, () => api.patchSkill(skill.id, patch));
            if (saved) await refresh();
            return saved;
          }}
        />
      </RecordControls>
    </li>
  );
}

function SkillsSection({ skills, refresh }: { skills: SkillView[]; refresh: () => Promise<void> }) {
  return (
    <section aria-labelledby="skills-h">
      <h2 id="skills-h">Skills</h2>
      {skills.length === 0 && <p className="blank">No skills yet. Use “Add skill” to create one.</p>}
      <ul className="skills">
        {skills.map((s) => (
          <SkillItem key={s.id} skill={s} refresh={refresh} />
        ))}
      </ul>
      <AddRecord label="Add skill" fields={SKILL_FIELDS} create={(body) => api.createSkill(body)} refresh={refresh} />
    </section>
  );
}

// ---------------------------------------------------------------- view

export function LibraryView({ library, refresh }: { library: LibraryData; refresh: () => Promise<void> }) {
  const [profileNotice, setProfileNotice] = useState('');
  return (
    <div className="library">
      <div className="scope shared" role="note">
        <strong>Shared library</strong> — edits change every resume that uses the record. Before a change reaches a saved resume, you’ll see which ones.
      </div>
      <ProfileSection key={JSON.stringify(library.profile)} profile={library.profile} refresh={refresh} notice={profileNotice} onNotice={setProfileNotice} />
      <EntriesSection kind="work" entries={library.experiences} refresh={refresh} />
      <EntriesSection kind="project" entries={library.projects} refresh={refresh} />
      <SkillsSection skills={library.skills} refresh={refresh} />
    </div>
  );
}
