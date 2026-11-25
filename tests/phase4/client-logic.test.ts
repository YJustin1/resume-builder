// Phase 4: the client's pure logic. Draft editing (FR-02: order, isolation,
// explicit wording choice, unsaved state) and form-to-request conversion
// (SPEC §6: PATCH sends only changed keys; null clears an optional field).

import { describe, expect, it } from 'vitest';
import {
  addBullet,
  addEntry,
  addSkill,
  addableAccomplishments,
  draftProblems,
  fromConfiguration,
  move,
  moveBullet,
  moveEntry,
  moveSkill,
  referenceProblems,
  removeBullet,
  removeEntry,
  sameDraft,
  setVariant,
  toPayload,
} from '../../src/client/draft.ts';
import { createBody, patchBody, toList, valuesOf } from '../../src/client/ui.tsx';
import type { EntryView, LibraryData } from '../../src/client/api.ts';
import { freshLibrary } from '../support/harness.ts';

const security = () => fromConfiguration(freshLibrary('primary.input.json').getResume('r-security'));

describe('draft editing', () => {
  it('round-trips a saved configuration into exactly the PUT body shape', () => {
    const lib = freshLibrary('primary.input.json');
    const saved = lib.getResume('r-security');
    const payload = toPayload(fromConfiguration(saved));
    expect(payload).toEqual({ name: saved.name, experiences: saved.experiences, projects: saved.projects, skills: saved.skills });
    expect(lib.saveResume('r-security', payload)).toEqual(saved); // the server accepts it unchanged
  });

  it('move swaps neighbours and ignores out-of-range moves', () => {
    expect(move(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(move(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });

  it('reordering entries, bullets and skills changes only the draft, never the input', () => {
    const d = security();
    const before = JSON.stringify(d);
    const moved = moveBullet(moveEntry(d, 'work', 0, 1), 'work', 1, 0, 1);
    expect(moved.work.map((s) => s.entryId)).toEqual(['e2', 'e1']);
    expect(moved.work[1]!.bullets.map((b) => b.variantId)).toEqual(['v11', 'v21']);
    expect(JSON.stringify(d)).toBe(before);
    expect(moveSkill(addSkill(addSkill(d, 's1'), 's2'), 0, 1).skills).toEqual(['s2', 's1']);
  });

  it('unsaved state is draft !== saved, and undoing a change makes it clean again', () => {
    const d = security();
    const changed = moveBullet(d, 'work', 0, 0, 1);
    expect(sameDraft(d, changed)).toBe(false);
    expect(sameDraft(d, moveBullet(changed, 'work', 0, 0, 1))).toBe(true);
    expect(sameDraft(d, { ...d, name: 'Security 2' })).toBe(false);
  });

  it('adding never duplicates an entry, bullet or skill; removing touches only the selection', () => {
    const d = security();
    expect(addEntry(d, 'work', 'e1')).toBe(d);
    expect(addBullet(d, 'work', 0, 'a1', 'v12')).toEqual(d);
    expect(addSkill(addSkill(d, 's1'), 's1').skills).toEqual(['s1']);
    expect(removeEntry(d, 'work', 0).work.map((s) => s.entryId)).toEqual(['e2']);
    expect(removeBullet(d, 'work', 0, 1).work[0]!.bullets).toEqual([{ accomplishmentId: 'a2', variantId: 'v21' }]);
  });

  it('a bullet without a chosen wording blocks saving with an actionable message (no silent default)', () => {
    const d = addBullet(addEntry(security(), 'work', 'e3'), 'work', 2, 'a5', '');
    expect(draftProblems(d)).toEqual(['Choose a wording for one bullet.']);
    expect(draftProblems(setVariant(d, 'work', 2, 0, 'v51'))).toEqual([]);
    expect(draftProblems({ ...security(), name: '  ' })).toEqual(['Give the resume a name.']);
  });

  it('only accomplishments that are unselected and have a wording can be added', () => {
    const entry = {
      id: 'e1',
      accomplishments: [
        { id: 'a1', variants: [{ id: 'v11' }] },
        { id: 'a2', variants: [{ id: 'v21' }] },
        { id: 'a9', variants: [] },
      ],
    } as unknown as EntryView;
    expect(addableAccomplishments(entry, { entryId: 'e1', bullets: [{ accomplishmentId: 'a1', variantId: 'v11' }] }).map((a) => a.id)).toEqual(['a2']);
  });
});

describe('references deleted in the Library (verification round 2, 6)', () => {
  const library = () => {
    const lib = freshLibrary('primary.input.json');
    const snap = lib.snapshot();
    const entryView = (kind: 'work' | 'project') =>
      [...snap.entries.values()]
        .filter((e) => e.kind === kind)
        .map((e) => ({
          ...e,
          usage: 0,
          accomplishments: [...snap.accomplishments.values()]
            .filter((a) => a.entryId === e.id)
            .map((a) => ({ ...a, usage: 0, variants: [...snap.variants.values()].filter((v) => v.accomplishmentId === a.id).map((v) => ({ ...v, usage: 0 })) })),
        }));
    return { profile: snap.profile, experiences: entryView('work'), projects: entryView('project'), skills: [], resumes: [] } as unknown as LibraryData;
  };

  it('a saved resume against the current library has none', () => {
    expect(referenceProblems(security(), library())).toEqual([]);
  });

  it('names each kind of deleted reference', () => {
    const lib = library();
    const d = { ...security(), skills: ['s-gone'] };
    const withGone = setVariant(d, 'work', 0, 0, 'v-gone'); // a wording deleted meanwhile
    const withBullet = { ...withGone, work: withGone.work.map((s, i) => (i === 1 ? { ...s, bullets: [...s.bullets, { accomplishmentId: 'a-gone', variantId: 'v' }] } : s)) };
    const withEntry = { ...withBullet, projects: [{ entryId: 'p-gone', bullets: [] }] };
    expect(referenceProblems(withEntry, lib)).toEqual([
      'Choose a replacement for one bullet whose wording was deleted.',
      'Remove one bullet whose accomplishment was deleted.',
      'Remove one entry that was deleted.',
      'Remove one skill that was deleted.',
    ]);
  });
});

describe('form values to request bodies', () => {
  const entry = { name: 'Northwind Lab', position: 'Research Intern', location: 'Sample City', startDate: '2025-05-01' };
  const fields = ['name', 'position', 'location', 'url', 'startDate', 'endDate'];

  it('create bodies carry only non-empty, trimmed values; lists are one item per line', () => {
    expect(createBody({ name: ' Go ', level: '', keywords: 'a\n b\n\n c ' }, ['keywords'])).toEqual({ name: 'Go', keywords: ['a', 'b', 'c'] });
    expect(toList(' \n ')).toEqual([]);
  });

  it('patch bodies carry only changed keys, trimmed; an emptied optional field is null', () => {
    const original = valuesOf(entry, fields);
    expect(patchBody(original, { ...original })).toEqual({});
    expect(patchBody(original, { ...original, position: ' Research Intern ' })).toEqual({});
    expect(patchBody(original, { ...original, location: '', endDate: '2025-08-01' })).toEqual({ location: null, endDate: '2025-08-01' });
  });

  it('list fields compare as lists', () => {
    const original = valuesOf({ tags: ['access', 'automation'] }, ['tags'], ['tags']);
    expect(original).toEqual({ tags: 'access\nautomation' });
    expect(patchBody(original, { tags: 'access \n automation\n' }, ['tags'])).toEqual({});
    expect(patchBody(original, { tags: 'access' }, ['tags'])).toEqual({ tags: ['access'] });
  });

  it('items containing commas round-trip; editing one item leaves the others intact (review, 7)', () => {
    const original = valuesOf({ keywords: ['Research, Design', 'Testing'] }, ['keywords'], ['keywords']);
    expect(toList(original.keywords!)).toEqual(['Research, Design', 'Testing']);
    expect(patchBody(original, { keywords: `${original.keywords}\nPlanning, Review` }, ['keywords'])).toEqual({
      keywords: ['Research, Design', 'Testing', 'Planning, Review'],
    });
  });
});
