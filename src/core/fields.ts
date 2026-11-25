// Write-time field validation (SPEC §4 "Field rules", "Dates", §3.5 rule 1).
// Every check runs before any write; a failure is INVALID_INPUT and nothing
// is stored.

import { createRequire } from 'node:module';
import { invalidInput } from './errors.ts';

const require = createRequire(import.meta.url);

// The pinned JSON Resume validator, used for formats so our rules cannot
// drift from what export-time validation accepts.
const schema = require('@jsonresume/schema') as {
  validate: (doc: unknown, cb: (err: unknown, valid: boolean) => void) => void;
};

// The Markdown parser the theme itself uses (SPEC §3.5): resolved from
// jsonresume-theme-even's location, not declared as our own dependency.
const themeRequire = createRequire(require.resolve('jsonresume-theme-even'));
const micromark = themeRequire('micromark') as (markdown: string) => string;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Unicode control characters (C0, DEL, C1 including U+0085) and the line and
// paragraph separators U+2028/U+2029: none may appear in a single-line field.
const CONTROL = /[\p{Cc}\u2028\u2029]/u;

export function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalidInput(`${field} must be a valid ID`);
  return value;
}

/** True when the text renders an image through the theme's Markdown parser. */
export function rendersImage(text: string): boolean {
  return /<img\b/i.test(micromark(text));
}

/**
 * True when the text renders as NO visible text through the theme's Markdown
 * parser: a "[label]: url" reference definition, a "---"/"***"/"___" rule, an
 * empty code fence, a bare "*" list marker, "[]()", "&nbsp;" (Codex Phase 3
 * review, finding 6). FR-06 forbids silently dropped content. micromark escapes
 * text, so stripping its own tags and entities leaves exactly the visible text.
 */
export function rendersNoText(text: string): boolean {
  const visible = micromark(text)
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|amp|quot|#39);/g, 'x');
  return !/[^\s\u00a0]/.test(visible);
}

/**
 * A single-line plain-text field: trimmed, nonempty, no control characters or
 * line/paragraph separators. Used for internal fields (facts, tags, resume
 * names) that are never exported.
 */
export function plainText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalidInput(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') throw invalidInput(`${field} must not be empty`);
  if (CONTROL.test(trimmed)) throw invalidInput(`${field} must be a single line without control characters`);
  return trimmed;
}

/**
 * An exported text field (SPEC §3.5 rule 1): plain-text rules plus no
 * Markdown that renders an image through the theme's parser.
 */
export function text(value: unknown, field: string): string {
  const s = plainText(value, field);
  if (rendersImage(s)) throw invalidInput(`${field} must not contain Markdown that renders an image`);
  return s;
}

/**
 * Text the theme renders as Markdown (wording variants, i.e. highlights): the
 * exported-text rules plus at least some visible text once rendered (D21).
 */
export function markdownText(value: unknown, field: string): string {
  const s = text(value, field);
  if (rendersNoText(s)) {
    throw invalidInput(
      `${field} would print nothing: the theme reads it as Markdown with no visible text ` +
        '(for example a "[label]: url" reference definition or a "---" rule); reword it',
    );
  }
  return s;
}

function validates(doc: unknown): boolean {
  return validateResumeDocument(doc).length === 0;
}

/** Validate a whole JSON Resume document with the pinned validator; returns error messages. */
export function validateResumeDocument(doc: unknown): string[] {
  let messages: string[] = [];
  schema.validate(doc, (err, valid) => {
    if (valid) return;
    const list = Array.isArray(err) ? err : [err];
    messages = list.map((e) => {
      const r = e as { property?: string; message?: string };
      return `${r.property ?? 'resume'} ${r.message ?? String(e)}`.trim();
    });
  });
  return messages;
}

export function date(value: unknown, field: string): string {
  const s = plainText(value, field);
  // The pinned validator decides the format (its iso8601 definition), so write
  // and export rules cannot drift; the calendar check below is ours.
  if (!validates({ basics: { name: 'x' }, work: [{ name: 'x', startDate: s }] })) {
    throw invalidInput(`${field} must be YYYY, YYYY-MM or YYYY-MM-DD (years 1000-2999)`);
  }
  const [y, m, d] = s.split('-').map(Number);
  if (y !== undefined && m !== undefined && d !== undefined) {
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
      throw invalidInput(`${field} is not a real calendar date`);
    }
  }
  return s;
}

/** End must not be before start, compared at their common precision. */
export function dateOrder(start: string | undefined, end: string | undefined): void {
  if (start === undefined || end === undefined) return;
  const n = Math.min(start.length, end.length);
  if (end.slice(0, n) < start.slice(0, n)) throw invalidInput('endDate must not be before startDate');
}

export function email(value: unknown, field: string): string {
  const s = text(value, field); // exported: includes the image check
  if (!validates({ basics: { name: 'x', email: s } })) throw invalidInput(`${field} is not a valid email address`);
  return s;
}

export function url(value: unknown, field: string): string {
  const s = text(value, field); // exported: includes the image check
  if (!validates({ basics: { name: 'x', url: s } })) throw invalidInput(`${field} is not a valid URI`);
  const scheme = s.slice(0, s.indexOf(':')).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') throw invalidInput(`${field} must use http or https`);
  return s;
}

/** An ordered list of nonempty single-line strings, each checked by `item`. */
export function stringList(item: (value: unknown, field: string) => string) {
  return (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) throw invalidInput(`${field} must be an array of strings`);
    return value.map((v, i) => item(v, `${field}[${i}]`));
  };
}

/** Reject keys outside the allowed set (no silent ignoring of typos). */
export function onlyKeys(body: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalidInput(`${what} must be an object`);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalidInput(`${what}: unknown or immutable field "${key}"`);
  }
  return body as Record<string, unknown>;
}
