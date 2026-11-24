// Phase 2 harness: drive fixture steps through the real HTTP API (Hono's
// in-process `app.request`, no sockets) and check every assertion a fixture
// step or case carries, except the rendering ones (Phase 3).

import { expect } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from '../../src/server/app.ts';
import type { Library } from '../../src/db/library.ts';
import { dumpRows, readFixture, recordExists } from './harness.ts';

export interface HttpResult {
  status: number;
  body: any;
  code?: string;
  affectedResumes?: unknown;
  deferred?: string;
}

export class Api {
  readonly app: Hono;
  readonly lib: Library;

  constructor(lib: Library) {
    this.lib = lib;
    this.app = createApp(lib);
  }

  async call(method: string, path: string, body?: unknown): Promise<HttpResult> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await this.app.request(path, init);
    const text = await res.text();
    const parsed = text === '' ? undefined : JSON.parse(text);
    const out: HttpResult = { status: res.status, body: parsed };
    if (parsed?.error) {
      out.code = parsed.error.code;
      if (parsed.error.affectedResumes) out.affectedResumes = parsed.error.affectedResumes;
    }
    return out;
  }

  exportJson(id: string) {
    return this.call('GET', `/api/resumes/${id}/export/json`);
  }
}

const TYPE_PATH: Record<string, string> = {
  variant: 'variants',
  accomplishment: 'accomplishments',
  experience: 'experiences',
  project: 'projects',
  skill: 'skills',
};

/** The impact change equivalent to an edit step (for steps that carry expectedImpact). */
export function changeFor(step: any): unknown {
  switch (step.action) {
    case 'editVariant':
      return { op: 'edit', type: 'variant', id: step.id, patch: { text: step.text } };
    case 'editExperience':
      return { op: 'edit', type: 'experience', id: step.id, patch: step.patch };
    case 'editAccomplishment':
      return { op: 'edit', type: 'accomplishment', id: step.id, patch: step.patch };
    case 'editSkill':
      return { op: 'edit', type: 'skill', id: step.id, patch: step.patch };
    case 'editProfile':
    case 'patchProfile':
      return { op: 'edit', type: 'profile', patch: step.patch };
    default:
      throw new Error(`no impact change for ${step.action}`);
  }
}

export async function runHttpStep(api: Api, step: any): Promise<HttpResult> {
  switch (step.action) {
    case 'saveResume':
      return api.call('PUT', `/api/resumes/${step.id}`, step.payload);
    case 'createResume': // fixed IDs are a harness convenience (the API assigns UUIDs)
      api.lib.createResume({ name: step.name }, { id: step.id });
      return { status: 201, body: api.lib.getResume(step.id) };
    case 'createExperience':
      return { status: 201, body: api.lib.createEntry('work', step.body, { id: step.id }) };
    case 'delete':
      return api.call('DELETE', `/api/${TYPE_PATH[step.type]}/${step.id}`);
    case 'editVariant':
      return api.call('PATCH', `/api/variants/${step.id}`, { text: step.text });
    case 'editExperience':
      return api.call('PATCH', `/api/experiences/${step.id}`, step.patch);
    case 'editAccomplishment':
      return api.call('PATCH', `/api/accomplishments/${step.id}`, step.patch);
    case 'editSkill':
      return api.call('PATCH', `/api/skills/${step.id}`, step.patch);
    case 'editProfile':
    case 'patchProfile':
      return api.call('PATCH', '/api/profile', step.patch);
    case 'putProfile':
      return api.call('PUT', '/api/profile', step.body);
    case 'getProfile':
      return api.call('GET', '/api/profile');
    case 'impact':
      return api.call('POST', '/api/impact', step.change);
    case 'exportJson':
      return api.exportJson(step.id);
    case 'exportPdf':
    case 'directSqlUpdate':
      return { status: -1, body: undefined, deferred: 'Phase 3 (rendering and runtime content policy)' };
    default:
      throw new Error(`unknown fixture action ${step.action}`);
  }
}

/** Resolve "file:<name>" references to fixture contents. */
export function resolveExpected(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith('file:') ? readFixture(value.slice(5)) : value;
}

/** Read `a.b[0].c` from an object. */
export function at(obj: unknown, path: string): unknown {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce<any>((o, k) => (o === undefined ? undefined : o[k]), obj);
}

export async function expectExports(api: Api, expected: Record<string, unknown>, where: string) {
  for (const [resumeId, value] of Object.entries(expected)) {
    const res = await api.exportJson(resumeId);
    expect(res.status, `${where}: export ${resumeId}`).toBe(200);
    expect(res.body, `${where}: export ${resumeId}`).toEqual(resolveExpected(value));
  }
}

function allHighlights(doc: any): string[] {
  return [...(doc?.work ?? []), ...(doc?.projects ?? [])].flatMap((e: any) => e.highlights ?? []);
}

/**
 * Run one fixture step through HTTP and check every non-rendering assertion
 * it carries. Returns the list of assertions deferred to Phase 3.
 */
export async function checkStep(api: Api, step: any, where: string): Promise<string[]> {
  const deferred: string[] = [];
  const before = dumpRows(api.lib.db);

  if (step.expectedImpact && step.action !== 'impact') {
    const impact = await api.call('POST', '/api/impact', changeFor(step));
    expect(impact.status, `${where}: impact`).toBe(200);
    expect(impact.body, `${where}: impact`).toEqual({ affectedResumes: step.expectedImpact, blocked: false });
    expect(dumpRows(api.lib.db), `${where}: impact is read-only`).toEqual(before);
  }

  const result = await runHttpStep(api, step);
  if (result.deferred) return [`${step.action}: ${result.deferred}`];

  expect(result.status, where).toBe(step.status);
  if (step.code) expect(result.code, where).toBe(step.code);
  if (step.affectedResumes) expect(result.affectedResumes, where).toEqual(step.affectedResumes);
  if (step.status >= 400) {
    expect(dumpRows(api.lib.db), `${where} must change nothing`).toEqual(before);
    expect(result.body?.error?.message, `${where}: error message`).toEqual(expect.any(String));
    expect(JSON.stringify(result.body), `${where}: no stack traces`).not.toMatch(/\n\s+at /);
  }
  if (step.action === 'impact' && step.expectedImpact) {
    expect(result.body, `${where}: impact`).toEqual({ affectedResumes: step.expectedImpact, blocked: false });
  }
  if (step.action === 'delete' && step.status === 204) {
    expect(recordExists(api.lib, step.id), `${where} removed ${step.id}`).toBe(false);
  }
  if (step.expectedBody) expect(result.body, where).toEqual(step.expectedBody);
  if (step.expectedExport) {
    const doc = step.action === 'exportJson' ? result.body : (await api.exportJson(step.id)).body;
    expect(doc, `${where}: export`).toEqual(step.expectedExport);
  }
  if (step.expectedAfterThisStep) await expectExports(api, step.expectedAfterThisStep, where);
  for (const f of step.expectedExportFields ?? []) {
    const doc = (await api.exportJson(f.resume)).body;
    expect(at(doc, f.path), `${where}: ${f.resume} ${f.path}`).toEqual(f.value);
  }
  if (step.expectedJsonHighlight) {
    const doc = (await api.exportJson('r-security')).body;
    expect(allHighlights(doc), `${where}: JSON highlight`).toContain(step.expectedJsonHighlight);
  }
  for (const key of ['printedHtmlHrefs', 'printedHtmlMustNotContainElements', 'pdfMustContain', 'pdfMustNotContain']) {
    if (key in step) deferred.push(`${key}: Phase 3`);
  }
  return deferred;
}
