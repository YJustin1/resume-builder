// Create/patch field rules shared by the service layer (SPEC §4 field rules).
// Create: required fields must be present; optional fields may be absent.
// Patch: an omitted key leaves the field unchanged, `null` clears an optional
// field, and a required field can never be cleared. Unknown keys are rejected.

import { invalidInput } from '../core/errors.ts';
import { date, dateOrder, email, onlyKeys, stringList, text, url } from '../core/fields.ts';

export interface FieldRule {
  required?: boolean;
  check: (value: unknown, field: string) => unknown;
}

export type Rules = Record<string, FieldRule>;

export function build(
  body: unknown,
  rules: Rules,
  what: string,
  current?: Record<string, unknown>,
): Record<string, unknown> {
  const input = onlyKeys(body, Object.keys(rules), what);
  const out: Record<string, unknown> = current ? { ...current } : {};
  if (!current) {
    for (const [key, rule] of Object.entries(rules)) {
      const value = input[key];
      if (value === undefined || value === null) {
        if (rule.required) throw invalidInput(`${what}.${key} is required`);
        continue;
      }
      out[key] = rule.check(value, `${what}.${key}`);
    }
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    const rule = rules[key];
    if (!rule || value === undefined) continue;
    if (value === null) {
      if (rule.required) throw invalidInput(`${what}.${key} is required and cannot be cleared`);
      delete out[key];
    } else {
      out[key] = rule.check(value, `${what}.${key}`);
    }
  }
  return out;
}

export function checkDates(record: Record<string, unknown>): void {
  dateOrder(record.startDate as string | undefined, record.endDate as string | undefined);
}

const textRule = (required = false): FieldRule => ({ required, check: text });
const dateRule: FieldRule = { check: date };
const urlRule: FieldRule = { check: url };

export const WORK_RULES: Rules = {
  name: textRule(true),
  position: textRule(true),
  location: textRule(),
  url: urlRule,
  startDate: dateRule,
  endDate: dateRule,
};

export const PROJECT_RULES: Rules = {
  name: textRule(true),
  url: urlRule,
  startDate: dateRule,
  endDate: dateRule,
};

export const ACCOMPLISHMENT_RULES: Rules = {
  fact: textRule(true),
  tags: { check: stringList },
};

export const VARIANT_RULES: Rules = { text: textRule(true) };

export const SKILL_RULES: Rules = {
  name: textRule(true),
  level: textRule(),
  keywords: { check: stringList },
};

const EDUCATION_RULES: Rules = {
  institution: textRule(true),
  area: textRule(),
  studyType: textRule(),
  startDate: dateRule,
  endDate: dateRule,
};

function education(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw invalidInput(`${field} must be an array`);
  return value.map((item, i) => {
    const e = build(item, EDUCATION_RULES, `${field}[${i}]`);
    checkDates(e);
    return e;
  });
}

export const PROFILE_RULES: Rules = {
  name: textRule(true),
  label: textRule(),
  email: { check: email },
  phone: textRule(),
  url: urlRule,
  // Optional in bodies; the service stores [] when absent or cleared.
  education: { check: education },
};
