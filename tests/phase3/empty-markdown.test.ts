// Codex Phase 3 review, finding 6 (D21): a wording variant that the theme's
// Markdown renders as no visible text (e.g. a "[label]: url" reference
// definition) printed as an empty bullet, a silently dropped bullet (FR-06).

import { describe, expect, it } from 'vitest';
import { rendersNoText } from '../../src/core/fields.ts';
import { dumpRows, freshLibrary, readFixture } from '../support/harness.ts';
import { Api } from '../support/http.ts';

const EMPTY = ['[RFC]: https://example.com/spec', '---', '***', '___', '```', '*', '[]()', '&nbsp;', '[x]:  <>', '&ZeroWidthSpace;', '&#x200B;', '\u200B', '&#xFEFF;', '&shy;'];
const VISIBLE = ['[x]', '**bold**', '`code`', '# Heading', '\\', '- item', '> quote', '&amp;', '<!-- c -->', 'Reduced p95 latency by 42%.'];

describe('D21: Markdown that prints nothing', () => {
  it.each(EMPTY)('%j renders no visible text', (t) => expect(rendersNoText(t)).toBe(true));
  it.each(VISIBLE)('%j renders visible text', (t) => expect(rendersNoText(t)).toBe(false));

  it.each(['[RFC]: https://example.com/spec', '---', '&ZeroWidthSpace;', '&#x200B;'])('writing %j as a variant is 400 INVALID_INPUT; nothing changes', async (t) => {
    const api = new Api(freshLibrary('primary.input.json'));
    const before = dumpRows(api.lib.db);
    const res = await api.call('PATCH', '/api/variants/v11', { text: t });
    expect([res.status, res.code]).toEqual([400, 'INVALID_INPUT']);
    expect(res.body.error.message).toMatch(/would print nothing/);
    expect(dumpRows(api.lib.db)).toEqual(before);
    expect((await api.exportJson('r-security')).body).toEqual(readFixture('security.expected.json'));
  });

  it.each(['[RFC]: https://example.com/spec', '&ZeroWidthSpace;'])(
    'a stored %j row that bypassed validation: preview and PDF refuse with an actionable error; the printer is never invoked',
    async (t) => {
      const api = new Api(freshLibrary('primary.input.json'));
      api.lib.db.prepare(`UPDATE variants SET text = ? WHERE id = 'v11'`).run(t);
      const pdf = await api.exportPdf('r-security');
      expect([pdf.status, pdf.code]).toEqual([500, 'RENDER_FAILED']);
      expect(pdf.body.error.message).toContain(JSON.stringify(t));
      const preview = await api.app.request('/api/resumes/r-security/preview');
      expect(preview.status).toBe(500);
      expect(api.probe.printed).toEqual([]);
    },
  );

  it('a stored image-only bullet is still the asset policy: 409 CONTENT_POLICY_VIOLATION naming <img>; nothing printed', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    api.lib.db.exec(`UPDATE variants SET text = '![x](http://127.0.0.1:9/probe.png)' WHERE id = 'v11'`);
    const pdf = await api.exportPdf('r-security');
    expect([pdf.status, pdf.code]).toEqual([409, 'CONTENT_POLICY_VIOLATION']);
    expect(pdf.body.error.message).toContain('<img>');
    expect(api.probe.printed).toEqual([]);
  });
});
