// Browser smoke test (SPEC §7.2, Phase 4 gate): the built UI, served by the
// real API server over HTTP, driven in headless Chrome through the flows the
// SPEC lists: library creation, saving, a deletion conflict, the impact
// prompt, and export with the overflow warning. Data is the demo composition
// (primary + overflow fixtures) in an isolated in-memory database.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixture } from '../../src/db/seed.ts';
import type { Library } from '../../src/db/library.ts';
import { createApp, UI_CSP } from '../../src/server/app.ts';
import { freshLibrary, readFixture } from '../support/harness.ts';

// Generous: PDF rendering under a loaded machine can take tens of seconds.
const STEP = 150_000;
let dir: string;
let lib: Library;
let server: ServerType;
let base: string;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rb-ui-'));
  await build({
    configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    build: { outDir: join(dir, 'ui'), emptyOutDir: true },
    logLevel: 'error',
  });
  lib = freshLibrary('primary.input.json');
  const { profile: _same, ...overflow } = readFixture('overflow.input.json');
  loadFixture(lib, overflow);
  const app = createApp(lib, { uiDir: join(dir, 'ui') });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
  browser = await puppeteer.launch();
  page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(dir, 'downloads') });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const button = (name: string) => page.locator(`::-p-aria([name="${name}"][role="button"])`);
