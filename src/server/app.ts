// HTTP API (SPEC §6). A thin layer over the service: parse JSON, call one
// Library method, map ServiceErrors to `{ error: { code, message,
// affectedResumes? } }`. Phase 2 serves everything except /preview and
// /export/pdf (Phase 3).

import { Hono, type Context } from 'hono';
import { invalidInput, notFound, ServiceError } from '../core/errors.ts';
import type { EntryKind } from '../core/types.ts';
import type { Library } from '../db/library.ts';

function errorBody(error: ServiceError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.code === 'RECORD_IN_USE' && error.affectedResumes ? { affectedResumes: error.affectedResumes } : {}),
    },
  };
}

async function body(c: Context): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === '') throw invalidInput('request body must be JSON');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalidInput('request body is not valid JSON');
  }
}

export function createApp(lib: Library): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ServiceError) return c.json(errorBody(error), error.status as 400);
    // No stack traces or internal messages to clients (SPEC §6).
    return c.json({ error: { code: 'ASSEMBLY_FAILED', message: 'Unexpected server error' } }, 500);
  });
  app.notFound((c) => c.json(errorBody(notFound(`no route for ${c.req.method} ${c.req.path}`)), 404));

  // ---- Profile ----
  app.get('/api/profile', (c) => c.json({ profile: lib.getProfile() }));
  app.put('/api/profile', async (c) => {
    const { created, profile } = lib.putProfile(await body(c));
    return c.json({ profile }, created ? 201 : 200);
  });
  app.patch('/api/profile', async (c) => c.json({ profile: lib.patchProfile(await body(c)) }));

  // ---- Entries: experiences (work) and projects ----
  for (const [path, kind] of [
    ['experiences', 'work'],
    ['projects', 'project'],
  ] as [string, EntryKind][]) {
    const type = kind === 'work' ? 'experience' : 'project';
    app.get(`/api/${path}`, (c) => c.json(lib.listEntries(kind)));
    app.post(`/api/${path}`, async (c) => c.json(lib.createEntry(kind, await body(c)), 201));
    app.get(`/api/${path}/:id`, (c) => c.json(lib.getEntry(kind, c.req.param('id'))));
    app.patch(`/api/${path}/:id`, async (c) => c.json(lib.patchEntry(kind, c.req.param('id'), await body(c))));
    app.delete(`/api/${path}/:id`, (c) => {
      lib.deleteRecord(type, c.req.param('id'));
      return c.body(null, 204);
    });
    app.post(`/api/${path}/:id/accomplishments`, async (c) =>
      c.json(lib.createAccomplishment(kind, c.req.param('id'), await body(c)), 201),
    );
  }

  // ---- Accomplishments and wording variants ----
  app.patch('/api/accomplishments/:id', async (c) => c.json(lib.patchAccomplishment(c.req.param('id'), await body(c))));
  app.delete('/api/accomplishments/:id', (c) => {
    lib.deleteRecord('accomplishment', c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/api/accomplishments/:id/variants', async (c) =>
    c.json(lib.createVariant(c.req.param('id'), await body(c)), 201),
  );
  app.patch('/api/variants/:id', async (c) => c.json(lib.patchVariant(c.req.param('id'), await body(c))));
  app.delete('/api/variants/:id', (c) => {
    lib.deleteRecord('variant', c.req.param('id'));
    return c.body(null, 204);
  });

  // ---- Skills ----
  app.get('/api/skills', (c) => c.json(lib.listSkills()));
  app.post('/api/skills', async (c) => c.json(lib.createSkill(await body(c)), 201));
  app.patch('/api/skills/:id', async (c) => c.json(lib.patchSkill(c.req.param('id'), await body(c))));
  app.delete('/api/skills/:id', (c) => {
    lib.deleteRecord('skill', c.req.param('id'));
    return c.body(null, 204);
  });

  // ---- Library view and impact ----
  app.get('/api/library', (c) => c.json(libraryView(lib)));
  app.post('/api/impact', async (c) => c.json(lib.impact(await body(c))));

  // ---- Resumes ----
  app.get('/api/resumes', (c) => c.json(lib.listResumes()));
  app.post('/api/resumes', async (c) => c.json(lib.createResume(await body(c)), 201));
  app.get('/api/resumes/:id', (c) => c.json(lib.getResume(c.req.param('id'))));
  app.put('/api/resumes/:id', async (c) => c.json(lib.saveResume(c.req.param('id'), await body(c))));
  app.delete('/api/resumes/:id', (c) => {
    lib.deleteResume(c.req.param('id'));
    return c.body(null, 204);
  });
  app.get('/api/resumes/:id/export/json', (c) => {
    const id = c.req.param('id');
    const doc = lib.assemble(id);
    c.header('Content-Disposition', `attachment; filename="resume-${id}.json"`);
    return c.json(doc);
  });

  return app;
}

/** Nested library for the editor and picker, with per-record usage counts. */
function libraryView(lib: Library) {
  const snap = lib.snapshot();
  const configs = [...snap.resumes.values()];
  const bullets = configs.flatMap((r) => [...r.experiences, ...r.projects].flatMap((s) => s.bullets.map((b) => ({ r: r.id, ...b }))));
  const count = (ids: string[]) => new Set(ids).size;
  const usage = {
    entry: (id: string) =>
      count(configs.filter((r) => r.experiences.some((s) => s.experienceId === id) || r.projects.some((s) => s.projectId === id)).map((r) => r.id)),
    accomplishment: (id: string) => count(bullets.filter((b) => b.accomplishmentId === id).map((b) => b.r)),
    variant: (id: string) => count(bullets.filter((b) => b.variantId === id).map((b) => b.r)),
    skill: (id: string) => count(configs.filter((r) => r.skills.includes(id)).map((r) => r.id)),
  };
  const entryView = (kind: EntryKind) =>
    [...snap.entries.values()]
      .filter((e) => e.kind === kind)
      .map((e) => ({
        ...e,
        usage: usage.entry(e.id),
        accomplishments: [...snap.accomplishments.values()]
          .filter((a) => a.entryId === e.id)
          .map((a) => ({
            ...a,
            usage: usage.accomplishment(a.id),
            variants: [...snap.variants.values()]
              .filter((v) => v.accomplishmentId === a.id)
              .map((v) => ({ ...v, usage: usage.variant(v.id) })),
          })),
      }));
  return {
    profile: snap.profile,
    experiences: entryView('work'),
    projects: entryView('project'),
    skills: [...snap.skills.values()].map((s) => ({ ...s, usage: usage.skill(s.id) })),
    resumes: lib.listResumes(),
  };
}
