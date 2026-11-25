// Codex Phase 3 review, finding 1: a saved phone number (Even renders it as a
// tel: link) or a chat link in a bullet (irc:/xmpp:, kept by micromark) made
// every preview and PDF export a 409. tel: is now allowed (D22), so the phone
// stays a clickable link; chat links are neutralized to plain text (§3.5 rule 3).

import { describe, expect, it } from 'vitest';
import { freshLibrary } from '../support/harness.ts';
import { Api } from '../support/http.ts';
import { hrefValues, occurrences, printedBulletProblems } from '../support/pdf.ts';

describe('phone, URL and chat links print as text instead of blocking export', () => {
  it('profile phone and url: JSON keeps them, preview and PDF show them, the phone stays a tel: link', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const patch = await api.call('PATCH', '/api/profile', { phone: '+1 512 555 0100', url: 'https://portfolio.sample.dev/' });
    expect(patch.status).toBe(200);
    const doc = (await api.exportJson('r-security')).body;
    expect(doc.basics).toEqual(expect.objectContaining({ phone: '+1 512 555 0100', url: 'https://portfolio.sample.dev/' }));

    const preview = await api.app.request('/api/resumes/r-security/preview');
    expect(preview.status).toBe(200);
    const html = await preview.text();
    expect(html).toContain('+1 512 555 0100');
    expect(hrefValues(html).filter((h) => h.startsWith('tel:'))).toEqual(['tel:+15125550100']);

    const { pdf, printedHtml } = await api.printed('r-security');
    expect(occurrences(pdf.text, '+1 512 555 0100')).toBe(1);
    expect(occurrences(pdf.text, 'portfolio.sample.dev')).toBe(1); // Even shows the URL without scheme and slash
    expect(printedBulletProblems(printedHtml, doc)).toEqual([]); // contacts: email, phone, url (as Even shows it)
  }, 60_000);

  it('a bullet with irc: and xmpp: links exports; the link text prints and the hrefs are blanked', async () => {
    const api = new Api(freshLibrary('primary.input.json'));
    const text = 'Ran the [team chat](irc://irc.example.com/lab) and [pager](xmpp:oncall@example.com) rotations.';
    expect((await api.call('PATCH', '/api/variants/v11', { text })).status).toBe(200);
    const { pdf, printedHtml } = await api.printed('r-security');
    expect(occurrences(pdf.text, 'Ran the team chat and pager rotations.')).toBe(1);
    expect(hrefValues(printedHtml).filter((h) => /^(irc|xmpp):/i.test(h))).toEqual([]);
  }, 60_000);
});
