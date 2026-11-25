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

const STEP = 60_000;
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
const waitForText = (text: string) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30_000 }, text);
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
    // Hold the first GET (open) and PUT (save) of Security until released.
    const release: Record<string, () => void> = {};
    const gates = new Map<string, Promise<void>>([
      ['GET /api/resumes/r-security', new Promise((r) => (release.open = r))],
      ['PUT /api/resumes/r-security', new Promise((r) => (release.save = r))],
    ]);
    const onRequest = async (req: import('puppeteer').HTTPRequest) => {
      const key = `${req.method()} ${new URL(req.url()).pathname}`;
      const gate = gates.get(key);
      gates.delete(key);
      if (gate) await gate;
      await req.continue();
    };
    await page.setRequestInterception(true);
    page.on('request', onRequest);
    try {
      const moveUp = '::-p-aria([name="Move bullet 2 of Northwind Lab up"][role="button"])';
      // :disabled also covers buttons disabled by an enclosing <fieldset disabled>; the .disabled property does not.
      const disabled = (sel: string) => page.$eval(sel, (b) => b.matches(':disabled'));
      await button('Security').click(); // from Engineering; its GET is held
      await waitForText('Opening…');
      expect(await disabled('::-p-aria([name="Engineering"][role="button"])')).toBe(true);
      release.open!();
      await waitForText('Northwind Lab');
      await page.waitForFunction(() => !document.body.innerText.includes('Opening…'));

      await button('Move bullet 2 of Northwind Lab up').click();
      await button('Save resume').click(); // its PUT is held
      await waitForText('Saving…');
      expect(await disabled(moveUp)).toBe(true); // no edits while the save is pending
      expect(await disabled('::-p-aria([name="Engineering"][role="button"])')).toBe(true);
      release.save!();
      await waitForText('Saved “Security”.');
      expect(await disabled(moveUp)).toBe(false);
      expect(lib.getResume('r-security').experiences[0]!.bullets.map((b) => b.variantId)).toEqual(['v21', 'v11']);
    } finally {
      page.off('request', onRequest);
      await page.setRequestInterception(false);
    }
  }, STEP);

  it('a new bullet needs an explicit wording choice', async () => {
    await button('Security').click();
    await combobox('Add a bullet to Harbor Studio').fill('a4'); // option values are IDs
    const add = '::-p-aria([name="Add bullet"][role="button"])';
    expect(await page.$$eval(add, (bs) => bs.map((b) => (b as HTMLButtonElement).disabled))).toContain(true);
    await combobox('Wording for the new bullet').fill('v41');
    await button('Add bullet').click();
    await waitForText('Unsaved changes');
    await button('Discard changes').click();
  }, STEP);

  it('export with the overflow warning: Overflow prints to several pages and says so; the PDF downloads', async () => {
    await button('Overflow').click();
    await waitForText('Overflow Lab');
    await button('Download PDF').click();
    await page.waitForFunction(() => /Warning: this PDF is \d+ pages long\./.test(document.body.innerText), { timeout: 45_000 });
    const pages = Number(/this PDF is (\d+) pages long/.exec(await page.evaluate(() => document.body.innerText))![1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    await waitForFile(join(dir, 'downloads', 'resume-r-overflow.pdf'));
  }, STEP);

  it('preview: the saved resume renders in a sandboxed iframe', async () => {
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
