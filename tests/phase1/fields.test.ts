// Phase 1: field rules (SPEC §4, §3.5 rule 1), profile first run (FR-01a write
// side), immutability, and the all-or-nothing seed loader.

import { describe, expect, it } from 'vitest';
import { date, dateOrder, email, rendersImage, text, url } from '../../src/core/fields.ts';
import { openDatabase } from '../../src/db/database.ts';
import { Library } from '../../src/db/library.ts';
import { loadFixture } from '../../src/db/seed.ts';
import { dumpRows, freshLibrary, readFixture, runStep } from '../support/harness.ts';

const rejects = (fn: () => unknown) => expect(fn).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));

describe('dates (D16)', () => {
  it('accepts the pinned schema forms', () => {
    for (const d of ['2025', '2025-05', '2025-05-01', '1000-01-01', '2999-12-31', '2024-02-29']) expect(date(d, 'd')).toBe(d);
  });
  it('rejects out-of-pattern and impossible dates', () => {
    for (const d of ['0999-12-31', '3000-01-01', '2025-13', '2025-02-30', '2023-02-29', '2025-5-1', '25-05-01', ''])
      rejects(() => date(d, 'd'));
  });
  it('compares start and end at their common precision', () => {
    expect(() => dateOrder('2025', '2025-08-01')).not.toThrow();
    expect(() => dateOrder('2025-05-01', '2025-05')).not.toThrow();
    rejects(() => dateOrder('2025-05-01', '2025-04'));
    rejects(() => dateOrder('2025-05-02', '2025-05-01'));
  });
});

describe('formats checked with the pinned schema validator', () => {
  it('email', () => {
    expect(email('candidate@example.org', 'e')).toBe('candidate@example.org');
    rejects(() => email('not-an-email', 'e'));
  });
  it('url: schema uri format plus http/https only', () => {
    expect(url('https://example.com/x', 'u')).toBe('https://example.com/x');
    for (const u of ['not a url', 'example.com', 'ftp://example.com/x', 'javascript:alert(1)']) rejects(() => url(u, 'u'));
  });
});

describe('text fields', () => {
  it('trims and keeps ordinary text, HTML-like text and Markdown that does not render an image', () => {
    expect(text('  Reviewed <script>alert(1)</script> tags & input.  ', 't')).toBe('Reviewed <script>alert(1)</script> tags & input.');
    expect(text('Used **bold** and [site](https://example.com) links.', 't')).toBe('Used **bold** and [site](https://example.com) links.');
    expect(text('Image ![alt text][ref] here.', 't')).toBe('Image ![alt text][ref] here.');
  });
  it('rejects empty, multi-line and image-rendering text, including nested brackets', () => {
    for (const t of ['', '   ', 'two\nlines', 'tab\there', 'Image ![alt](http://127.0.0.1:9/p.png)', 'Nested ![a [b] c](http://x/y.png)'])
      rejects(() => text(t, 't'));
    expect(rendersImage('![a [b] c](http://x/y.png)')).toBe(true);
    expect(rendersImage('!\\[not an image](x)')).toBe(false);
  });
});

describe('profile first run (FR-01a, write side of T27)', () => {
  it('starts empty; PATCH needs a profile; PUT creates (201) then replaces (200)', () => {
    const lib = freshLibrary();
    expect(runStep(lib, { action: 'getProfile' })).toEqual({ status: 200, body: { profile: null } });
    expect(runStep(lib, { action: 'patchProfile', patch: { name: 'Sample Candidate' } })).toEqual({
      status: 409,
      code: 'PROFILE_REQUIRED',
    });
    expect(runStep(lib, { action: 'putProfile', body: { name: 'Sample Candidate', education: [] } }).status).toBe(201);
    expect(runStep(lib, { action: 'putProfile', body: { name: 'Sample Candidate', education: [] } }).status).toBe(200);
    expect(lib.getProfile()).toEqual({ name: 'Sample Candidate', education: [] });
  });
  it('PATCH null clears an optional field; a required field cannot be cleared', () => {
    const lib = freshLibrary('primary.input.json');
    lib.patchProfile({ email: null });
    expect(lib.getProfile()).toEqual({ name: 'Sample Candidate', education: [] });
    rejects(() => lib.patchProfile({ name: null }));
  });
});

describe('immutability and unknown fields', () => {
  it('an accomplishment or variant cannot be reparented and an entry kind cannot change', () => {
    const lib = freshLibrary('primary.input.json');
    const before = dumpRows(lib.db);
    rejects(() => lib.patchAccomplishment('a1', { entryId: 'e2' }));
    rejects(() => lib.patchVariant('v11', { accomplishmentId: 'a2' }));
    rejects(() => lib.patchEntry('work', 'e1', { kind: 'project' }));
    rejects(() => lib.patchEntry('work', 'e1', { title: 'typo' }));
    expect(dumpRows(lib.db)).toEqual(before);
  });
  it('work entries need a position; projects do not accept one', () => {
    const lib = freshLibrary();
    rejects(() => lib.createEntry('work', { name: 'No Position Inc' }));
    rejects(() => lib.createEntry('project', { name: 'P', position: 'X' }));
  });
});

describe('seed loader', () => {
  it('loads every v2 fixture input', () => {
    for (const input of ['primary.input.json', 'sections.input.json', 'shared-edit.input.json', 'overflow.input.json']) {
      const lib = freshLibrary(input);
      expect(lib.listResumes().length).toBeGreaterThan(0);
    }
  });
  it('is all-or-nothing: an invalid fixture leaves the database empty', () => {
    const lib = new Library(openDatabase(':memory:'));
    const broken = readFixture('primary.input.json');
    broken.resumes[1].experiences[0].bullets[0].variantId = 'v11'; // v11 belongs to a1, not a3
    expect(() => loadFixture(lib, broken)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    for (const rows of Object.values(dumpRows(lib.db))) expect(rows).toEqual([]);
  });
  it('rejects a non-empty legacy profile.skills', () => {
    const lib = new Library(openDatabase(':memory:'));
    const input = readFixture('primary.input.json');
    input.profile.skills = [{ name: 'Legacy' }];
    expect(() => loadFixture(lib, input)).toThrow(/legacy/);
  });
});
