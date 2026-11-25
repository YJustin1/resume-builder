// Shared UI pieces: a modal prompt on the native <dialog> element (focus
// trapping and Escape come from the browser), inline error and affected-resume
// displays, form field helpers, and the two library flows SPEC FR-01/FR-03
// require: impact confirmation before a shared edit, and checked deletes.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, messageOf, type Change, type ResumeSummary } from './api.ts';

// ---------------------------------------------------------------- prompt dialog

export interface Choice {
  value: string;
  label: string;
  primary?: boolean;
}

interface PromptRequest {
  title: string;
  body: ReactNode;
  choices: Choice[];
  resolve: (value: string | null) => void;
}

type Prompt = (title: string, body: ReactNode, choices: Choice[]) => Promise<string | null>;
const PromptContext = createContext<Prompt>(async () => null);

export function PromptProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (request && d && !d.open) d.showModal();
  }, [request]);

  const prompt = useCallback<Prompt>((title, body, choices) => new Promise((resolve) => setRequest({ title, body, choices, resolve })), []);

  const finish = (value: string | null) => {
    request?.resolve(value);
    setRequest(null);
    dialog.current?.close();
  };

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      <dialog ref={dialog} aria-labelledby="prompt-title" onCancel={(e) => (e.preventDefault(), finish(null))}>
        {request && (
          <form method="dialog" onSubmit={(e) => e.preventDefault()}>
            <h2 id="prompt-title">{request.title}</h2>
            <div className="prompt-body">{request.body}</div>
            <div className="actions">
              {request.choices.map((c) => (
                <button key={c.value} type="button" className={c.primary ? 'primary' : ''} autoFocus={c.primary} onClick={() => finish(c.value)}>
                  {c.label}
                </button>
              ))}
              <button type="button" onClick={() => finish(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </dialog>
    </PromptContext.Provider>
  );
}

export const usePrompt = () => useContext(PromptContext);

// ---------------------------------------------------------------- displays

export function ResumeList({ resumes }: { resumes: ResumeSummary[] }) {
  return (
    <ul className="affected">
      {resumes.map((r) => (
        <li key={r.id}>
          {r.name} <span className="muted">({r.id})</span>
        </li>
      ))}
    </ul>
  );
}

export interface Problem {
  message: string;
  affectedResumes?: ResumeSummary[] | undefined;
}

export const problemOf = (error: unknown): Problem => ({
  message: messageOf(error),
  affectedResumes: error instanceof ApiError ? error.affectedResumes : undefined,
});

export function ProblemBox({ problem }: { problem: Problem | null }) {
  if (!problem) return null;
  return (
    <div className="problem" role="alert">
      <p>{problem.message}</p>
      {problem.affectedResumes && problem.affectedResumes.length > 0 && (
        <>
          <p>Used by these saved resumes; nothing was changed. Remove or replace it there, save, then try again:</p>
          <ResumeList resumes={problem.affectedResumes} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- forms

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; required?: boolean; hint?: string; wide?: boolean }) {
  return (
    <label className={props.wide ? 'field wide' : 'field'}>
      <span>
        {props.label}
        {props.required ? ' *' : ''}
      </span>
      <input value={props.value} required={props.required} onChange={(e) => props.onChange(e.target.value)} />
      {props.hint && <small className="muted">{props.hint}</small>}
    </label>
  );
}

/** Form values are strings; lists are comma separated. */
export type FormValues = Record<string, string>;

export const toList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function valuesOf(record: object, fields: string[], lists: string[] = []): FormValues {
  const r = record as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f, lists.includes(f) ? ((r[f] as string[] | undefined) ?? []).join(', ') : ((r[f] as string | undefined) ?? '')]));
}

/** A create body: present, non-empty values only. */
export function createBody(values: FormValues, lists: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (lists.includes(k)) out[k] = toList(v);
    else if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

/**
 * A PATCH body: only changed keys; an emptied optional field becomes null
 * (SPEC §6: `null` clears an optional field). The server validates everything.
 */
export function patchBody(original: FormValues, edited: FormValues, lists: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(edited)) {
    if (lists.includes(k)) {
      const next = toList(v);
      if (JSON.stringify(next) !== JSON.stringify(toList(original[k] ?? ''))) out[k] = next;
    } else if (v.trim() !== (original[k] ?? '').trim()) {
      out[k] = v.trim() === '' ? null : v.trim();
    }
  }
  return out;
}

// ---------------------------------------------------------------- library flows

/**
 * FR-01: before saving an edit to a rendered shared field, show the resumes
 * whose export will change (impactOf via POST /api/impact) and ask. Returns
 * true when saved. An edit that changes no export saves without a prompt.
 */
export function useSharedSave() {
  const prompt = usePrompt();
  return useCallback(
    async (change: Change & { op: 'edit' }, label: string, save: () => Promise<unknown>): Promise<boolean> => {
      const { affectedResumes } = await api.impact(change);
      if (affectedResumes.length > 0) {
        const ok = await prompt(
          'Change a shared record?',
          <>
            <p>
              Saving this edit to <strong>{label}</strong> changes the export of {affectedResumes.length === 1 ? 'this saved resume' : `these ${affectedResumes.length} saved resumes`}:
            </p>
            <ResumeList resumes={affectedResumes} />
          </>,
          [{ value: 'save', label: `Save and update ${affectedResumes.length === 1 ? '1 resume' : `${affectedResumes.length} resumes`}`, primary: true }],
        );
        if (ok !== 'save') return false;
      }
      await save();
      return true;
    },
    [prompt],
  );
}

/**
 * FR-03: a referenced record cannot be deleted (409 RECORD_IN_USE lists the
 * resumes); an unreferenced one is deleted after confirmation. Returns true
 * when deleted; throws the ApiError (with affectedResumes) when blocked.
 */
export function useCheckedDelete() {
  const prompt = usePrompt();
  return useCallback(
    async (change: Change & { op: 'delete' }, label: string, extra: string, remove: () => Promise<unknown>): Promise<boolean> => {
      const impact = await api.impact(change);
      if (impact.blocked) throw new ApiError(409, 'RECORD_IN_USE', `“${label}” cannot be deleted.`, impact.affectedResumes);
      const ok = await prompt('Delete permanently?', <p>Delete “{label}”? {extra} This cannot be undone.</p>, [{ value: 'delete', label: 'Delete', primary: true }]);
      if (ok !== 'delete') return false;
      await remove(); // a 409 from a concurrent change still surfaces here
      return true;
    },
    [prompt],
  );
}
