// The full §7.3 oracle for one PDF fixture case, run end to end through the
// HTTP API and the real pipeline. Returns problems grouped by check, so the
// self-tests can show which check catches which fault.

import { freshLibrary, readFixture } from './harness.ts';
import { Api } from './http.ts';
import {
  derivedExclusions,
  absentProblems,
  fullTextProblems,
  marginProblems,
  oracleProblems,
  splitBulletProblems,
  printedBulletProblems,
  readGolden,
  type Extracted,
  type PdfOracle,
} from './pdf.ts';
import { isDeepStrictEqual } from 'node:util';
import type { Probe } from './render.ts';

export interface PdfCase {
  id: string;
  /** Basename shared by `<name>.pdf.expected.json` and `<name>.pdf.text.txt`. */
  name: string;
  input: string;
  resume: string;
  expected: string;
}

export const PDF_CASES: PdfCase[] = [
  { id: 'T11', name: 'security', input: 'primary.input.json', resume: 'r-security', expected: 'security.expected.json' },
  { id: 'T12', name: 'overflow', input: 'overflow.input.json', resume: 'r-overflow', expected: 'overflow.expected.json' },
  { id: 'T23', name: 'sections', input: 'sections.input.json', resume: 'r-platform', expected: 'sections.platform.expected.json' },
];

export const caseById = (id: string) => PDF_CASES.find((c) => c.id === id)!;

export interface OracleRun {
  problems: {
    json: string[];
    sameObject: string[];
    oracle: string[];
    exclusions: string[];
    printedBullets: string[];
    fullText: string[];
    headers: string[];
    /** D19: margins and whole bullets. */
    layout: string[];
  };
  /** Derived exclusion strings skipped as substrings of selected text (reported, §7.3). */
  skipped: string[];
  pdf: Extracted;
  headers: Headers;
  printedHtml: string;
  bytes: Uint8Array;
}

export async function runPdfOracle(c: PdfCase, probe?: Probe, golden = readGolden(c.name).segments): Promise<OracleRun> {
  const api = new Api(freshLibrary(c.input), probe);
  const expected = readFixture(c.expected);
  const oracle = readFixture<PdfOracle>(`${c.name}.pdf.expected.json`);

  const json = await api.exportJson(c.resume);
  const jsonProblems = json.status === 200 && isDeepStrictEqual(json.body, expected) ? [] : [`JSON export differs from ${c.expected}`];

  const renderedBefore = api.probe.rendered.length;
  const { pdf, headers, printedHtml, bytes } = await api.printed(c.resume);
  const rendered = api.probe.rendered.slice(renderedBefore);
  const sameObject =
    rendered.length === 1 && isDeepStrictEqual(rendered[0], expected) ? [] : [`document passed to the renderer is not ${c.expected}`];

  const pages = Number(headers.get('x-page-count'));
  const warning = headers.get('x-overflow-warning');
  const headerProblems: string[] = [];
  if (pages !== pdf.pageCount) headerProblems.push(`X-Page-Count ${headers.get('x-page-count')} != ${pdf.pageCount} pages in the PDF`);
  if (warning !== String(pdf.pageCount > 1)) headerProblems.push(`X-Overflow-Warning ${warning} with ${pdf.pageCount} pages`);

  const exclusions = derivedExclusions(readFixture(c.input), c.resume, expected);
  return {
    problems: {
      json: jsonProblems,
      sameObject,
      oracle: oracleProblems(oracle, pdf, warning === 'true'),
      exclusions: absentProblems('derived exclusion', pdf.text, exclusions.absent),
      printedBullets: printedBulletProblems(printedHtml, expected),
      fullText: fullTextProblems(golden, pdf),
      headers: headerProblems,
      layout: [
        ...marginProblems(pdf),
        ...splitBulletProblems(pdf, [...(expected.work ?? []), ...(expected.projects ?? [])].flatMap((e: any) => e.highlights ?? [])),
      ],
    },
    skipped: exclusions.skipped,
    pdf,
    headers,
    printedHtml,
    bytes,
  };
}

export const allProblems = (run: OracleRun) => Object.values(run.problems).flat();
