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
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/;
// Pinned schema iso8601 pattern (packages/schema/schema.json, definitions.iso8601).
const ISO8601 =
  /^([1-2][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|[1-2][0-9]{3}-(0[1-9]|1[0-2])|[1-2][0-9]{3})$/;

export function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalidInput(`${field} must be a valid ID`);
  return value;
}

/** True when the text renders an image through the theme's Markdown parser. */
export function rendersImage(text: string): boolean {
  return /<img\b/i.test(micromark(text));
}

/**
 * A required single-line plain-text field: trimmed, nonempty, no control
 * characters, and no Markdown that renders an image.
 */
export function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalidInput(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed === '') throw invalidInput(`${field} must not be empty`);
  if (CONTROL.test(trimmed)) throw invalidInput(`${field} must be a single line without control characters`);
  if (rendersImage(trimmed)) throw invalidInput(`${field} must not contain Markdown that renders an image`);
  return trimmed;
}

function validates(doc: unknown): boolean {
  let ok = false;
  schema.validate(doc, (_err, valid) => {
    ok = valid;
  });
  return ok;
}

export function date(value: unknown, field: string): string {
  const s = text(value, field);
  if (!ISO8601.test(s)) throw invalidInput(`${field} must be YYYY, YYYY-MM or YYYY-MM-DD (years 1000-2999)`);
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
  const s = text(value, field);
  if (!validates({ basics: { name: 'x', email: s } })) throw invalidInput(`${field} is not a valid email address`);
  return s;
}

export function url(value: unknown, field: string): string {
  const s = text(value, field);
  if (!validates({ basics: { name: 'x', url: s } })) throw invalidInput(`${field} is not a valid URI`);
  const scheme = s.slice(0, s.indexOf(':')).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') throw invalidInput(`${field} must use http or https`);
  return s;
}

/** An ordered list of nonempty single-line strings (tags, keywords). */
export function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw invalidInput(`${field} must be an array of strings`);
  return value.map((item, i) => text(item, `${field}[${i}]`));
}

/** Reject keys outside the allowed set (no silent ignoring of typos). */
export function onlyKeys(body: unknown, allowed: readonly string[], what: string): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw invalidInput(`${what} must be an object`);
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalidInput(`${what}: unknown or immutable field "${key}"`);
  }
  return body as Record<string, unknown>;
}
