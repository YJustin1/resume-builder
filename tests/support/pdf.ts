// PDF text, order and overflow oracle (SPEC §7.3). Everything here reads the
// actual PDF bytes, the exact HTML handed to the printer, or the independent
// input/expected fixtures; nothing is derived from application output except
// the owner-reviewed full-text goldens, which are a documented exception.

import { existsSync, readFileSync } from 'node:fs';
import { openPdf } from '../../src/render/pages.ts';
import { attr, elements, parseHtml, textContent } from '../../src/render/dom.ts';
import { FIXTURES } from './harness.ts';

// ---------------------------------------------------------------- extraction

interface Run {
  str: string;
  x: number;
  y: number;
  width: number;
}

/** Same line when the baselines differ by at most this much (pt). */
const LINE_TOLERANCE = 2;
/** Runs closer than this on one line abut and are joined with no separator (pt). */
const ABUT_TOLERANCE = 1.5;

/** Latin ligatures U+FB00–U+FB06, an extractor artefact; nothing else is normalized. */
const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st', // ſt
  'ﬆ': 'st',
};

export function normalizeText(text: string): string {
  return text
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c]!)
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Extracted {
  pageCount: number;
  /** Position-ordered visual lines, one array per page, before normalization. */
  lines: string[][];
  /** Normalized full text (§7.3). */
  text: string;
}

function linesOf(runs: Run[], join: 'adjacency' | 'space'): string[] {
  const sorted = [...runs].sort((a, b) => (Math.abs(b.y - a.y) > LINE_TOLERANCE ? b.y - a.y : a.x - b.x));
  const lines: Run[][] = [];
  for (const run of sorted) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0]!.y - run.y) <= LINE_TOLERANCE) line.push(run);
    else lines.push([run]);
  }
  return lines.map((line) => {
    let out = '';
    let prev: Run | undefined;
    for (const run of line) {
      const abuts = prev !== undefined && Math.abs(run.x - (prev.x + prev.width)) < ABUT_TOLERANCE;
      out += prev === undefined || (join === 'adjacency' && abuts) ? run.str : ` ${run.str}`;
      prev = run;
    }
    return out;
  });
}

export interface ExtractOptions {
  /** 'space' is the broken pre-fix join, kept only for the debugging.md #1 regression test. */
  join?: 'adjacency' | 'space';
  /** pdf.js's own Unicode normalization; on only to prove the µ control (self-test 6a). */
  pdfjsNormalization?: boolean;
}

/**
 * Extract text with pdf.js (its normalization disabled, so µ stays µ), sort
 * runs by position and join them per §7.3.
 */
export async function extractPdf(bytes: Uint8Array, options: ExtractOptions = {}): Promise<Extracted> {
  const join = options.join ?? 'adjacency';
  const task = openPdf(bytes);
  try {
    const doc = await task.promise;
    const lines: string[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent({ disableNormalization: !options.pdfjsNormalization });
      const runs: Run[] = [];
      for (const item of content.items) {
        if (!('str' in item) || item.str === '') continue;
        runs.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      lines.push(linesOf(runs, join));
    }
    const text = normalizeText(lines.map((page) => page.join(' ')).join(' '));
    if (doc.numPages < 1) throw new Error('PDF has no pages');
    if (text === '') throw new Error('PDF has no extractable text');
    return { pageCount: doc.numPages, lines, text };
  } finally {
    await task.destroy();
  }
}

// ---------------------------------------------------------------- assertions

export interface PdfOracle {
  case?: string;
  pageCount?: number;
  minPages?: number;
  orderedHeaders?: string[];
  orderedBullets?: string[];
  orderedSequence?: string[];
  absentText?: string[];
  absentInternalText?: string[];
  overflowWarning?: boolean;
}

export function occurrences(haystack: string, needle: string): number {
  if (needle === '') throw new Error('empty needle');
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
}

const short = (s: string) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);

/** Each string exactly once, at strictly increasing offsets. Returns problems (empty when it holds). */
export function orderedProblems(label: string, text: string, list: string[]): string[] {
  const problems: string[] = [];
  let last = -1;
  for (const raw of list) {
    const s = normalizeText(raw);
    const n = occurrences(text, s);
    if (n === 0) problems.push(`${label}: missing "${short(s)}"`);
    else if (n > 1) problems.push(`${label}: duplicated ${n}x "${short(s)}"`);
    else {
      const at = text.indexOf(s);
      if (at <= last) problems.push(`${label}: out of order "${short(s)}"`);
      last = at;
    }
  }
  return problems;
}

