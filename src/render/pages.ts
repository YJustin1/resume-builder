// Page count from the generated PDF bytes (SPEC §3.2 step 4), with the same
// pinned pdf.js the tests use for extraction.

import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Open a PDF with pdf.js. The bytes are copied: pdf.js detaches the buffer it is given. */
export function openPdf(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice(), verbosity: VerbosityLevel.ERRORS });
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  if (bytes.length === 0) throw new Error('empty PDF');
  const task = openPdf(bytes);
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}
