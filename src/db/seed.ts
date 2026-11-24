// Seed loader for the v2 fixture input format (fixtures/README.md "Input
// format"). It goes through the service layer, so seeded data obeys exactly
// the same validation as user writes. The whole load is one transaction: an
// invalid fixture fails loudly and leaves the database unchanged.

import { invalidInput } from '../core/errors.ts';
import { onlyKeys } from '../core/fields.ts';
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
    lib.putProfile(profile);
  }

  for (const raw of list(root.experiences, 'experiences')) {
    const [id, body] = split(raw, 'id');
    lib.createEntry('work', body, { id: id as string });
  }
  for (const raw of list(root.projects, 'projects')) {
    const [id, body] = split(raw, 'id');
    lib.createEntry('project', body, { id: id as string });
  }
  for (const raw of list(root.skills, 'skills')) {
    const [id, body] = split(raw, 'id');
    lib.createSkill(body, { id: id as string });
  }
  for (const raw of list(root.accomplishments, 'accomplishments')) {
    const { id, experienceId, projectId, ...body } = raw;
    if ((experienceId === undefined) === (projectId === undefined)) {
      throw invalidInput(`accomplishment ${String(id)} needs exactly one of experienceId or projectId`);
    }
    const [kind, parent] = experienceId !== undefined ? (['work', experienceId] as const) : (['project', projectId] as const);
    lib.createAccomplishment(kind, parent as string, body, { id: id as string });
  }
  for (const raw of list(root.variants, 'variants')) {
    const { id, accomplishmentId, ...body } = raw;
    lib.createVariant(accomplishmentId as string, body, { id: id as string });
  }
  for (const raw of list(root.resumes, 'resumes')) {
    const { id, ...config } = raw;
    lib.createResume({ name: config.name }, { id: id as string });
    lib.saveResume(id as string, config);
  }
}
