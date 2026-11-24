// Seed loader for the v2 fixture input format (fixtures/README.md "Input
// format"). It goes through the service layer, so seeded data obeys exactly
// the same validation as user writes. The whole load is one transaction: an
// invalid fixture fails loudly and leaves the database unchanged.

import { invalidInput, ServiceError } from '../core/errors.ts';
import { id as checkId, onlyKeys } from '../core/fields.ts';
import { transaction } from './database.ts';
import type { Library } from './library.ts';

type Obj = Record<string, unknown>;

const list = (value: unknown, what: string): Obj[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidInput(`${what} must be an array`);
  return value as Obj[];
};

function split<T extends Obj>(record: T, key: string): [unknown, Obj] {
  const { [key]: picked, ...rest } = record;
  return [picked, rest];
}

export function loadFixture(lib: Library, input: unknown): void {
  transaction(lib.db, () => load(lib, input));
}

/** Run one fixture item, labelling any failure with its fixture path. */
function at<T>(path: string, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ServiceError) throw new ServiceError(error.code, `${path}: ${error.message}`);
    throw error;
  }
}

/** Fixture records must carry a fixed, valid ID (fixtures/README.md). */
function fixtureId(raw: Obj, path: string): string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw invalidInput(`${path} must be an object`);
  if (raw.id === undefined) throw invalidInput(`${path}.id is required in fixtures`);
  return checkId(raw.id, `${path}.id`);
}

function load(lib: Library, input: unknown): void {
  const root = onlyKeys(
    input,
    ['profile', 'experiences', 'projects', 'skills', 'accomplishments', 'variants', 'resumes'],
    'fixture',
  );

  if (root.profile !== undefined) {
    const [legacySkills, profile] = split(root.profile as Obj, 'skills');
    if (legacySkills !== undefined && !(Array.isArray(legacySkills) && legacySkills.length === 0)) {
      throw invalidInput('profile.skills is a legacy key and must be [] (skills live in the top-level library)');
    }
    at('profile', () => lib.putProfile(profile));
  }

  list(root.experiences, 'experiences').forEach((raw, i) => {
    const path = `experiences[${i}]`;
    const id = fixtureId(raw, path);
    at(path, () => lib.createEntry('work', split(raw, 'id')[1], { id }));
  });
  list(root.projects, 'projects').forEach((raw, i) => {
    const path = `projects[${i}]`;
    const id = fixtureId(raw, path);
    at(path, () => lib.createEntry('project', split(raw, 'id')[1], { id }));
  });
  list(root.skills, 'skills').forEach((raw, i) => {
    const path = `skills[${i}]`;
    const id = fixtureId(raw, path);
    at(path, () => lib.createSkill(split(raw, 'id')[1], { id }));
  });
  list(root.accomplishments, 'accomplishments').forEach((raw, i) => {
    const path = `accomplishments[${i}]`;
    const id = fixtureId(raw, path);
    const { id: _id, experienceId, projectId, ...body } = raw;
    if ((experienceId === undefined) === (projectId === undefined)) {
      throw invalidInput(`${path} needs exactly one of experienceId or projectId`);
    }
    const kind = experienceId !== undefined ? 'work' : 'project';
    const parent = checkId(experienceId ?? projectId, `${path}.${kind === 'work' ? 'experienceId' : 'projectId'}`);
    at(path, () => lib.createAccomplishment(kind, parent, body, { id }));
  });
  list(root.variants, 'variants').forEach((raw, i) => {
    const path = `variants[${i}]`;
    const id = fixtureId(raw, path);
    const { id: _id, accomplishmentId, ...body } = raw;
    const parent = checkId(accomplishmentId, `${path}.accomplishmentId`);
    at(path, () => lib.createVariant(parent, body, { id }));
  });
  list(root.resumes, 'resumes').forEach((raw, i) => {
    const path = `resumes[${i}]`;
    const id = fixtureId(raw, path);
    const { id: _id, ...config } = raw;
    at(path, () => {
      lib.createResume({ name: config.name }, { id });
      lib.saveResume(id, config);
    });
  });
}