const textbox = (name: string) => page.locator(`::-p-aria([name="${name}"][role="textbox"])`);
const combobox = (name: string) => page.locator(`::-p-aria([name="${name}"][role="combobox"])`);
const waitForText = (text: string) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 90_000 }, text);
/** The UI shortens long labels the same way (LibraryView). */
const short = (t: string) => (t.length > 50 ? `${t.slice(0, 47)}…` : t);
async function waitForFile(path: string) {
  for (let i = 0; i < 100; i++) {
    try {
      if (readdirSync(join(path, '..')).includes(path.split('/').pop()!)) return;
    } catch {
      // directory not created yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no file ${path}`);
}
/**
 * Hold the first request matching each "METHOD /path" until its release
 * function is called (delayed responses for the race tests). Call stop() after.
 */
async function hold(keys: string[]) {
  const release: Record<string, () => void> = {};
  const gates = new Map<string, Promise<void>>(keys.map((k) => [k, new Promise<void>((r) => (release[k] = r))]));
  const onRequest = async (req: import('puppeteer').HTTPRequest) => {
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    const gate = gates.get(key);
    gates.delete(key);
    if (gate) await gate;
    await req.continue().catch(() => undefined); // the page may have aborted it meanwhile
  };
  await page.setRequestInterception(true);
  page.on('request', onRequest);
  return {
    release: (key: string) => release[key]!(),
    stop: async () => {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    },
  };
}
/** :disabled also covers controls disabled by an enclosing <fieldset disabled>; the .disabled property does not. */
const isDisabled = (sel: string) => page.$eval(sel, (b) => b.matches(':disabled'));
const ariaButton = (name: string) => `::-p-aria([name="${name}"][role="button"])`;

async function replaceText(name: string, value: string) {
  await textbox(name).click({ count: 3 });
  await page.keyboard.press('Backspace');
  await textbox(name).fill(value);
}

describe('UI smoke test (built client, real API, headless Chrome)', () => {
  it('serves the built UI with its CSP and loads the library without errors', async () => {
    const res = await page.goto(`${base}/#/library`);
    expect(res?.headers()['content-security-policy']).toBe(UI_CSP);
    await waitForText('Shared library');
    await waitForText('Northwind Lab');
  }, STEP);

  it('recovers when the API is still starting (503 API_STARTING from the dev launcher) (review round 3, 13)', async () => {
    let refused = 0;
    const onRequest = async (req: import('puppeteer').HTTPRequest) => {
      if (refused < 2 && new URL(req.url()).pathname === '/api/library') {
        refused++;
        await req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'API_STARTING', message: 'The local API server is still starting.' } }) });
        return;
      }
      await req.continue();
    };
    await page.setRequestInterception(true);
    page.on('request', onRequest);
    const logged = consoleErrors.length;
    try {
      await page.reload();
      await waitForText('Northwind Lab');
    } finally {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    }
    expect(refused).toBe(2);
    // Chrome logs each deliberate 503; drop exactly those so the final console check stays strict.
    const during = consoleErrors.splice(logged);
    const expected503 = 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)';
    expect(during.filter((e) => e === expected503)).toHaveLength(2);
    consoleErrors.push(...during.filter((e) => e !== expected503));
    expect(await page.evaluate(() => document.body.innerText)).not.toContain('still starting');
  }, STEP);

  it('library creation: add a skill', async () => {
    await button('+ Add skill').click();
    await textbox('Skill *').fill('TypeScript');
    await textbox('Keywords (one per line)').fill('Node.js\nReact');
    await button('Create').click();
    await waitForText('TypeScript · Node.js, React');
    expect(lib.listSkills()).toEqual([expect.objectContaining({ name: 'TypeScript', keywords: ['Node.js', 'React'] })]);
  }, STEP);

  it('impact prompt: editing a shared wording names exactly the affected resume, then saves on confirm', async () => {
    await button('Edit wording “Documented access review findings for the team.”').click();
    await replaceText('Wording (printed as a bullet) *', 'Documented and shared access review findings with the team.');
    await button('Save wording').click();
    await page.waitForSelector('dialog[open]');
    const dialog = await page.$eval('dialog[open]', (d) => (d as HTMLElement).innerText);
    expect(dialog).toContain('Change a shared record?');
    expect(dialog).toContain('Security (r-security)');
    expect(dialog).not.toContain('Engineering');
    await button('Save and update 1 resume').click();
    await waitForText('Documented and shared access review findings with the team.');
    expect(lib.getVariant('v21').text).toBe('Documented and shared access review findings with the team.');
  }, STEP);

  it('impact prompt also for an edit that changes no saved resume (FR-01); cancelling changes nothing', async () => {
    await button('Edit skill TypeScript').click();
    await replaceText('Level', 'Advanced');
    await button('Save').click();
    await page.waitForSelector('dialog[open]');
    expect(await page.$eval('dialog[open]', (d) => (d as HTMLElement).innerText)).toContain('No saved resume’s export changes');
    await button('Cancel').click();
    expect(lib.listSkills()[0]!.level).toBeUndefined();
    await button('Save').click();
    await page.waitForSelector('dialog[open]');
    await page.locator('dialog[open] ::-p-aria([name="Save"][role="button"])').click();
    await waitForText('TypeScript · Advanced');
    expect(lib.listSkills()[0]!.level).toBe('Advanced');
  }, STEP);

  it('deletion conflict: a referenced wording is not deleted and the resumes are named', async () => {
    await button(`Delete wording “${short('Reviewed alert patterns to identify suspicious requests.')}”`).click();
    await waitForText('cannot be deleted');
    const alert = await page.$eval('[role="alert"]', (d) => (d as HTMLElement).innerText);
    expect(alert).toContain('Security (r-security)');
    expect(await page.$('dialog[open]')).toBeNull(); // blocked before any confirmation
    expect(lib.getVariant('v11').text).toBe('Reviewed alert patterns to identify suspicious requests.');
  }, STEP);

  it('saving: reorder a bullet in Security, see it unsaved, save; switching with unsaved changes asks first', async () => {
    await page.goto(`${base}/#/resumes`);
    await button('Security').click();
    await waitForText('This resume only');
    await button('Move bullet 2 of Northwind Lab up').click();
    await waitForText('Unsaved changes');
    expect(await page.$eval('::-p-aria([name="Preview"][role="button"])', (b) => (b as HTMLButtonElement).disabled)).toBe(true);
    await button('Save resume').click();
    await waitForText('Saved “Security”. Other resumes are unchanged.');
    expect(lib.getResume('r-security').experiences[0]!.bullets.map((b) => b.variantId)).toEqual(['v11', 'v21']);
    expect(lib.getResume('r-engineering').experiences[1]!.bullets.map((b) => b.variantId)).toEqual(['v12']);

    await button('Move bullet 2 of Northwind Lab up').click(); // unsaved again
    await button('Engineering').click();
    await page.waitForSelector('dialog[open]');
    expect(await page.$eval('dialog[open]', (d) => (d as HTMLElement).innerText)).toContain('has unsaved changes');
    await button('Discard changes').click();
    await waitForText('Harbor Studio');
    expect(lib.getResume('r-security').experiences[0]!.bullets.map((b) => b.variantId)).toEqual(['v11', 'v21']);
  }, STEP);

  it('pending open and save lock the editor, so a late response cannot overwrite newer edits (review, 3)', async () => {
    const held = await hold(['GET /api/resumes/r-security', 'PUT /api/resumes/r-security']);
    try {
      const moveUp = ariaButton('Move bullet 2 of Northwind Lab up');
      await button('Security').click(); // from Engineering; its GET is held
      await waitForText('Opening…');
      expect(await isDisabled(ariaButton('Engineering'))).toBe(true);
      held.release('GET /api/resumes/r-security');
      await waitForText('Northwind Lab');
      await page.waitForFunction(() => !document.body.innerText.includes('Opening…'));

      await button('Move bullet 2 of Northwind Lab up').click();
      await button('Save resume').click(); // its PUT is held
      await waitForText('Saving…');
      expect(await isDisabled(moveUp)).toBe(true); // no edits while the save is pending
      expect(await isDisabled(ariaButton('Engineering'))).toBe(true);
      held.release('PUT /api/resumes/r-security');
      await waitForText('Saved “Security”.');
      expect(await isDisabled(moveUp)).toBe(false);
      expect(lib.getResume('r-security').experiences[0]!.bullets.map((b) => b.variantId)).toEqual(['v21', 'v11']);
    } finally {
      await held.stop();
    }
  }, STEP);

  it('a new bullet needs an explicit wording choice', async () => {
    await button('Security').click();
    await combobox('Add a bullet to Harbor Studio').fill('a4'); // option values are IDs
    expect(await isDisabled(ariaButton('Add bullet to Harbor Studio'))).toBe(true);
    await combobox('Wording for the new bullet').fill('v41');
    await button('Add bullet to Harbor Studio').click();
    await waitForText('Unsaved changes');
    await button('Discard changes').click();
  }, STEP);

  it('export with the overflow warning: switching is locked while it renders; the warning shows and the PDF downloads (review, 10)', async () => {
    await button('Overflow').click();
    await waitForText('Overflow Lab');
    const held = await hold(['GET /api/resumes/r-overflow/export/pdf']);
    try {
      await button('Download PDF').click();
      await waitForText('Rendering PDF…');
      expect(await isDisabled(ariaButton('Security'))).toBe(true); // the warning cannot end up under another resume
      held.release('GET /api/resumes/r-overflow/export/pdf');
      await page.waitForFunction(() => /Warning: this PDF is \d+ pages long\./.test(document.body.innerText), { timeout: 120_000 });
    } finally {
      await held.stop();
    }
    const pages = Number(/this PDF is (\d+) pages long/.exec(await page.evaluate(() => document.body.innerText))![1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    await waitForFile(join(dir, 'downloads', 'resume-r-overflow.pdf'));
    expect(await isDisabled(ariaButton('Security'))).toBe(false);
  }, STEP);

  it('a pending export invalidated by a library edit is cancelled: no download, no stale result (review, 10)', async () => {
    await button('Security').click();
    await waitForText('Northwind Lab');
    const held = await hold(['GET /api/resumes/r-security/export/pdf']);
    try {
      await button('Download PDF').click();
      await waitForText('Rendering PDF…');
      await page.goto(`${base}/#/library`); // same document: only the hash changes
      await button('Edit skill TypeScript').click();
      await replaceText('Level', 'Expert');
      await button('Save').click();
      await page.waitForSelector('dialog[open]');
      await page.locator('dialog[open] ::-p-aria([name="Save"][role="button"])').click();
      await waitForText('TypeScript · Expert');
      held.release('GET /api/resumes/r-security/export/pdf');
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      await held.stop();
    }
    expect(readdirSync(join(dir, 'downloads'))).not.toContain('resume-r-security.pdf');
    await page.goto(`${base}/#/resumes`);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toContain('PDF exported');
    expect(text).not.toContain('Rendering PDF…');
    expect(await isDisabled(ariaButton('Overflow'))).toBe(false);
  }, STEP);

  it('leaving the Resumes view during an export cancels it: no unseen download, warning or error (review round 3, 10)', async () => {
    await page.goto(`${base}/#/resumes`);
    await button('Engineering').click();
    await waitForText('Harbor Studio');
    const held = await hold(['GET /api/resumes/r-engineering/export/pdf']);
    try {
      await button('Download PDF').click();
      await waitForText('Rendering PDF…');
      await page.goto(`${base}/#/library`); // no edit: just look at the library
      await waitForText('Shared library');
      held.release('GET /api/resumes/r-engineering/export/pdf');
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      await held.stop();
    }
    expect(readdirSync(join(dir, 'downloads'))).not.toContain('resume-r-engineering.pdf');
    await page.goto(`${base}/#/resumes`);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/PDF exported|Rendering PDF…|Warning: this PDF/);
    expect(await isDisabled(ariaButton('Security'))).toBe(false);
    expect(await isDisabled(ariaButton('Download PDF'))).toBe(false); // later exports still work
  }, STEP);

  it('choices deleted in the Library meanwhile cannot be added by a stale ID (verification, 3)', async () => {
    await page.goto(`${base}/#/resumes`);
    await button('Engineering').click();
    await waitForText('Harbor Studio');
    await combobox('Add a bullet to Northwind Lab').fill('a2'); // a2: v21 (used by Security) and v22 (unused)
    await combobox('Wording for the new bullet').fill('v22');
    await combobox('Work entry to add').fill('e3'); // Unused Lab
    expect(await isDisabled(ariaButton('Add bullet to Northwind Lab'))).toBe(false);
    expect(await isDisabled(ariaButton('Add work entry'))).toBe(false);

    await page.goto(`${base}/#/library`);
    await button(`Delete wording “Automated collection of access review evidence.”`).click();
    await page.locator('dialog[open] ::-p-aria([name="Delete"][role="button"])').click();
    await page.waitForFunction(() => !document.body.innerText.includes('Automated collection of access review evidence.'));
    await button('Delete Unused Lab').click();
    await page.locator('dialog[open] ::-p-aria([name="Delete"][role="button"])').click();
    await page.waitForFunction(() => !document.body.innerText.includes('Unused Lab'));

    await page.goto(`${base}/#/resumes`);
    expect(await isDisabled(ariaButton('Add bullet to Northwind Lab'))).toBe(true); // a2 still has v21, but v22 is gone
    expect(await page.$eval('::-p-aria([name="Wording for the new bullet"][role="combobox"])', (s) => (s as HTMLSelectElement).value)).toBe('');
    // Overflow Lab is still addable, but the stale Unused Lab choice is dropped.
    expect(await page.$eval('::-p-aria([name="Work entry to add"][role="combobox"])', (s) => (s as HTMLSelectElement).value)).toBe('');
    expect(await isDisabled(ariaButton('Add work entry'))).toBe(true);
    expect(lib.snapshot().variants.has('v22')).toBe(false);
  }, STEP);

  it('a record’s Edit and Delete stay locked while its save is pending (verification, 4)', async () => {
    await page.goto(`${base}/#/library`);
    const edit = `Edit wording “${short('Documented and shared access review findings with the team.')}”`;
    await button(edit).click();
    await replaceText('Wording (printed as a bullet) *', 'Documented and shared access review findings with the whole team.');
    const held = await hold(['PATCH /api/variants/v21']);
    try {
      await button('Save wording').click();
      await page.waitForSelector('dialog[open]');
      await page.locator('dialog[open] ::-p-aria([name="Save and update 1 resume"][role="button"])').click();
      await page.waitForFunction(() => document.querySelector('fieldset[disabled]') !== null);
      expect(await isDisabled(ariaButton(edit))).toBe(true);
      held.release('PATCH /api/variants/v21');
      await waitForText('Documented and shared access review findings with the whole team.');
    } finally {
      await held.stop();
    }
    expect(lib.getVariant('v21').text).toBe('Documented and shared access review findings with the whole team.');
  }, STEP);

  it('a draft bullet whose wording is deleted shows that, and saving asks for a replacement (verification round 2, 6)', async () => {
    const kept = lib.createVariant('a4', { text: 'Kept the release checklist current.' });
    await page.goto(`${base}/#/resumes`);
    await page.reload(); // pick up the new wording
    await button('Security').click();
    await waitForText('Harbor Studio');
    await combobox('Add a bullet to Harbor Studio').fill('a4');
    await combobox('Wording for the new bullet').fill('v41');
    await button('Add bullet to Harbor Studio').click();
    await waitForText('Unsaved changes');

    await page.goto(`${base}/#/library`);
    await button('Delete wording “Maintained an internal deployment checklist.”').click(); // unused by saved resumes
    await page.locator('dialog[open] ::-p-aria([name="Delete"][role="button"])').click();
    await page.waitForFunction(() => !document.body.innerText.includes('Maintained an internal deployment checklist.'));

    await page.goto(`${base}/#/resumes`);
    const select = '::-p-aria([name="Wording for bullet 2 of Harbor Studio"][role="combobox"])';
    expect(await page.$eval(select, (s) => (s as HTMLSelectElement).selectedOptions[0]!.textContent)).toBe('Deleted wording — choose another');
    await button('Save resume').click();
    await waitForText('Choose a replacement for one bullet whose wording was deleted.');
    expect(lib.getResume('r-security').experiences[1]!.bullets).toHaveLength(1); // nothing saved
    await combobox('Wording for bullet 2 of Harbor Studio').fill(kept.id);
    await button('Save resume').click();
    await waitForText('Saved “Security”.');
    expect(lib.getResume('r-security').experiences[1]!.bullets.map((b) => b.variantId)).toEqual(['v31', kept.id]);
  }, STEP);

  it('a pending profile save locks the profile form (review, 11)', async () => {
    await page.goto(`${base}/#/library`);
    await replaceText('Headline', 'Security Engineer');
    const held = await hold(['PATCH /api/profile']);
    try {
      await button('Save profile').click();
      await page.waitForSelector('dialog[open]');
      expect(await page.$eval('dialog[open]', (d) => (d as HTMLElement).innerText)).toContain('Security (r-security)');
      await page.locator('dialog[open] ::-p-aria([name="Save and update 3 resumes"][role="button"])').click();
      await waitForText('Saving…');
      expect(await page.$eval('::-p-aria([name="Headline"][role="textbox"])', (i) => i.matches(':disabled'))).toBe(true);
      held.release('PATCH /api/profile');
      await waitForText('Profile saved.');
    } finally {
      await held.stop();
    }
    expect(lib.getProfile()?.label).toBe('Security Engineer');
    expect(await page.$eval('::-p-aria([name="Headline"][role="textbox"])', (i) => (i as HTMLInputElement).value)).toBe('Security Engineer');
  }, STEP);

  it('preview: the saved resume renders in a sandboxed iframe', async () => {
    await page.goto(`${base}/#/resumes`);
    await button('Security').click();
    await button('Preview').click();
    const frame = await page.waitForSelector('iframe[title="Resume preview"]');
    expect(await frame!.evaluate((f) => f.getAttribute('sandbox'))).toBe('');
  }, STEP);

  it('no console errors or uncaught exceptions (except the sandbox blocking the theme script, as intended)', () => {
    // §3.5 rule 4: the preview iframe has no allow-scripts, so Chrome blocks
    // Even's <script type="module"> (its <time-duration> labels) and logs it.
    const sandboxBlock = new RegExp(`^Blocked script execution in '${base}/api/resumes/[^/]+/preview\\?v=\\d+' because the document's frame is sandboxed`);
    expect(consoleErrors.filter((e) => !sandboxBlock.test(e))).toEqual([]);
    expect(consoleErrors.some((e) => sandboxBlock.test(e))).toBe(true); // the sandbox really applied
  });
});
