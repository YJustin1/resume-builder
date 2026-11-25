// HTTP API (SPEC §6). A thin layer over the service: parse JSON, call one
// Library method, map ServiceErrors to `{ error: { code, message,
// affectedResumes? } }`. Preview and PDF export go through the rendering
// adapter (src/render), which enforces the runtime content policy.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { invalidInput, notFound, ServiceError } from '../core/errors.ts';
import { id as checkId } from '../core/fields.ts';
import type { EntryKind } from '../core/types.ts';
import type { Library } from '../db/library.ts';
import { createRenderer, type Renderer } from '../render/adapter.ts';

/** SPEC §3.5 rule 4: the preview may load only the theme's fonts and inline styles; no scripts, no remote images. */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:";

/**
 * The built UI's policy: only its own scripts, styles and API; the preview
 * iframe (same origin, itself sandboxed with its own CSP); no plugins, no
 * framing of the app, no inline scripts.
 */
export const UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface AppOptions {
  /** Rendering adapter; tests inject failing or instrumented ones (T14, §7.3 self-tests). */
  renderer?: Renderer;
  /** Directory of the built client (`vite build`), served at / (SPEC §6: "the API server serves the UI files"). */
  uiDir?: string;
}

const ASSET_TYPES: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
  map: 'application/json; charset=utf-8',
};
/** Vite emits flat, hashed file names under assets/; nothing else is served (no traversal possible). */
const ASSET_NAME = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(js|css|svg|woff2|map)$/;

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
  // Only application/json is accepted, so a cross-site "simple" form or
  // text/plain request (no CORS preflight) can never carry a write.
  const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ServiceError('UNSUPPORTED_MEDIA_TYPE', 'request body must be sent as application/json');
  }
  const raw = await c.req.text();
  if (raw.trim() === '') throw invalidInput('request body must be JSON');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw invalidInput('request body is not valid JSON');
  }
}

/** A path ID: malformed is 400 INVALID_INPUT; 404 is reserved for well-formed IDs that address nothing. */
const pid = (c: Context) => checkId(c.req.param('id'), 'path id');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Browser trust boundary (SPEC §6 "Local API protection"): the Host header must
 * name a loopback host (defeats DNS rebinding); unsafe methods are refused
 * when the browser says the request is cross-site, or when an Origin header is
 * present and not a loopback origin.
 */