export function absentProblems(label: string, text: string, list: string[]): string[] {
  return list.map(normalizeText).flatMap((s) => {
    const n = occurrences(text, s);
    return n === 0 ? [] : [`${label}: unexpected ${n}x "${short(s)}"`];
  });
}

/** Every §7.3 assertion a `*.pdf.expected.json` oracle carries, against an extraction and the export's warning flag. */
export function oracleProblems(oracle: PdfOracle, pdf: Extracted, overflowWarning?: boolean): string[] {
  const p = [
    ...orderedProblems('orderedHeaders', pdf.text, oracle.orderedHeaders ?? []),
    ...orderedProblems('orderedBullets', pdf.text, oracle.orderedBullets ?? []),
    ...orderedProblems('orderedSequence', pdf.text, oracle.orderedSequence ?? []),
    ...absentProblems('absentText', pdf.text, oracle.absentText ?? []),
    ...absentProblems('absentInternalText', pdf.text, oracle.absentInternalText ?? []),
  ];
  if (oracle.pageCount !== undefined && pdf.pageCount !== oracle.pageCount) p.push(`pageCount ${pdf.pageCount} != ${oracle.pageCount}`);
  if (oracle.minPages !== undefined && pdf.pageCount < oracle.minPages) p.push(`pageCount ${pdf.pageCount} < minPages ${oracle.minPages}`);
  if (oracle.overflowWarning !== undefined && overflowWarning !== oracle.overflowWarning) {
    p.push(`overflowWarning ${overflowWarning} != ${oracle.overflowWarning}`);
  }
  return p;
}

// ---------------------------------------------------------------- derived exclusion set

export interface Exclusions {
  absent: string[];
  /** Library strings skipped because they occur inside a selected string (reported, §7.3). */
  skipped: string[];
}

/** All string leaves of a document. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

/**
 * From the INPUT fixture only: every library string not selected for the resume
 * (unselected variant texts, every fact, unselected entry and skill names).
 * "Selected strings" are the string fields of the independent expected JSON.
 */
export function derivedExclusions(input: any, resumeId: string, expectedDoc: unknown): Exclusions {
  const resume = (input.resumes as any[]).find((r) => r.id === resumeId);
  if (!resume) throw new Error(`no resume ${resumeId} in input fixture`);
  const sections = [...(resume.experiences ?? []), ...(resume.projects ?? [])];
  const selectedVariants = new Set(sections.flatMap((s: any) => s.bullets.map((b: any) => b.variantId)));
  const selectedEntries = new Set(sections.map((s: any) => s.experienceId ?? s.projectId));
  const selectedSkills = new Set(resume.skills ?? []);
  const candidates = [
    ...(input.variants ?? []).filter((v: any) => !selectedVariants.has(v.id)).map((v: any) => v.text),
    ...(input.accomplishments ?? []).map((a: any) => a.fact),
    ...[...(input.experiences ?? []), ...(input.projects ?? [])].filter((e: any) => !selectedEntries.has(e.id)).map((e: any) => e.name),
    ...(input.skills ?? []).filter((s: any) => !selectedSkills.has(s.id)).map((s: any) => s.name),
  ].map(normalizeText);
  const selected = strings(expectedDoc).map(normalizeText);
  const absent: string[] = [];
  const skipped: string[] = [];
  for (const c of new Set(candidates)) (selected.some((s) => s.includes(c)) ? skipped : absent).push(c);
  return { absent, skipped };
}

// ---------------------------------------------------------------- printed-bullet sequence check

/** Text of every <li> in document order, HTML-unescaped and whitespace-normalized. */
export function listItems(html: string): string[] {
  return [...elements(parseHtml(html))].filter((el) => el.tagName === 'li').map((el) => normalizeText(textContent(el)));
}

/**
 * §7.3: after the leading contact items (as a multiset, the expected document's
 * present basics.email / phone / url), the <li> texts of the printed HTML must
 * equal exactly the work highlights, then the project highlights, then the
 * skill keywords (skill by skill), in order.
 *
 * PENDING OWNER APPROVAL: the skill keywords. SPEC §7.3 says Even renders
 * skills without <li>, but Even 0.27.0 renders each skill keyword as <li>
 * (ul.tag-list), which T23 exercises.
 */
