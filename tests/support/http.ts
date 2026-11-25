// HTTP harness: drive fixture steps through the real HTTP API (Hono's
// in-process `app.request`, no sockets) and check every assertion a fixture
// step or case carries, including the printed-HTML and PDF ones (Phase 3),
// which use the real renderer, instrumented by a probe.

import { expect } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from '../../src/server/app.ts';
import type { Library } from '../../src/db/library.ts';
import { dumpRows, readFixture, recordExists } from './harness.ts';
import { absentProblems, elementNames, extractPdf, hrefs, hrefValues, normalizeText, occurrences, type Extracted } from './pdf.ts';
import { probeRenderer, type Probe } from './render.ts';

export interface HttpResult {
  status: number;
  body: any;
  code?: string;
  affectedResumes?: unknown;
  deferred?: string;
  headers?: Headers;
  /** The response body of a successful PDF export. */
  pdf?: Uint8Array;
}

export class Api {
  readonly app: Hono;
  readonly lib: Library;
  readonly probe: Probe;

  constructor(lib: Library, probe: Probe = probeRenderer()) {
    this.lib = lib;
    this.probe = probe;
    this.app = createApp(lib, { renderer: probe.renderer });
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

  /** GET the PDF export: bytes and headers on 200, the parsed error body otherwise. */
  async exportPdf(id: string): Promise<HttpResult> {
    const res = await this.app.request(`/api/resumes/${id}/export/pdf`);
    const out: HttpResult = { status: res.status, body: undefined, headers: res.headers };
    if (res.headers.get('content-type') === 'application/pdf') {
      out.pdf = new Uint8Array(await res.arrayBuffer());
    } else {
      out.body = JSON.parse(await res.text());
      out.code = out.body?.error?.code;
    }
    return out;
  }

  /** Export a PDF that must succeed; returns its extraction, headers and the exact printed HTML. */
  async printed(id: string): Promise<{ pdf: Extracted; headers: Headers; printedHtml: string; bytes: Uint8Array }> {
    const before = this.probe.printed.length;
    const res = await this.exportPdf(id);
    if (res.status !== 200 || !res.pdf) throw new Error(`PDF export of ${id} failed: ${res.status} ${JSON.stringify(res.body)}`);
    if (this.probe.printed.length !== before + 1) throw new Error('expected exactly one print call');
    return { pdf: await extractPdf(res.pdf), headers: res.headers!, printedHtml: this.probe.printed.at(-1)!, bytes: res.pdf };
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
      return api.exportPdf(step.id);
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
 * Run one fixture step through HTTP and check every assertion
 * it carries. Returns the list of assertions it could not check (none since Phase 3).
 */
export async function checkStep(api: Api, step: any, where: string): Promise<string[]> {
  if (step.action === 'directSqlUpdate') {
    // Stored data that bypassed write validation (T26): change the row directly,
    // then run the follow-up step against it.
    api.lib.db.exec(step.sql);
    return checkStep(api, step.then, `${where} then ${step.then.action}`);
  }
  const deferred: string[] = [];
  const before = dumpRows(api.lib.db);
  const printsBefore = api.probe.printed.length;

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
  if ('printerInvoked' in step) {
    expect(api.probe.printed.length > printsBefore, `${where}: printer invoked`).toBe(step.printerInvoked);
  }
  if (['printedHtmlHrefs', 'printedHtmlMustNotContainElements', 'pdfMustContain', 'pdfMustNotContain'].some((k) => k in step)) {
    // Rendering assertions on an edit step are checked on the r-security PDF
    // export that follows it (text-handling.expected.json "convention").
    await expectPrinted(api, 'r-security', step, where);
  }
  return deferred;
}

/** The printed-HTML and PDF-text assertions a text-handling step or case carries. */
export async function expectPrinted(api: Api, resumeId: string, spec: any, where: string): Promise<void> {
  const { pdf, printedHtml } = await api.printed(resumeId);
  for (const s of spec.pdfMustContain ?? []) {
    expect(occurrences(pdf.text, normalizeText(s)), `${where}: PDF must contain "${s}"\n${pdf.text}`).toBeGreaterThan(0);
  }
  expect(absentProblems('pdfMustNotContain', pdf.text, spec.pdfMustNotContain ?? []), where).toEqual([]);
  for (const s of spec.htmlMustNotContain ?? []) expect(printedHtml, `${where}: printed HTML`).not.toContain(s);
  const tags = elementNames(printedHtml);
  for (const tag of spec.printedHtmlMustNotContainElements ?? []) expect(tags.has(tag), `${where}: printed <${tag}>`).toBe(false);
  if (spec.printedHtmlHrefs) {
    // Non-empty hrefs in the resume body (<section>s); the masthead's mailto
    // contact link is the theme's, not the edited text's.
    expect(hrefs(printedHtml, 'section').sort(), `${where}: non-empty body hrefs`).toEqual([...spec.printedHtmlHrefs.allowedNonEmpty].sort());
    const all = hrefValues(printedHtml);
    for (const bad of spec.printedHtmlHrefs.mustNotContain) {
      expect(all.filter((h) => h.toLowerCase().includes(bad)), `${where}: href containing ${bad}`).toEqual([]);
    }
  }
}
