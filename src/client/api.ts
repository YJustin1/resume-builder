// Typed client for the local API (SPEC §6). Relative /api URLs only: the dev
// server proxies them, and the built app is served from the same origin.

import type { Accomplishment, Entry, EntryKind, Profile, ResumeConfiguration, ResumeSummary, Skill, Variant } from '../core/types.ts';

export type { Entry, EntryKind, Profile, ResumeConfiguration, ResumeSummary };

export interface VariantView extends Variant {
  usage: number;
}
export interface AccomplishmentView extends Accomplishment {
  usage: number;
  variants: VariantView[];
}
export interface EntryView extends Entry {
  usage: number;
  accomplishments: AccomplishmentView[];
}
export interface SkillView extends Skill {
  usage: number;
}
export interface LibraryData {
  profile: Profile | null;
  experiences: EntryView[];
  projects: EntryView[];
  skills: SkillView[];
  resumes: ResumeSummary[];
}

export interface Impact {
  affectedResumes: ResumeSummary[];
  blocked: boolean;
}

export type EditType = 'profile' | 'experience' | 'project' | 'accomplishment' | 'variant' | 'skill';
export type DeleteType = Exclude<EditType, 'profile'>;
export type Change = { op: 'edit'; type: EditType; id?: string; patch: Record<string, unknown> } | { op: 'delete'; type: DeleteType; id: string };

/** An API error as the server reports it (`{ error: { code, message, affectedResumes? } }`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly affectedResumes: ResumeSummary[] | undefined;

  constructor(status: number, code: string, message: string, affectedResumes?: ResumeSummary[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.affectedResumes = affectedResumes;
  }
}

async function send(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      ...(signal ? { signal } : {}),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    if (signal?.aborted) throw new ApiError(0, 'ABORTED', 'Cancelled.');
    throw new ApiError(0, 'NETWORK', 'The local server is not reachable. Is it still running?');
  }
}

async function failure(res: Response): Promise<ApiError> {
  let data: { error?: { code?: string; message?: string; affectedResumes?: ResumeSummary[] } } | undefined;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = undefined;
  }
  const e = data?.error;
  return new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.affectedResumes);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const entryPath = (kind: EntryKind) => (kind === 'work' ? 'experiences' : 'projects');

export interface PdfExport {
  blob: Blob;
  pageCount: number;
  overflow: boolean;
}

export const api = {
  library: () => request<LibraryData>('GET', '/api/library'),
  impact: (change: Change) => request<Impact>('POST', '/api/impact', change),

  putProfile: (body: Record<string, unknown>) => request<{ profile: Profile }>('PUT', '/api/profile', body),
  patchProfile: (patch: Record<string, unknown>) => request<{ profile: Profile }>('PATCH', '/api/profile', patch),

  createEntry: (kind: EntryKind, body: Record<string, unknown>) => request<Entry>('POST', `/api/${entryPath(kind)}`, body),
  patchEntry: (kind: EntryKind, id: string, patch: Record<string, unknown>) => request<Entry>('PATCH', `/api/${entryPath(kind)}/${id}`, patch),
  deleteEntry: (kind: EntryKind, id: string) => request<void>('DELETE', `/api/${entryPath(kind)}/${id}`),

  createAccomplishment: (kind: EntryKind, entryId: string, body: Record<string, unknown>) =>
    request<Accomplishment>('POST', `/api/${entryPath(kind)}/${entryId}/accomplishments`, body),
  patchAccomplishment: (id: string, patch: Record<string, unknown>) => request<Accomplishment>('PATCH', `/api/accomplishments/${id}`, patch),
  deleteAccomplishment: (id: string) => request<void>('DELETE', `/api/accomplishments/${id}`),

  createVariant: (accomplishmentId: string, body: Record<string, unknown>) =>
    request<Variant>('POST', `/api/accomplishments/${accomplishmentId}/variants`, body),
  patchVariant: (id: string, patch: Record<string, unknown>) => request<Variant>('PATCH', `/api/variants/${id}`, patch),
  deleteVariant: (id: string) => request<void>('DELETE', `/api/variants/${id}`),

  createSkill: (body: Record<string, unknown>) => request<Skill>('POST', '/api/skills', body),
  patchSkill: (id: string, patch: Record<string, unknown>) => request<Skill>('PATCH', `/api/skills/${id}`, patch),
  deleteSkill: (id: string) => request<void>('DELETE', `/api/skills/${id}`),

  createResume: (name: string) => request<ResumeConfiguration>('POST', '/api/resumes', { name }),
  getResume: (id: string) => request<ResumeConfiguration>('GET', `/api/resumes/${id}`),
  saveResume: (id: string, payload: unknown) => request<ResumeConfiguration>('PUT', `/api/resumes/${id}`, payload),
  deleteResume: (id: string) => request<void>('DELETE', `/api/resumes/${id}`),

  previewUrl: (id: string) => `/api/resumes/${id}/preview`,
  /** Fetch the preview once to surface errors (e.g. PROFILE_REQUIRED) before showing it in the iframe. */
  checkPreview: async (id: string, signal?: AbortSignal) => {
    const res = await send('GET', `/api/resumes/${id}/preview`, undefined, signal);
    if (!res.ok) throw await failure(res);
  },
  exportJson: async (id: string, signal?: AbortSignal): Promise<Blob> => {
    const res = await send('GET', `/api/resumes/${id}/export/json`, undefined, signal);
    if (!res.ok) throw await failure(res);
    return res.blob();
  },
  exportPdf: async (id: string, signal?: AbortSignal): Promise<PdfExport> => {
    const res = await send('GET', `/api/resumes/${id}/export/pdf`, undefined, signal);
    if (!res.ok) throw await failure(res);
    return {
      blob: await res.blob(),
      pageCount: Number(res.headers.get('X-Page-Count')),
      overflow: res.headers.get('X-Overflow-Warning') === 'true',
    };
  },
};

/** Human-readable message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