export function printedBulletProblems(printedHtml: string, expectedDoc: any): string[] {
  const items = listItems(printedHtml);
  const contacts = ['email', 'phone', 'url'].map((k) => expectedDoc.basics?.[k]).filter((v): v is string => typeof v === 'string');
  const highlights = [
    ...[...(expectedDoc.work ?? []), ...(expectedDoc.projects ?? [])].flatMap((e: any) => e.highlights ?? []),
    ...(expectedDoc.skills ?? []).flatMap((s: any) => s.keywords ?? []),
  ].map(normalizeText);
  const problems: string[] = [];
  const leading = items.slice(0, contacts.length);
  const sortJson = (a: string[]) => JSON.stringify([...a].map(normalizeText).sort());
  if (sortJson(leading) !== sortJson(contacts)) {
    problems.push(`contact items ${JSON.stringify(leading)} != ${JSON.stringify(contacts)}`);
  }
  const rest = items.slice(contacts.length);
  if (JSON.stringify(rest) !== JSON.stringify(highlights)) {
    const at = rest.findIndex((s, i) => s !== highlights[i]);
    const i = at === -1 ? Math.min(rest.length, highlights.length) : at;
    problems.push(
      `printed <li> sequence differs at item ${i + 1}: printed "${short(rest[i] ?? '(end)')}", expected "${short(highlights[i] ?? '(end)')}" ` +
        `(${rest.length} printed, ${highlights.length} expected)`,
    );
  }
  return problems;
}

/** Non-empty <a href> values inside the given elements' subtrees, or the whole document. */
export function hrefs(html: string, within?: string): string[] {
  const roots = [...elements(parseHtml(html))].filter((el) => within === undefined || el.tagName === within);
  const seen = new Set<object>();
  const out: string[] = [];
  for (const root of roots) {
    for (const el of elements(root)) {
      if (seen.has(el) || el.tagName !== 'a') continue;
      seen.add(el);
      const href = attr(el, 'href');
      if (href !== undefined && href.trim() !== '') out.push(href);
    }
  }
  return out;
}

/** Every href attribute value on any element, empty ones included. */
export function hrefValues(html: string): string[] {
  return [...elements(parseHtml(html))].flatMap((el) => el.attrs.filter((a) => a.name === 'href').map((a) => a.value));
}

export function elementNames(html: string): Set<string> {
  return new Set([...elements(parseHtml(html))].map((el) => el.tagName));
}

// ---------------------------------------------------------------- approved full-text goldens

export interface Golden {
  /** The `# Approved:` line (reviewer, date, renderer version). */
  approval: string;
  /** Reviewed segments, one visual line each, in reading order. */
  segments: string[];
}

/**
 * `fixtures/<case>.pdf.text.txt`: `#` lines are metadata and must include an
 * `# Approved:` line; every other non-empty line is one reviewed segment. The
 * golden text is the segments joined with single spaces.
 */
export function parseGolden(source: string): Golden {
  const lines = source.split('\n');
  const approval = lines.find((l) => l.startsWith('# Approved:'));
  if (!approval) throw new Error('golden has no "# Approved:" line; it has not been reviewed');
  const segments = lines.filter((l) => !l.startsWith('#') && l.trim() !== '');
  return { approval, segments };
}

export function goldenPath(name: string): URL {
  return new URL(`${name}.pdf.text.txt`, FIXTURES);
}

export function readGolden(name: string): Golden | undefined {
  const path = goldenPath(name);
  return existsSync(path) ? parseGolden(readFileSync(path, 'utf8')) : undefined;
}

/**
 * Exact equality of the normalized PDF text with the golden. The golden side
 * is NOT normalized beyond joining segments (so an expected `²` never folds to `2`).
 */
export function fullTextProblems(segments: string[], pdf: Extracted): string[] {
  const expected = segments.map((s) => s.trim()).join(' ');
  if (pdf.text === expected) return [];
  let i = 0;
  while (i < expected.length && expected[i] === pdf.text[i]) i++;
  const window = (s: string) => JSON.stringify(s.slice(Math.max(0, i - 30), i + 40));
  return [`full text differs at offset ${i}: got ${window(pdf.text)}, expected ${window(expected)}`];
}

/** A candidate golden from a real extraction, for owner review (never committed unreviewed). */
export function candidateGolden(pdf: Extracted, header: string[]): string {
  const segments = pdf.lines.flat().map(normalizeText).filter(Boolean);
  return [...header.map((h) => `# ${h}`), ...segments, ''].join('\n');
}
