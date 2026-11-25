// Generate CANDIDATE full-text goldens (SPEC §7.3 "Creation procedure", step 1)
// from the real pipeline, through the HTTP API, into a directory of your
// choice. A candidate has no "# Approved:" line, so the tests refuse it until
// the owner has reviewed every segment and the approval line is added.
//
//   node tests/tools/candidate-goldens.ts <out-dir>

import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshLibrary } from '../support/harness.ts';
import { Api } from '../support/http.ts';
import { PDF_CASES } from '../support/oracle.ts';
import { candidateGolden } from '../support/pdf.ts';

const out = process.argv[2];
if (!out) {
  console.error('usage: node tests/tools/candidate-goldens.ts <out-dir>   (not fixtures/: candidates need owner review first)');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
// Compare real paths (symlinks, other checkout names) with the actual fixture directory.
const fixtures = realpathSync(fileURLToPath(new URL('../../fixtures/', import.meta.url)));
if (realpathSync(out) === fixtures) {
  console.error(`refusing to write into ${fixtures}: candidates need owner review first`);
  process.exit(2);
}
const chrome = process.env.PUPPETEER_EXECUTABLE_PATH;
if (!chrome) throw new Error('PUPPETEER_EXECUTABLE_PATH is not set');
const chromeVersion = execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim();

for (const c of PDF_CASES) {
  const api = new Api(freshLibrary(c.input));
  const { pdf } = await api.printed(c.resume);
  const text = candidateGolden(pdf, [
    `Full-text golden for ${c.id} (${c.resume}; SPEC §7.3 "Approved full-text check"). CANDIDATE: not yet reviewed.`,
    'One segment per visual line of the position-ordered extraction; the golden text is the segments joined by single spaces.',
    `Generated with resumed 7.1.0, jsonresume-theme-even 0.27.0, puppeteer 25.18.1, ${chromeVersion}, pdfjs-dist 6.5.438; ${pdf.pageCount} page(s).`,
  ]);
  writeFileSync(join(out, `${c.name}.pdf.text.txt`), text, { flag: 'wx' }); // never replace an existing file
  console.log(`${c.id}: ${join(out, `${c.name}.pdf.text.txt`)} (${pdf.pageCount} pages)`);
}
