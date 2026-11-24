// Phase 2: assembly (FR-05) and the HTTP surface (§6).
// T01 (including determinism and insertion-order independence), T18, assembly
// refusals, error format, and the library view.

import { describe, expect, it } from 'vitest';
import { assembleResume } from '../../src/core/assemble.ts';
import { openDatabase } from '../../src/db/database.ts';
import { Library } from '../../src/db/library.ts';
import { loadFixture } from '../../src/db/seed.ts';
import { createApp } from '../../src/server/app.ts';
import { freshLibrary, readFixture } from '../support/harness.ts';
import { Api } from '../support/http.ts';

describe('T01 Security and Engineering', () => {
  it('deep-equal the independent expected files', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    expect((await api.exportJson('r-security')).body).toEqual(readFixture('security.expected.json'));
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
  });

  it('are deterministic: assembling twice gives identical documents', () => {
    const lib = freshLibrary('primary.input.json');
    expect(JSON.stringify(lib.assemble('r-security'))).toBe(JSON.stringify(lib.assemble('r-security')));
  });

  it('do not depend on row insertion order', () => {
    const shuffled = readFixture('primary.input.json');
    for (const key of ['experiences', 'accomplishments', 'variants', 'resumes']) shuffled[key].reverse();
    const lib = new Library(openDatabase(':memory:'));
    loadFixture(lib, shuffled);
    expect(lib.assemble('r-security')).toEqual(readFixture('security.expected.json'));
    expect(lib.assemble('r-engineering')).toEqual(readFixture('engineering.expected.json'));
  });

  it('serve JSON with a download filename', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const res = await api.app.request('/api/resumes/r-security/export/json');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="resume-r-security.json"');
  });
});

describe('T18 Work, Projects, Skills and Education mapping', () => {
  it('Platform and Data deep-equal their expected files', async () => {
    const api = new Api(freshLibrary('sections.input.json'));
    expect((await api.exportJson('r-platform')).body).toEqual(readFixture('sections.platform.expected.json'));
    expect((await api.exportJson('r-data')).body).toEqual(readFixture('sections.data.expected.json'));
  });
  it('the overflow fixture assembles to its independent JSON oracle (T12 JSON part)', () => {
    expect(freshLibrary('overflow.input.json').assemble('r-overflow')).toEqual(readFixture('overflow.expected.json'));
  });
});

describe('assembly refuses instead of returning partial output', () => {
  it('stored ordering gaps -> ASSEMBLY_FAILED', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec("UPDATE resume_bullets SET sort_index = 5 WHERE resume_id = 'r-security' AND accomplishment_id = 'a1'");
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([500, 'ASSEMBLY_FAILED']);
    expect(res.body.error.message).toMatch(/ordering is inconsistent/);
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
  });
  it('a broken reference in a snapshot -> ASSEMBLY_FAILED', () => {
    const snap = freshLibrary('primary.input.json').snapshot();
    snap.variants.delete('v11');
    expect(() => assembleResume(snap, 'r-security')).toThrow(expect.objectContaining({ code: 'ASSEMBLY_FAILED' }));
  });
  it('no profile -> PROFILE_REQUIRED; unknown resume -> NOT_FOUND', async () => {
    const api = new Api(freshLibrary());
    api.lib.createResume({ name: 'Draft' }, { id: 'r-draft' });
    expect((await api.exportJson('r-draft')).code).toBe('PROFILE_REQUIRED');
    expect((await api.exportJson('r-missing')).code).toBe('NOT_FOUND');
  });
  it('a schema violation in the assembled document -> ASSEMBLY_FAILED', () => {
    const snap = freshLibrary('primary.input.json').snapshot();
    snap.profile = { ...snap.profile!, email: 'not-an-email' }; // bypasses write validation
    expect(() => assembleResume(snap, 'r-security')).toThrow(/not valid JSON Resume/);
  });
});

describe('HTTP error handling (§6)', () => {
  it('malformed JSON, empty body and unknown routes', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const bad = await api.app.request('/api/variants/v11', { method: 'PATCH', body: '{not json' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { code: 'INVALID_INPUT', message: 'request body is not valid JSON' } });
    expect((await api.app.request('/api/profile', { method: 'PUT' })).status).toBe(400);
    const missing = await api.call('GET', '/api/nope');
    expect([missing.status, missing.code]).toEqual([404, 'NOT_FOUND']);
  });
  it('unexpected errors are 500 with a generic message and no stack trace', async () => {
    const lib = freshLibrary('primary.input.json');
    lib.listResumes = () => {
      throw new Error('secret internal detail at /Users/someone/file.ts:12');
    };
    const res = await createApp(lib).request('/api/resumes');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/secret|\/Users\//);
    expect(JSON.parse(text)).toEqual({ error: { code: 'ASSEMBLY_FAILED', message: 'Unexpected server error' } });
  });
  it('affectedResumes appears only on RECORD_IN_USE', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const res = await api.call('PATCH', '/api/variants/v11', { text: '' });
    expect(res.body.error).not.toHaveProperty('affectedResumes');
  });
});

describe('library view and creation endpoints', () => {
  it('GET /api/library nests records with usage counts', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const lib = (await api.call('GET', '/api/library')).body;
    const e1 = lib.experiences.find((e: any) => e.id === 'e1');
    expect(e1.usage).toBe(2);
    const a1 = e1.accomplishments.find((a: any) => a.id === 'a1');
    expect(a1.usage).toBe(2);
    expect(Object.fromEntries(a1.variants.map((v: any) => [v.id, v.usage]))).toEqual({ v11: 1, v12: 1 });
    expect(lib.experiences.find((e: any) => e.id === 'e3').usage).toBe(0);
  });
  it('POST endpoints create with server-assigned UUIDs', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const exp = await api.call('POST', '/api/experiences', { name: 'New Org', position: 'Engineer', startDate: '2026-01' });
    expect(exp.status).toBe(201);
    expect(exp.body.id).toMatch(/^[0-9a-f-]{36}$/);
    const acc = await api.call('POST', `/api/experiences/${exp.body.id}/accomplishments`, { fact: 'Did a thing.' });
    const v = await api.call('POST', `/api/accomplishments/${acc.body.id}/variants`, { text: 'Did a thing well.' });
    const r = await api.call('POST', '/api/resumes', { name: 'New' });
    expect([acc.status, v.status, r.status]).toEqual([201, 201, 201]);
    const saved = await api.call('PUT', `/api/resumes/${r.body.id}`, {
      name: 'New',
      experiences: [{ experienceId: exp.body.id, bullets: [{ accomplishmentId: acc.body.id, variantId: v.body.id }] }],
    });
    expect(saved.status).toBe(200);
    expect((await api.exportJson(r.body.id)).body.work).toEqual([
      { name: 'New Org', position: 'Engineer', startDate: '2026-01', highlights: ['Did a thing well.'] },
    ]);
    // A project ID cannot receive work accomplishments through the work route.
    const proj = await api.call('POST', '/api/projects', { name: 'P' });
    expect((await api.call('POST', `/api/experiences/${proj.body.id}/accomplishments`, { fact: 'x' })).status).toBe(404);
  });
});
