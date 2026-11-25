// Phase 3 gate: T11, T12, T14, T22, T23 through the HTTP API and the real
// pipeline (resumed.render + Even, resumed.pdf + Chrome, pdf.js). T16, T16b and
// T26 run in tests/phase2/fixtures-http.test.ts with the same harness.

import { describe, expect, it } from 'vitest';
import { PREVIEW_CSP } from '../../src/server/app.ts';
import { dumpRows, freshLibrary, readFixture } from '../support/harness.ts';
import { Api } from '../support/http.ts';
import { allProblems, caseById, PDF_CASES, runPdfOracle } from '../support/oracle.ts';
import { readGolden } from '../support/pdf.ts';
import { probeRenderer } from '../support/render.ts';

const TIMEOUT = 60_000;

describe.each(PDF_CASES)('$id $name: real PDF against the §7.3 oracle', (c) => {
  const golden = readGolden(c.name);
  it(
    `JSON, same object, oracle fields, derived exclusions, printed bullets, headers${golden ? ', approved full text' : ''}`,
    async () => {
      const run = await runPdfOracle(c);
      expect(run.problems, c.id).toEqual({ json: [], sameObject: [], oracle: [], exclusions: [], printedBullets: [], fullText: [], headers: [] });
      expect(run.fullTextChecked).toBe(golden !== undefined);
      if (run.skipped.length) console.info(`${c.id} derived exclusions skipped (substrings of selected text):`, run.skipped);
    },
    TIMEOUT,
  );
  if (!golden) it.todo(`approved full text equals fixtures/${c.name}.pdf.text.txt (awaiting owner review)`);
});

describe('T11 preview', () => {
  it(
    'serves the same rendering as the PDF, with the §3.5 CSP',
    async () => {
      const api = new Api(freshLibrary('primary.input.json'));
      const res = await api.app.request('/api/resumes/r-security/preview');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:",
      );
      expect(PREVIEW_CSP).toBe(res.headers.get('content-security-policy'));
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const html = await res.text();
      expect(api.probe.rendered).toEqual([readFixture('security.expected.json')]);
      expect(api.probe.printed).toEqual([]); // a preview never prints
      const { printedHtml } = await api.printed('r-security');
      expect(html).toBe(printedHtml);
    },
    TIMEOUT,
  );
});

describe('T22 page-count headers', () => {
  it.each(PDF_CASES)(
    '$id: X-Page-Count from the PDF bytes; X-Overflow-Warning matches the oracle',
    async (c) => {
      const run = await runPdfOracle(c);
      const oracle = readFixture(`${c.name}.pdf.expected.json`);
      expect(run.problems.headers).toEqual([]);
      expect(run.headers.get('x-page-count')).toBe(String(run.pdf.pageCount));
      expect(run.headers.get('x-overflow-warning')).toBe(String(oracle.overflowWarning));
      expect(run.headers.get('content-type')).toBe('application/pdf');
      expect(run.headers.get('content-disposition')).toBe(`attachment; filename="resume-${c.resume}.pdf"`);
      expect(Buffer.from(run.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    },
    TIMEOUT,
  );

  it(
    'T12 overflow: at least two pages, warning true, and the export still succeeds',
    async () => {
      const run = await runPdfOracle(caseById('T12'));
      expect(run.pdf.pageCount).toBeGreaterThanOrEqual(2);
      expect(run.headers.get('x-overflow-warning')).toBe('true');
      expect(allProblems(run)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('T14 render failure', () => {
  it.each([
    ['the printer rejects', { print: async () => Promise.reject(new Error('printer down')) }],
    ['the theme rejects', { html: async () => Promise.reject(new Error('theme down')) }],
  ])(
    '%s: 500 RENDER_FAILED, no PDF body, no DB change',
    async (_, base) => {
      const api = new Api(freshLibrary('primary.input.json'), probeRenderer({ base }));
      const before = dumpRows(api.lib.db);
      const res = await api.exportPdf('r-security');
      expect([res.status, res.code]).toEqual([500, 'RENDER_FAILED']);
      expect(res.pdf).toBeUndefined();
      expect(res.headers!.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers!.get('x-page-count')).toBeNull();
      expect(res.body.error.message).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/printer down|theme down|\n\s+at /);
      expect(dumpRows(api.lib.db)).toEqual(before);
      const preview = await api.app.request('/api/resumes/r-security/preview');
      if ('html' in base) expect(preview.status).toBe(500);
      else expect(preview.status).toBe(200); // preview needs no printer
    },
    TIMEOUT,
  );

  it('assembly errors come before rendering: unknown resume is 404 and nothing is rendered', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const res = await api.exportPdf('r-missing');
    expect([res.status, res.code]).toEqual([404, 'NOT_FOUND']);
    expect([api.probe.rendered, api.probe.printed]).toEqual([[], []]);
  });
});
