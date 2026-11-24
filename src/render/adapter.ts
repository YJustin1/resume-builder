// Rendering adapter (SPEC §3.2 steps 2–5). One interface for the HTML preview
// and the PDF export, so both use the same rendering of the same document:
//
//   resume ──backend.html──▶ HTML ──content policy──▶ preview
//                                        └──backend.print──▶ PDF bytes ──pdf.js──▶ page count
//
// The backend (resumed.render + Even, resumed.pdf + Puppeteer) can be replaced
// in tests: T14 injects a failing one, and the oracle self-tests insert markup
// between rendering and printing. The content policy is not part of the
// backend and always runs.

import * as even from 'jsonresume-theme-even';
import { pdf as resumedPdf, render as resumedRender } from 'resumed';
import { ServiceError } from '../core/errors.ts';
import type { JsonResume } from '../core/assemble.ts';
import { countPages } from './pages.ts';
import { enforceContentPolicy } from './policy.ts';

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

/**
 * The pinned pipeline. Paper is Puppeteer's default, Letter; the exported JSON
 * never carries meta.pdfRenderOptions. Chrome comes from PUPPETEER_EXECUTABLE_PATH.
 */
export const resumedBackend: RenderBackend = {
  html: async (resume) => resumedRender(resume as unknown as ResumedResume, theme),
  print: (html, resume) => resumedPdf(html, resume as unknown as ResumedResume, theme),
};

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
    enforceContentPolicy(html);
    return html;
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
