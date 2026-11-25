// Rendering adapter (SPEC §3.2 steps 2–5). One interface for the HTML preview
// and the PDF export, so both use the same rendering of the same document:
//
//   resume ──backend.html──▶ HTML ──neutralize links, +print stylesheet──content policy──▶ preview
//                                        └──backend.print──▶ PDF bytes ──pdf.js──▶ page count
//
// The backend (resumed.render + Even, resumed.pdf + Puppeteer) can be replaced
// in tests: T14 injects a failing one, and the oracle self-tests insert markup
// between rendering and printing. The content policy is not part of the
// backend and always runs.

import * as even from 'jsonresume-theme-even';
import { pdf as resumedPdf, render as resumedRender } from 'resumed';
import { ServiceError } from '../core/errors.ts';
import { rendersNoText } from '../core/fields.ts';
import type { JsonResume } from '../core/assemble.ts';
import { countPages } from './pages.ts';
import { enforceContentPolicy, neutralizeLinks } from './policy.ts';
import { printSessions, type PrintSession } from './puppeteer-tracked.ts';
import type { Browser } from 'puppeteer';

export interface PrintedPdf {
  bytes: Uint8Array;
  /** Counted from the generated PDF bytes, never estimated from HTML (FR-06, D11). */
  pageCount: number;
  /** The exact HTML string passed to the printer (SPEC §7.3, printed-bullet check). */
  printedHtml: string;
}

export interface Renderer {
  renderHtml(resume: JsonResume): Promise<string>;
  renderPdf(resume: JsonResume): Promise<PrintedPdf>;
}

export interface RenderBackend {
  html(resume: JsonResume): Promise<string>;
  print(html: string, resume: JsonResume): Promise<Uint8Array>;
}

type ResumedResume = Parameters<typeof resumedRender>[0];
type ResumedTheme = Parameters<typeof resumedRender>[1];
const theme = even as unknown as ResumedTheme;

/** D20: launch, page load, font wait and print each give up after this long. */
export const PRINT_TIMEOUT_MS = 15_000;
const TRACKED_PUPPETEER = new URL('./puppeteer-tracked.ts', import.meta.url).href;

export interface PrinterOptions {
  timeoutMs?: number;
  /** Extra Chrome flags (tests: the offline and black-holed-network proxies). */
  args?: string[];
  /** Test hook: every browser launched for this print. */
  onBrowser?: (browser: Browser) => void;
}

/**
 * `resumed.pdf` with Puppeteer loaded through puppeteer-tracked.ts, so every
 * browser it launches is closed afterwards even when printing throws (D20).
 */
export function resumedPrinter(options: PrinterOptions = {}): RenderBackend['print'] {
  return async (html, resume) => {
    const session: PrintSession = { timeoutMs: options.timeoutMs ?? PRINT_TIMEOUT_MS, browsers: [] };
    try {
      return await printSessions.run(session, () =>
        resumedPdf(html, resume as unknown as ResumedResume, theme, { moduleName: TRACKED_PUPPETEER, args: options.args ?? [] }),
      );
    } finally {
      for (const browser of session.browsers) {
        options.onBrowser?.(browser);
        if (browser.connected) await browser.close().catch(() => browser.process()?.kill('SIGKILL'));
      }
    }
  };
}

/**
 * The pinned pipeline. Paper is Puppeteer's default, Letter; the exported JSON
 * never carries meta.pdfRenderOptions. Chrome comes from PUPPETEER_EXECUTABLE_PATH.
 */
export const resumedBackend: RenderBackend = {
  html: async (resume) => resumedRender(resume as unknown as ResumedResume, theme),
  print: resumedPrinter(),
};

/**
 * D19: Even sets no page margins (Puppeteer defaults to 0), so continuation
 * pages started at the paper edge, and nothing kept a bullet on one page.
 * Margins on every page except the top of page 1, where Even's grey header
 * band stays flush; bullets never split across pages. Print-only rules, so the
 * on-screen preview looks the same as before.
 */
export const PRINT_STYLESHEET = '<style>@page{margin:0.5in 0}@page:first{margin-top:0}li{break-inside:avoid}</style>';

function withPrintStylesheet(html: string): string {
  const head = /<\/head>/i.exec(html);
  return head ? html.slice(0, head.index) + PRINT_STYLESHEET + html.slice(head.index) : PRINT_STYLESHEET + html;
}

const renderFailed = (message: string, cause: unknown) => new ServiceError('RENDER_FAILED', message, undefined, cause);

export function createRenderer(overrides: Partial<RenderBackend> = {}): Renderer {
  const backend: RenderBackend = { ...resumedBackend, ...overrides };

  async function renderHtml(resume: JsonResume): Promise<string> {
    let html: unknown;
    try {
      html = await backend.html(resume);
    } catch (error) {
      throw renderFailed('rendering the resume to HTML failed', error);
    }
    if (typeof html !== 'string' || html.trim() === '') throw renderFailed('the theme produced no HTML', html);
    const page = withPrintStylesheet(neutralizeLinks(html));
    enforceContentPolicy(page); // first: an image-only bullet is a policy violation (409), not an empty one
    // D21 backstop for stored rows that bypassed write validation: a highlight
    // the theme would render as nothing is refused, never silently dropped (FR-06).
    for (const entry of [...resume.work, ...(resume.projects ?? [])]) {
      for (const h of (entry.highlights as string[] | undefined) ?? []) {
        if (rendersNoText(h)) {
          throw new ServiceError('RENDER_FAILED', `a selected bullet would print nothing (Markdown with no visible text): ${JSON.stringify(h)}; edit its wording`);
        }
      }
    }
    return page;
  }

  async function renderPdf(resume: JsonResume): Promise<PrintedPdf> {
    const printedHtml = await renderHtml(resume);
    let bytes: Uint8Array;
    try {
      bytes = await backend.print(printedHtml, resume);
    } catch (error) {
      throw renderFailed('printing the PDF failed', error);
    }
    let pageCount: number;
    try {
      pageCount = await countPages(bytes);
    } catch (error) {
      throw renderFailed('the generated PDF could not be read', error);
    }
    if (!Number.isInteger(pageCount) || pageCount < 1) throw renderFailed('the generated PDF has no pages', pageCount);
    return { bytes, pageCount, printedHtml };
  }

  return { renderHtml, renderPdf };
}
