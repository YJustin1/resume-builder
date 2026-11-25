// Resume view (SPEC §6 view 2, FR-02, FR-06): pick entries, bullets, wording
// and skills for one resume from the shared library. Every change here is
// local to the draft until Save, and Save affects only this resume.

import { useEffect, useRef, useState } from 'react';
import { api, type EntryView, type LibraryData, type PdfExport, type ResumeConfiguration } from './api.ts';
import {
  addBullet,
  addEntry,
  addSkill,
  addableAccomplishments,
  draftProblems,
  entriesFor,
  fromConfiguration,
  moveBullet,
  moveEntry,
  moveSkill,
  removeBullet,
  removeEntry,
  removeSkill,
  sameDraft,
  setVariant,
  toPayload,
  type Draft,
  type SectionKey,
  type SelectionDraft,
} from './draft.ts';
import { ProblemBox, problemOf, usePrompt, type Problem } from './ui.tsx';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function MoveButtons({ label, index, count, onMove }: { label: string; index: number; count: number; onMove: (delta: -1 | 1) => void }) {
  return (
    <>
      <button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button type="button" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
        ↓
      </button>
    </>
  );
}

// ---------------------------------------------------------------- bullets and entries

function AddBullet({ entry, selection, onAdd }: { entry: EntryView; selection: SelectionDraft; onAdd: (accomplishmentId: string, variantId: string) => void }) {
  const [accomplishmentId, setAccomplishmentId] = useState('');
  const [variantId, setVariantId] = useState('');
  const addable = addableAccomplishments(entry, selection);
  const without = entry.accomplishments.filter((a) => a.variants.length === 0);
  const chosen = addable.find((a) => a.id === accomplishmentId);
  if (addable.length === 0 && without.length === 0) return null;
  return (
    <div className="add-bullet">
      <label className="field">
        <span>Add a bullet to {entry.name}</span>
        <select
          value={accomplishmentId}
          onChange={(e) => {
            setAccomplishmentId(e.target.value);
            setVariantId('');
          }}
        >
          <option value="">Choose an accomplishment…</option>
          {addable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fact}
            </option>
          ))}
          {without.map((a) => (
            <option key={a.id} value={a.id} disabled>
              {a.fact} (no wording yet)
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <label className="field">
          <span>Wording for the new bullet</span>
          <select value={variantId} onChange={(e) => setVariantId(e.target.value)}>
            <option value="">Choose a wording…</option>
            {chosen.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.text}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={!chosen || variantId === ''}
        onClick={() => {
          onAdd(accomplishmentId, variantId);
          setAccomplishmentId('');
          setVariantId('');
        }}
      >
        Add bullet
      </button>
    </div>
  );
}

function SectionEditor({ library, sectionKey, draft, setDraft }: { library: LibraryData; sectionKey: SectionKey; draft: Draft; setDraft: (d: Draft) => void }) {
  const [toAdd, setToAdd] = useState('');
  const entries = entriesFor(library, sectionKey);
  const selections = draft[sectionKey];
  const unselected = entries.filter((e) => !selections.some((s) => s.entryId === e.id));
  const noun = sectionKey === 'work' ? 'work entry' : 'project';
  return (
    <section aria-labelledby={`sel-${sectionKey}`}>
      <h3 id={`sel-${sectionKey}`}>{sectionKey === 'work' ? 'Work' : 'Projects'}</h3>
      {selections.length === 0 && (
        <p className="blank">
          No {sectionKey === 'work' ? 'work entries' : 'projects'} selected.{' '}
          {entries.length === 0 ? `Create one in the Library first.` : `Choose one below and press “Add ${noun}”.`}
        </p>
      )}
      <ol className="selections">
        {selections.map((sel, i) => {
          const entry = entries.find((e) => e.id === sel.entryId);
          const title = entry ? (entry.position ? `${entry.position}, ${entry.name}` : entry.name) : `Missing ${noun} ${sel.entryId}`;
          return (
            <li key={sel.entryId} className="card selection">
              <div className="row">
                <strong>{title}</strong>
                <span className="controls">
                  <MoveButtons label={title} index={i} count={selections.length} onMove={(d) => setDraft(moveEntry(draft, sectionKey, i, d))} />
                  <button type="button" className="danger" aria-label={`Remove ${title} from this resume`} onClick={() => setDraft(removeEntry(draft, sectionKey, i))}>
                    Remove
                  </button>
                </span>
              </div>
              {sel.bullets.length === 0 && <p className="blank">No bullets yet.</p>}
              <ol className="bullets">
                {sel.bullets.map((b, j) => {
                  const a = entry?.accomplishments.find((x) => x.id === b.accomplishmentId);
                  const label = `bullet ${j + 1} of ${entry?.name ?? sel.entryId}`;
                  return (
                    <li key={b.accomplishmentId} className="bullet">
                      <p className="fact">
                        <span className="tag-internal">Fact</span> {a ? a.fact : `Missing accomplishment ${b.accomplishmentId}`}
                      </p>
                      <label className="field wide">
                        <span>Wording for {label}</span>
                        <select value={b.variantId} onChange={(e) => setDraft(setVariant(draft, sectionKey, i, j, e.target.value))} className={b.variantId === '' ? 'needs-choice' : ''}>
                          <option value="" disabled>
                            Choose a wording…
                          </option>
                          {(a?.variants ?? []).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.text}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="controls">
                        <MoveButtons label={label} index={j} count={sel.bullets.length} onMove={(d) => setDraft(moveBullet(draft, sectionKey, i, j, d))} />
                        <button type="button" className="danger" aria-label={`Remove ${label}`} onClick={() => setDraft(removeBullet(draft, sectionKey, i, j))}>
                          Remove
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
              {entry && <AddBullet entry={entry} selection={sel} onAdd={(aid, vid) => setDraft(addBullet(draft, sectionKey, i, aid, vid))} />}
            </li>
          );
        })}
      </ol>
      {unselected.length > 0 && (
        <div className="add-entry">
          <label className="field">
            <span>{sectionKey === 'work' ? 'Work entry to add' : 'Project to add'}</span>
            <select value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              <option value="">Choose…</option>
              {unselected.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.position ? `${e.position}, ${e.name}` : e.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={toAdd === ''}
            onClick={() => {
              setDraft(addEntry(draft, sectionKey, toAdd));
              setToAdd('');
            }}
          >
            Add {noun}
          </button>
        </div>
      )}
    </section>
  );
}

function SkillsEditor({ library, draft, setDraft }: { library: LibraryData; draft: Draft; setDraft: (d: Draft) => void }) {
  const [toAdd, setToAdd] = useState('');
  const unselected = library.skills.filter((s) => !draft.skills.includes(s.id));
  return (
    <section aria-labelledby="sel-skills">
      <h3 id="sel-skills">Skills</h3>
      {draft.skills.length === 0 && <p className="blank">No skills selected.{library.skills.length === 0 ? ' Create one in the Library first.' : ''}</p>}
      <ol className="selections">
        {draft.skills.map((id, i) => {
          const name = library.skills.find((s) => s.id === id)?.name ?? `Missing skill ${id}`;
          return (
            <li key={id} className="row skill-row">
              <span>{name}</span>
              <span className="controls">
                <MoveButtons label={`skill ${name}`} index={i} count={draft.skills.length} onMove={(d) => setDraft(moveSkill(draft, i, d))} />
                <button type="button" className="danger" aria-label={`Remove skill ${name} from this resume`} onClick={() => setDraft(removeSkill(draft, i))}>
                  Remove
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {unselected.length > 0 && (
        <div className="add-entry">
          <label className="field">
            <span>Skill to add</span>
            <select value={toAdd} onChange={(e) => setToAdd(e.target.value)}>
              <option value="">Choose…</option>
              {unselected.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={toAdd === ''}
            onClick={() => {
              setDraft(addSkill(draft, toAdd));
              setToAdd('');
            }}
          >
            Add skill
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- preview and export

/**
 * Preview and export for the saved resume. While a request is pending the
 * parent locks resume switching (onBusy), so its result and any page-count
 * warning appear under the resume that requested it. If the panel is
 * invalidated anyway (a library edit remounts it), the request is aborted:
 * nothing is downloaded and nothing stale is shown (Codex Phase 4 review, 10).
 */
function OutputPanel({ id, dirty, profileMissing, onBusy }: { id: string; dirty: boolean; profileMissing: boolean; onBusy: (busy: boolean) => void }) {
  const [preview, setPreview] = useState(0); // 0 hidden; otherwise a cache-busting counter
  const [pdf, setPdf] = useState<PdfExport | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState('');
  // One controller per mount (StrictMode mounts twice in development).
  const aborter = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    aborter.current = controller;
    return () => {
      controller.abort();
      onBusy(false);
    };
  }, [onBusy]);
  useEffect(() => {
    setPreview(0);
    setPdf(null);
    setProblem(null);
  }, [id, dirty]);

  const run = async (what: string, f: (signal: AbortSignal) => Promise<void>) => {
    const signal = aborter.current!.signal;
    setBusy(what);
    onBusy(true);
    setProblem(null);
    try {
      await f(signal);
    } catch (error) {
      if (!signal.aborted) setProblem(problemOf(error));
    } finally {
      if (!signal.aborted) {
        setBusy('');
        onBusy(false);
      }
    }
  };
  const blocked = dirty || profileMissing;
  return (
    <section aria-labelledby="output-h" className="output">
      <h3 id="output-h">Preview and export</h3>
      {dirty && <p className="note">Save your changes before previewing or exporting. Exports always use the saved resume.</p>}
      {!dirty && profileMissing && <p className="note">Set your name in the profile (Library) before previewing or exporting.</p>}
      <div className="actions">
        <button type="button" disabled={blocked || busy !== ''} onClick={() => (preview ? setPreview(0) : run('preview', async (signal) => (await api.checkPreview(id, signal), setPreview(Date.now()))))}>
          {preview ? 'Hide preview' : 'Preview'}
        </button>
        <button type="button" disabled={blocked || busy !== ''} onClick={() => run('json', async (signal) => download(await api.exportJson(id, signal), `resume-${id}.json`))}>
          Download JSON
        </button>
        <button
          type="button"
          disabled={blocked || busy !== ''}
          onClick={() =>
            run('pdf', async (signal) => {
              setPdf(null);
              const result = await api.exportPdf(id, signal);
              if (signal.aborted) return;
              setPdf(result);
              download(result.blob, `resume-${id}.pdf`);
            })
          }
        >
          {busy === 'pdf' ? 'Rendering PDF…' : 'Download PDF'}
        </button>
      </div>
      <ProblemBox problem={problem} />
      {pdf && (
        <div role="status" className={pdf.overflow ? 'warning' : 'muted'}>
          {pdf.overflow ? (
            <p>
              <strong>Warning: this PDF is {pdf.pageCount} pages long.</strong> It was exported anyway. To fit one page, remove or shorten bullets and export again.
            </p>
          ) : (
            <p>PDF exported: 1 page.</p>
          )}
        </div>
      )}
      {preview > 0 && (
        // No allow-scripts and no allow-same-origin (SPEC §3.5 rule 4); the response carries its own CSP.
        <iframe className="preview" title="Resume preview" sandbox="" src={`${api.previewUrl(id)}?v=${preview}`} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- view

export function ResumesView(props: { library: LibraryData; libraryVersion: number; refresh: () => Promise<void>; onDirtyChange: (dirty: boolean) => void }) {
  const { library, refresh, onDirtyChange } = props;
  const prompt = usePrompt();
  /**
   * A pending save, open, create or delete locks the editor and the resume
   * list, so a late response can never overwrite edits made in the meantime
   * (Codex Phase 4 review, 3). Operations never overlap.
   */
  const [busy, setBusy] = useState('');
  const [outputBusy, setOutputBusy] = useState(false); // a pending preview/export also blocks switching
  const busyRef = useRef(false);
  const isLocked = busy !== '' || outputBusy;
  const locked = async <T,>(what: string, f: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(what);
    try {
      return await f();
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<ResumeConfiguration | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [status, setStatus] = useState('');
  const [newName, setNewName] = useState('');

  const dirty = saved !== null && draft !== null && !sameDraft(fromConfiguration(saved), draft);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async (): Promise<boolean> => {
    if (!saved || !draft) return false;
    setProblem(null);
    setStatus('');
    const problems = draftProblems(draft);
    if (problems.length > 0) {
      setProblem({ message: problems.join(' ') });
      return false;
    }
    const id = saved.id;
    const payload = toPayload(draft);
    const ok = await locked('Saving…', async () => {
      try {
        const result = await api.saveResume(id, payload);
        setSaved(result);
        setDraft(fromConfiguration(result));
        setStatus(`Saved “${result.name}”. Other resumes are unchanged.`);
        await refresh();
        return true;
      } catch (error) {
        setProblem(problemOf(error));
        return false;
      }
    });
    return ok === true;
  };

  /** FR-02: never save silently when switching; ask to save or discard. Returns false to stay. */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await prompt('Unsaved changes', <p>“{draft?.name || saved?.name}” has unsaved changes. Save them before switching?</p>, [
      { value: 'save', label: 'Save', primary: true },
      { value: 'discard', label: 'Discard changes' },
    ]);
    if (choice === 'save') return save();
    return choice === 'discard';
  };

  const open = async (id: string) => {
    if (busyRef.current || id === selectedId || !(await leave())) return;
    setProblem(null);
    setStatus('');
    await locked('Opening…', async () => {
      try {
        const config = await api.getResume(id);
        setSelectedId(id);
        setSaved(config);
        setDraft(fromConfiguration(config));
      } catch (error) {
        setProblem(problemOf(error));
      }
    });
  };

  const create = async () => {
    if (busyRef.current || newName.trim() === '' || !(await leave())) return;
    const name = newName.trim();
    await locked('Creating…', async () => {
      try {
        const config = await api.createResume(name);
        setNewName('');
        await refresh();
        setSelectedId(config.id);
        setSaved(config);
        setDraft(fromConfiguration(config));
        setStatus(`Created “${config.name}”. It starts empty; add entries below.`);
      } catch (error) {
        setProblem(problemOf(error));
      }
    });
  };

  const remove = async () => {
    if (!saved) return;
    const ok = await prompt('Delete resume?', <p>Delete the resume “{saved.name}”? Only its selections are removed; library records stay. This cannot be undone.</p>, [
      { value: 'delete', label: 'Delete resume', primary: true },
    ]);
    if (ok !== 'delete') return;
    const target = saved;
    await locked('Deleting…', async () => {
      try {
        await api.deleteResume(target.id);
        setSelectedId(null);
        setSaved(null);
        setDraft(null);
        setStatus(`Deleted “${target.name}”.`);
        await refresh();
      } catch (error) {
        setProblem(problemOf(error));
      }
    });
  };

  return (
    <div className="resumes">
      <aside aria-labelledby="resume-list-h">
        <h2 id="resume-list-h">Saved resumes</h2>
        {library.resumes.length === 0 && <p className="blank">No resumes yet. Name one below and press “New resume”.</p>}
        <fieldset className="plain" disabled={isLocked}>
        <ul className="resume-list">
          {library.resumes.map((r) => (
            <li key={r.id}>
              <button type="button" aria-current={r.id === selectedId ? 'true' : undefined} onClick={() => void open(r.id)}>
                {r.name}
                {r.id === selectedId && dirty ? ' •' : ''}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="new-resume"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>New resume name</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button type="submit" disabled={newName.trim() === ''}>
            New resume
          </button>
        </form>
        </fieldset>
      </aside>

      <div className="editor">
        <div className="scope local" role="note">
          <strong>This resume only</strong> — selections, order and wording choices here change only the resume you are editing, and only when you save.
        </div>
        <ProblemBox problem={problem} />
        <p role="status" className="muted">
          {busy || status}
        </p>
        {!saved || !draft ? (
          <p className="blank">{library.resumes.length > 0 ? 'Choose a saved resume on the left, or create a new one.' : 'Create a resume on the left to start.'}</p>
        ) : (
          <fieldset className="plain" disabled={busy !== ''} aria-busy={isLocked}>
            <div className="row editor-head">
              <label className="field">
                <span>Resume name</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              {dirty && (
                <span className="unsaved" role="status">
                  Unsaved changes
                </span>
              )}
              <span className="controls">
                <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
                  Save resume
                </button>
                <button type="button" disabled={!dirty} onClick={() => (setDraft(fromConfiguration(saved)), setProblem(null))}>
                  Discard changes
                </button>
                <button type="button" className="danger" onClick={() => void remove()}>
                  Delete resume
                </button>
              </span>
            </div>
            <SectionEditor library={library} sectionKey="work" draft={draft} setDraft={setDraft} />
            <SectionEditor library={library} sectionKey="projects" draft={draft} setDraft={setDraft} />
            <SkillsEditor library={library} draft={draft} setDraft={setDraft} />
            {/* Remounted per resume and per library version: no preview or result outlives the state that produced it (review, 6). */}
            <OutputPanel key={`${saved.id}:${props.libraryVersion}`} id={saved.id} dirty={dirty} profileMissing={library.profile === null} onBusy={setOutputBusy} />
          </fieldset>
        )}
      </div>
    </div>
  );
}
