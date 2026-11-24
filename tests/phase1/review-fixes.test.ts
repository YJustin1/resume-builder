// Regression tests for the Phase 1 Codex review (code round 1).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.ts';
import { Library } from '../../src/db/library.ts';
import { loadFixture } from '../../src/db/seed.ts';
import { dumpRows, freshLibrary, readFixture, runStep } from '../support/harness.ts';

const save = (lib: Library, payload: unknown) => runStep(lib, { action: 'saveResume', id: 'r-security', payload });

describe('#1 experiences is required in a configuration PUT', () => {
  it('omitting experiences is INVALID_INPUT and changes nothing', () => {
    const lib = freshLibrary('primary.input.json');
    const before = dumpRows(lib.db);
    expect(save(lib, { name: 'Security' })).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(dumpRows(lib.db)).toEqual(before);
  });
  it('an explicit [] is allowed', () => {
    const lib = freshLibrary('primary.input.json');
    expect(save(lib, { name: 'Security', experiences: [] }).status).toBe(200);
    expect(lib.getResume('r-security').experiences).toEqual([]);
  });
});

describe('#2 an existing ID in the wrong role is INVALID_INPUT, a missing ID is INVALID_REFERENCE', () => {
  const cases: [string, unknown, string][] = [
    ['variant ID as accomplishment', [{ experienceId: 'e1', bullets: [{ accomplishmentId: 'v11', variantId: 'v11' }] }], 'INVALID_INPUT'],
    ['accomplishment ID as variant', [{ experienceId: 'e1', bullets: [{ accomplishmentId: 'a1', variantId: 'a1' }] }], 'INVALID_INPUT'],
    ['accomplishment ID as experience', [{ experienceId: 'a1', bullets: [] }], 'INVALID_INPUT'],
    ['resume ID as experience', [{ experienceId: 'r-engineering', bullets: [] }], 'INVALID_INPUT'],
    ['missing accomplishment', [{ experienceId: 'e1', bullets: [{ accomplishmentId: 'a-missing', variantId: 'v11' }] }], 'INVALID_REFERENCE'],
    ['missing experience', [{ experienceId: 'e-missing', bullets: [] }], 'INVALID_REFERENCE'],
  ];
  for (const [what, experiences, code] of cases) {
    it(what, () => {
      const lib = freshLibrary('primary.input.json');
      const before = dumpRows(lib.db);
      expect(save(lib, { name: 'Security', experiences })).toEqual({ status: 400, code });
      expect(dumpRows(lib.db)).toEqual(before);
    });
  }
  it('variant ID as skill', () => {
    const lib = freshLibrary('primary.input.json');
    expect(save(lib, { name: 'Security', experiences: [], skills: ['v11'] })).toEqual({ status: 400, code: 'INVALID_INPUT' });
  });
});

describe('#3 snapshots are consistent against concurrent writers', () => {
  let dir: string | undefined;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('a commit attempted between snapshot queries cannot produce dangling references', () => {
    dir = mkdtempSync(join(tmpdir(), 'rb-snap-'));
    const path = join(dir, 'library.sqlite');
    const lib = freshLibrary('primary.input.json', path);
    const other = new DatabaseSync(path, { timeout: 0 });
    other.exec('PRAGMA foreign_keys = ON');
    // Between reading variants and reading resumes, another connection adds a
    // new variant and points Security's a1 bullet at it.
    const prepare = lib.db.prepare.bind(lib.db);
    let fired = false;
    let writerError: unknown;
    lib.db.prepare = ((sql: string) => {
      if (!fired && sql.startsWith('SELECT * FROM resumes')) {
        fired = true;
        try {
          other.exec(`BEGIN IMMEDIATE;
            INSERT INTO variants (id, accomplishment_id, text) VALUES ('v13', 'a1', 'Concurrent wording.');
            UPDATE resume_bullets SET variant_id = 'v13' WHERE resume_id = 'r-security' AND accomplishment_id = 'a1';
            COMMIT;`);
        } catch (error) {
          writerError = error;
          if (other.isTransaction) other.exec('ROLLBACK');
        }
      }
      return prepare(sql);
    }) as typeof lib.db.prepare;
    const snap = lib.snapshot();
    expect(fired).toBe(true);
    // Every variant referenced by a configuration exists in the same snapshot.
    for (const r of snap.resumes.values()) {
      for (const b of [...r.experiences, ...r.projects].flatMap((s) => s.bullets)) {
        expect(snap.variants.has(b.variantId), `${r.id} references ${b.variantId}`).toBe(true);
      }
    }
    // With the read transaction holding its lock, the concurrent writer is refused.
    expect(String(writerError)).toMatch(/locked|busy/i);
    other.close();
    lib.db.close();
  });
});

describe('#5 fixture records need fixed IDs; failures name their path and roll back', () => {
  it('an experience without an id is rejected and nothing is loaded', () => {
    const lib = new Library(openDatabase(':memory:'));
    const input = readFixture('primary.input.json');
    delete input.experiences[1].id;
    expect(() => loadFixture(lib, input)).toThrow(/experiences\[1\]\.id/);
    for (const rows of Object.values(dumpRows(lib.db))) expect(rows).toEqual([]);
  });
  it('a service error is labelled with the fixture path', () => {
    const lib = new Library(openDatabase(':memory:'));
    const input = readFixture('primary.input.json');
    input.variants[3].text = '';
    expect(() => loadFixture(lib, input)).toThrow(/variants\[3\]: variant\.text must not be empty/);
  });
});

