// Oracle self-tests (SPEC §7.3, required): each run plants a fault and the
// oracle must fail, and the named check must be the one that catches it.
// Faults are planted in a test-only rendering adapter, never in the app code.

import { describe, expect, it } from 'vitest';
import type { JsonResume } from '../../src/core/assemble.ts';
import { resumedBackend } from '../../src/render/adapter.ts';
import { pdf as resumedPdf, render as resumedRender } from 'resumed';
import * as even from 'jsonresume-theme-even';
import { readFixture } from '../support/harness.ts';
import { allProblems, caseById, runPdfOracle } from '../support/oracle.ts';
import { extractPdf, fullTextProblems, oracleProblems, readGolden } from '../support/pdf.ts';
import { insertBeforeFirstHighlight, probeRenderer } from '../support/render.ts';

const TIMEOUT = 60_000;
const T11 = caseById('T11');

describe('§7.3 oracle self-tests: every planted fault is caught', () => {
  it(
    '1: renderer input with an extra unselected library bullet → same-object rule and derived exclusions',
    async () => {
      const probe = probeRenderer();
      const real = probe.renderer;
      const corrupt = (doc: JsonResume): JsonResume => {
        const copy = structuredClone(doc);
        (copy.work[0]!.highlights as string[]).push('Automated collection of access review evidence.');
        return copy;
      };
      probe.renderer = { renderHtml: (d) => real.renderHtml(corrupt(d)), renderPdf: (d) => real.renderPdf(corrupt(d)) };
      const run = await runPdfOracle(T11, probe);
      expect(run.problems.sameObject).not.toEqual([]);
      expect(run.problems.exclusions).toEqual([expect.stringContaining('Automated collection of access review evidence.')]);
    },
    TIMEOUT,
  );

  it.each(['Injected novel bullet text that matches no fixture string.', '42%.', 'Sample Candidate'])(
    '2: correct input, an extra <li>%s</li> inserted before printing → printed-bullet sequence check',
    async (text) => {
      const run = await runPdfOracle(T11, probeRenderer({ inject: insertBeforeFirstHighlight(`<li><p>${text}</p></li>`) }));
      expect(run.problems.sameObject).toEqual([]); // the renderer input was correct
      expect(run.problems.printedBullets).toEqual([expect.stringContaining(text)]);
    },
    TIMEOUT,
  );

  const golden = readGolden(T11.name);
  (golden ? it : it.todo)(
    '3: correct input, a novel <p> outside any list → approved full-text check (and only that check)',
    async () => {
      const inject = insertBeforeFirstHighlight('<p>Injected paragraph outside any list.</p>');
      const run = await runPdfOracle(T11, probeRenderer({ inject }), golden!.segments);
      expect(run.problems.fullText).not.toEqual([]);
      const { fullText, ...others } = run.problems;
      expect(Object.values(others).flat()).toEqual([]); // why the full-text golden exists
    },
    TIMEOUT,
  );

  it(
    '4: one expected bullet dropped before printing → orderedBullets and printed-bullet check',
    async () => {
      const drop = (html: string) => html.replace('<li><p>Reviewed alert patterns to identify suspicious requests.</p></li>', '');
      const run = await runPdfOracle(T11, probeRenderer({ inject: drop }));
      expect(run.problems.oracle).toContain('orderedBullets: missing "Reviewed alert patterns to identify suspicious requests."');
      expect(run.problems.printedBullets).not.toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '5: two bullets swapped before printing → orderedBullets and printed-bullet check',
    async () => {
      const a = '<li><p>Documented access review findings for the team.</p></li>';
      const b = '<li><p>Reviewed alert patterns to identify suspicious requests.</p></li>';
      const swap = (html: string) => {
        if (!html.includes(a + b)) throw new Error('bullets not adjacent in the theme output');
        return html.replace(a + b, b + a);
      };
      const run = await runPdfOracle(T11, probeRenderer({ inject: swap }));
      expect(run.problems.oracle.some((p) => p.startsWith('orderedBullets: out of order'))).toBe(true);
      expect(run.problems.printedBullets).not.toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'a correct run passes every check (the faults above are what fails them)',
    async () => {
      expect(allProblems(await runPdfOracle(T11, probeRenderer()))).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('§7.3 self-test 6: symbol fidelity (independent cases)', () => {
  const MICRO = 'µ'; // µ MICRO SIGN
  const MU = 'μ'; // μ GREEK SMALL LETTER MU
  const html = (text: string) => `<!doctype html><html><body><p style="font-family: sans-serif">${text}</p></body></html>`;
  const print = (text: string) => resumedBackend.print(html(text), readFixture('security.expected.json'));

  it(
    '6a positive control: literal µ and ² extract exactly as µ and ²; pdf.js normalization would turn µ into μ',
    async () => {
      const bytes = await print(`Sensor 5 ${MICRO}m and area 10 m²`);
      expect((await extractPdf(bytes)).text).toBe(`Sensor 5 ${MICRO}m and area 10 m²`);
      // The control is meaningful: with pdf.js normalization re-enabled, it would fail.
      expect((await extractPdf(bytes, { pdfjsNormalization: true })).text).toContain(`5 ${MU}m`);
    },
    TIMEOUT,
  );

  it(
    '6b expected μ (U+03BC), PDF contains µ (U+00B5): the full-text check fails',
    async () => {
      const pdf = await extractPdf(await print(`Sensor 5 ${MICRO}m`));
      expect(fullTextProblems([`Sensor 5 ${MU}m`], pdf)).not.toEqual([]);
      expect(fullTextProblems([`Sensor 5 ${MICRO}m`], pdf)).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '6c expected ², PDF contains 2: the full-text check fails',
    async () => {
      const pdf = await extractPdf(await print('area 10 m2'));
      expect(fullTextProblems(['area 10 m²'], pdf)).not.toEqual([]);
      expect(fullTextProblems(['area 10 m2'], pdf)).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('debugging.md #1 regression: offline fallback font splits "fi" into its own run', () => {
  it(
    'offline Security PDF passes with the adjacency join; the old space-joined extractor fails on it',
    async () => {
      // Offline as in the Phase 0 gate: every non-loopback request goes to a dead proxy.
      const doc = readFixture('security.expected.json');
      const theme = even as unknown as Parameters<typeof resumedRender>[1];
      const html = await resumedRender(doc, theme);
      const bytes = await resumedPdf(html, doc, theme, { args: ['--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>'] });
      const oracle = readFixture('security.pdf.expected.json');
      expect(oracleProblems(oracle, await extractPdf(bytes), false)).toEqual([]);
      const broken = await extractPdf(bytes, { join: 'space' });
      expect(oracleProblems(oracle, broken, false)).toContain('orderedBullets: missing "Documented access review findings for the team."');
    },
    TIMEOUT,
  );
});
