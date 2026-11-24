// Regression tests for the Phase 2 Codex review (code round 1): the browser
// trust boundary, path-ID validation, and assembler refusals.

import { describe, expect, it } from 'vitest';
import { assembleResume } from '../../src/core/assemble.ts';
import { dumpRows, freshLibrary, readFixture } from '../support/harness.ts';
import { Api } from '../support/http.ts';

async function raw(api: Api, path: string, init: RequestInit & { headers?: Record<string, string> }) {
  const res = await api.app.request(path, init);
  return { status: res.status, body: (await res.text()) || undefined };
}

describe('#1 local API browser trust boundary', () => {
  const json = { 'content-type': 'application/json' };

  it('a text/plain "simple" cross-site POST is refused with 415 and changes nothing', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const before = dumpRows(api.lib.db);
    const res = await raw(api, '/api/resumes', {
      method: 'POST',
      body: JSON.stringify({ name: 'Injected' }),
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    const plainLocal = await raw(api, '/api/resumes', { method: 'POST', body: JSON.stringify({ name: 'X' }), headers: { 'content-type': 'text/plain' } });
    expect(plainLocal.status).toBe(415);
    expect(JSON.parse(plainLocal.body!).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(dumpRows(api.lib.db)).toEqual(before);
  });

  it('writes from a non-loopback Origin or marked cross-site are refused with 403', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const before = dumpRows(api.lib.db);
    for (const headers of [
      { ...json, origin: 'https://evil.example' },
      { ...json, origin: 'http://127.0.0.1.evil.example:5174' },
      { ...json, 'sec-fetch-site': 'cross-site' },
    ]) {
      const res = await raw(api, '/api/variants/v11', { method: 'PATCH', body: JSON.stringify({ text: 'Changed.' }), headers });
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(JSON.parse(res.body!).error.code).toBe('FORBIDDEN_ORIGIN');
    }
    const del = await raw(api, '/api/variants/v41', { method: 'DELETE', headers: { origin: 'https://evil.example' } });
    expect(del.status).toBe(403);
    expect(dumpRows(api.lib.db)).toEqual(before);
  });

  it('a non-loopback Host (DNS rebinding) is refused even for reads', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const res = await api.app.request('http://attacker.example/api/resumes/r-security/export/json', {
      headers: { host: 'attacker.example:5174' },
    });
    expect(res.status).toBe(403);
  });

  it('loopback origins (the UI dev server) and same-origin requests are allowed', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5174', 'http://[::1]:5173']) {
      const res = await raw(api, '/api/variants/v11', {
        method: 'PATCH',
        body: JSON.stringify({ text: `From ${origin}.` }),
        headers: { ...json, origin, 'sec-fetch-site': 'same-site' },
      });
      expect(res.status, origin).toBe(200);
    }
  });
});

describe('#9 path IDs are validated uniformly at the HTTP boundary', () => {
  it('malformed IDs are 400 INVALID_INPUT on every route; well-formed missing IDs are 404', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const bad = encodeURIComponent('bad id!');
    for (const [method, path] of [
      ['GET', `/api/resumes/${bad}`],
      ['GET', `/api/resumes/${bad}/export/json`],
      ['DELETE', `/api/experiences/${bad}`],
      ['GET', `/api/projects/${bad}`],
      ['DELETE', `/api/variants/${bad}`],
    ] as const) {
      const res = await api.call(method, path);
      expect([res.status, res.code], path).toEqual([400, 'INVALID_INPUT']);
    }
    for (const [method, path] of [
      ['GET', '/api/resumes/r-missing'],
      ['DELETE', '/api/experiences/e-missing'],
    ] as const) {
      const res = await api.call(method, path);
      expect([res.status, res.code], path).toEqual([404, 'NOT_FOUND']);
    }
  });
});

describe('#3 the assembler refuses duplicate selections', () => {
  const snapWith = (mutate: (config: any) => void) => {
    const snap = freshLibrary('sections.input.json').snapshot();
    mutate(snap.resumes.get('r-platform'));
    return snap;
  };
  it('duplicate entry', () => {
    const snap = snapWith((c) => c.experiences.push({ ...c.experiences[0], bullets: [] }));
    expect(() => assembleResume(snap, 'r-platform')).toThrow(/entry w1 is selected more than once/);
  });
  it('duplicate accomplishment across entries', () => {
    const snap = snapWith((c) => c.experiences[0].bullets.push({ ...c.experiences[0].bullets[0] }));
    expect(() => assembleResume(snap, 'r-platform')).toThrow(/accomplishment aw2 is selected more than once/);
  });
  it('duplicate skill', () => {
    const snap = snapWith((c) => c.skills.push('s1'));
    expect(() => assembleResume(snap, 'r-platform')).toThrow(/skill s1 is selected more than once/);
  });
});

describe('#4 blank values never reach a successful export', () => {
  it('a blank stored profile name is PROFILE_REQUIRED', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec("UPDATE profile SET name = '   '");
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([409, 'PROFILE_REQUIRED']);
  });
  it('a blank stored optional field is ASSEMBLY_FAILED', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec("UPDATE profile SET label = ''");
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([500, 'ASSEMBLY_FAILED']);
    expect(res.body.error.message).toMatch(/resume\.basics\.label is empty/);
  });
  it('unchanged documents still export normally', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    expect((await api.exportJson('r-security')).body).toEqual(readFixture('security.expected.json'));
  });
});

describe('round 2 #11 orphaned selection rows make export fail instead of being dropped', () => {
  it('a bullet row whose entry selection is missing -> ASSEMBLY_FAILED', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec('PRAGMA foreign_keys = OFF');
    api.lib.db.exec("INSERT INTO resume_bullets VALUES ('r-security', 'e3', 'a5', 'v51', 0)");
    api.lib.db.exec('PRAGMA foreign_keys = ON');
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([500, 'ASSEMBLY_FAILED']);
    expect(res.body.error.message).toMatch(/resume_bullets row \(entry_id=e3, accomplishment_id=a5, variant_id=v51\) references a missing resume_entries row/);
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
  });
});

describe('round 2 #12 required export fields', () => {
  it('an education item without an institution -> ASSEMBLY_FAILED naming the field', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec(`UPDATE profile SET education_json = '[{}]'`);
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([500, 'ASSEMBLY_FAILED']);
    expect(res.body.error.message).toMatch(/resume\.education\[0\]\.institution is missing/);
  });
});

describe('round 3 #15 a selection row at the maximum rowid cannot block other resumes', () => {
  it('Security fails with the specific integrity error; Engineering still exports', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec('PRAGMA foreign_keys = OFF');
    api.lib.db.exec(
      "INSERT INTO resume_bullets (rowid, resume_id, entry_id, accomplishment_id, variant_id, sort_index) VALUES (9223372036854775807, 'r-security', 'e3', 'a5', 'v51', 0)",
    );
    api.lib.db.exec('PRAGMA foreign_keys = ON');
    const res = await api.exportJson('r-security');
    expect([res.status, res.code]).toEqual([500, 'ASSEMBLY_FAILED']);
    expect(res.body.error.message).toMatch(/references a missing resume_entries row/);
    expect((await api.exportJson('r-engineering')).body).toEqual(readFixture('engineering.expected.json'));
  });
});