describe('#6 Unicode line breaks and C1 controls are rejected', () => {
  for (const [name, ch] of [
    ['U+0085', '\u0085'],
    ['U+2028', '\u2028'],
    ['U+2029', '\u2029'],
  ] as [string, string][]) {
    it(name, () => {
      const lib = freshLibrary('primary.input.json');
      const before = dumpRows(lib.db);
      expect(runStep(lib, { action: 'editVariant', id: 'v11', text: `one${ch}two` })).toEqual({ status: 400, code: 'INVALID_INPUT' });
      expect(runStep(lib, { action: 'editAccomplishment', id: 'a1', patch: { fact: `one${ch}two` } })).toEqual({
        status: 400,
        code: 'INVALID_INPUT',
      });
      expect(dumpRows(lib.db)).toEqual(before);
    });
  }
});

describe('#7 the image rule applies only to exported fields', () => {
  const image = 'See ![diagram](https://example.com/d.png) here.';
  it('internal fields (fact, tags, resume name) accept image-like Markdown', () => {
    const lib = freshLibrary('primary.input.json');
    expect(lib.patchAccomplishment('a1', { fact: image, tags: [image] }).fact).toBe(image);
    expect(lib.createResume({ name: image }).name).toBe(image);
  });
  it('exported fields (variant text, skill keywords, profile label) reject it', () => {
    const lib = freshLibrary('primary.input.json');
    const before = dumpRows(lib.db);
    const code = { status: 400, code: 'INVALID_INPUT' };
    expect(runStep(lib, { action: 'editVariant', id: 'v11', text: image })).toEqual(code);
    expect(runStep(lib, { action: 'editProfile', patch: { label: image } })).toEqual(code);
    expect(() => lib.createSkill({ name: 'S', keywords: [image] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(dumpRows(lib.db)).toEqual(before);
  });
});

describe('round 2 #11 URL and email fields get the exported-text image check', () => {
  it('a URL whose path contains image Markdown is rejected and changes nothing', () => {
    const lib = freshLibrary('primary.input.json');
    const before = dumpRows(lib.db);
    const bad = 'https://example.com/![x](https://example.org/p.png)';
    expect(runStep(lib, { action: 'editExperience', id: 'e1', patch: { url: bad } })).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(runStep(lib, { action: 'editProfile', patch: { url: bad } })).toEqual({ status: 400, code: 'INVALID_INPUT' });
    expect(dumpRows(lib.db)).toEqual(before);
  });
});

describe('round 2 #5 a malformed fixture profile is a path-specific INVALID_INPUT', () => {
  for (const profile of [null, [], 'Sample Candidate']) {
    it(JSON.stringify(profile), () => {
      const lib = new Library(openDatabase(':memory:'));
      const input = readFixture('primary.input.json');
      input.profile = profile;
      expect(() => loadFixture(lib, input)).toThrow(
        expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringMatching(/^profile must be an object/) }),
      );
      for (const rows of Object.values(dumpRows(lib.db))) expect(rows).toEqual([]);
    });
  }
});

describe('round 2 #12 stored ordering gaps are visible in the snapshot', () => {
  it('a direct-SQL gap is reported per resume and a save repairs it', () => {
    const lib = freshLibrary('primary.input.json');
    expect(lib.snapshot().orderingProblems).toEqual(new Map());
    lib.db.exec("UPDATE resume_bullets SET sort_index = 7 WHERE resume_id = 'r-security' AND accomplishment_id = 'a1'");
    const problems = lib.snapshot().orderingProblems;
    expect([...problems.keys()]).toEqual(['r-security']);
    expect(problems.get('r-security')).toEqual(['bullets:e1 positions are [0, 7], expected 0..1']);
    const { id: _id, ...config } = lib.getResume('r-security');
    lib.saveResume('r-security', config);
    expect(lib.snapshot().orderingProblems).toEqual(new Map());
  });
});

describe('round 3 #12 stored positions must be real integers, read without loss', () => {
  it('a text position is rejected by the schema', () => {
    const lib = freshLibrary('primary.input.json');
    expect(() =>
      lib.db.exec("UPDATE resume_bullets SET sort_index = '0x1' WHERE resume_id = 'r-security' AND accomplishment_id = 'a1'"),
    ).toThrow(/constraint failed/);
  });
  it('an oversized integer is reported, not thrown, and a save repairs it', () => {
    const lib = freshLibrary('primary.input.json');
    lib.db.exec(
      "UPDATE resume_bullets SET sort_index = 9223372036854775807 WHERE resume_id = 'r-security' AND accomplishment_id = 'a1'",
    );
    const problems = lib.snapshot().orderingProblems;
    expect(problems.get('r-security')).toEqual(['bullets:e1 positions are [0, 9223372036854775807], expected 0..1']);
    const { id: _id, ...config } = lib.getResume('r-security');
    lib.saveResume('r-security', config);
    expect(lib.snapshot().orderingProblems).toEqual(new Map());
  });
});