function guard(c: Context): void {
  // On the real server the request URL is built from Host; in-process test
  // requests (app.request) carry no Host header, only the URL.
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  if (!LOOPBACK_HOSTS.has(hostnameOf(host) ?? '')) {
    throw new ServiceError('FORBIDDEN_ORIGIN', 'requests must address the local server by a loopback host');
  }
  if (!UNSAFE.has(c.req.method)) return;
  if ((c.req.header('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') {
    throw new ServiceError('FORBIDDEN_ORIGIN', 'cross-site requests may not change data');
  }
  const origin = c.req.header('origin');
  if (origin !== undefined && !LOOPBACK_HOSTS.has(hostnameOf(origin) ?? '')) {
    throw new ServiceError('FORBIDDEN_ORIGIN', `origin ${origin} may not change data`);
  }
}

export function createApp(lib: Library, options: AppOptions = {}): Hono {
  const app = new Hono();
  const renderer = options.renderer ?? createRenderer();

  app.use('/api/*', async (c, next) => {
    guard(c);
    await next();
  });

  if (options.uiDir) {
    const uiDir = options.uiDir;
    const uiHeaders = (c: Context) => {
      c.header('Content-Security-Policy', UI_CSP);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Referrer-Policy', 'no-referrer');
    };
    app.get('/', (c) => {
      guard(c);
      uiHeaders(c);
      c.header('Cache-Control', 'no-store');
      return c.html(readFileSync(join(uiDir, 'index.html'), 'utf8'));
    });
    app.get('/assets/:file', (c) => {
      guard(c);
      const file = c.req.param('file');
      const ext = ASSET_NAME.exec(file)?.[1];
      if (!ext) throw notFound(`no asset ${file}`);
      let data: Buffer;
      try {
        data = readFileSync(join(uiDir, 'assets', file));
      } catch {
        throw notFound(`no asset ${file}`);
      }
      uiHeaders(c);
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
      return c.body(new Uint8Array(data), 200, { 'Content-Type': ASSET_TYPES[ext]! });
    });
  }

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      if (error.code === 'RENDER_FAILED' && error.cause !== undefined) {
        console.error(`RENDER_FAILED: ${error.message}:`, error.cause); // server log only
      }
      return c.json(errorBody(error), error.status as 400);
    }
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
    app.get(`/api/${path}/:id`, (c) => c.json(lib.getEntry(kind, pid(c))));
    app.patch(`/api/${path}/:id`, async (c) => c.json(lib.patchEntry(kind, pid(c), await body(c))));
    app.delete(`/api/${path}/:id`, (c) => {
      lib.deleteRecord(type, pid(c));
      return c.body(null, 204);
    });
    app.post(`/api/${path}/:id/accomplishments`, async (c) =>
      c.json(lib.createAccomplishment(kind, pid(c), await body(c)), 201),
    );
  }

  // ---- Accomplishments and wording variants ----
  app.patch('/api/accomplishments/:id', async (c) => c.json(lib.patchAccomplishment(pid(c), await body(c))));
  app.delete('/api/accomplishments/:id', (c) => {
    lib.deleteRecord('accomplishment', pid(c));
    return c.body(null, 204);
  });
  app.post('/api/accomplishments/:id/variants', async (c) =>
    c.json(lib.createVariant(pid(c), await body(c)), 201),
  );
  app.patch('/api/variants/:id', async (c) => c.json(lib.patchVariant(pid(c), await body(c))));
  app.delete('/api/variants/:id', (c) => {
    lib.deleteRecord('variant', pid(c));
    return c.body(null, 204);
  });

  // ---- Skills ----
  app.get('/api/skills', (c) => c.json(lib.listSkills()));
  app.post('/api/skills', async (c) => c.json(lib.createSkill(await body(c)), 201));
  app.patch('/api/skills/:id', async (c) => c.json(lib.patchSkill(pid(c), await body(c))));
  app.delete('/api/skills/:id', (c) => {
    lib.deleteRecord('skill', pid(c));
    return c.body(null, 204);
  });

  // ---- Library view and impact ----
  app.get('/api/library', (c) => c.json(libraryView(lib)));
  app.post('/api/impact', async (c) => c.json(lib.impact(await body(c))));

  // ---- Resumes ----
  app.get('/api/resumes', (c) => c.json(lib.listResumes()));
  app.post('/api/resumes', async (c) => c.json(lib.createResume(await body(c)), 201));
  app.get('/api/resumes/:id', (c) => c.json(lib.getResume(pid(c))));
  app.put('/api/resumes/:id', async (c) => c.json(lib.saveResume(pid(c), await body(c))));
  app.delete('/api/resumes/:id', (c) => {
    lib.deleteResume(pid(c));
    return c.body(null, 204);
  });
  app.get('/api/resumes/:id/export/json', (c) => {
    const id = pid(c);
    const doc = lib.assemble(id);
    c.header('Content-Disposition', `attachment; filename="resume-${id}.json"`);
    return c.json(doc);
  });
  app.get('/api/resumes/:id/preview', async (c) => {
    const html = await renderer.renderHtml(lib.assemble(pid(c)));
    c.header('Content-Security-Policy', PREVIEW_CSP);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    return c.html(html);
  });
  app.get('/api/resumes/:id/export/pdf', async (c) => {
    const id = pid(c);
    const { bytes, pageCount } = await renderer.renderPdf(lib.assemble(id));
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="resume-${id}.pdf"`,
      'X-Page-Count': String(pageCount),
      'X-Overflow-Warning': String(pageCount > 1),
      'Cache-Control': 'no-store',
    });
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
