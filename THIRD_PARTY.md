# Third-party software (starting point)

This project builds on the software below. It is **reused, not original work**. Everything we built is the diff from the `start` tag (`git diff --stat start..main`). At `start`, the repository contains **no application code**: only planning documents, synthetic fixtures, and the dependency manifest that pins this software.

## Direct dependencies (pinned in `package.json` / `package-lock.json`)

| Package | Version | Licence | Source | Role in this project |
|---|---|---|---|---|
| `resumed` | 7.1.0 | MIT | https://github.com/rbardini/resumed | Renders a JSON Resume document with a theme (`render`) and prints it to PDF (`pdf`, via Puppeteer). Also the starting-point CLI (`resumed export`) |
| `jsonresume-theme-even` | 0.27.0 | MIT | https://github.com/rbardini/jsonresume-theme-even | HTML theme that defines the resume's layout, section order and styling |
| `@jsonresume/schema` | 1.11.0 | MIT | https://github.com/jsonresume/jsonresume.org/tree/master/packages/schema | JSON Resume schema and validator used to validate every exported document |
| `puppeteer` | 25.18.1 | Apache-2.0 | https://github.com/puppeteer/puppeteer | Headless Chrome driver; peer dependency of `resumed` for PDF printing |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | https://github.com/mozilla/pdf.js | Reads generated PDFs back (page count for the overflow warning; text extraction in tests) |

**Transitive dependencies.** The lockfile resolves 63 packages in total: 52 MIT, 6 Apache-2.0, 4 ISC, 1 BSD-3-Clause, with no copyleft licences (checked from `package-lock.json` at `start`). Notable among them is `micromark` 2.11.4 (MIT), the Markdown parser Even uses; SPEC §3.5 reuses it for the write-time image check. The full list with versions is in `package-lock.json`.

**Runtime software that is not a package:**

- Google Chrome or Chrome for Testing, used by Puppeteer and pointed to with `PUPPETEER_EXECUTABLE_PATH`;
- Node.js 24 LTS.

## Reference material (not included in this repository)

- **jsonresume.org monorepo**, https://github.com/jsonresume/jsonresume.org at commit `7d482856f107515a5e7fcc6b1952c76bdab4aef8` (MIT). It was investigated and run locally as the **behavioural baseline**: its resume "variants" are independent full copies (EVALUATION.md §3, E11, E12). None of its code is copied here. If any of its code is later adapted (e.g. the PDF printing pattern of `packages/resume-pdf`, fallback F1), the copied file goes under `src/render/vendor/` with a header giving source URL, commit and licence, and is listed in this file.
- **Original course proposal and course guide.** They are used for planning only and are deliberately kept out of this repository.

## Later additions

Application dependencies added after `start` (for example React, Vite, an HTTP server, `parse5`, Vitest and TypeScript) are recorded below when they are added, with version, licence and role.

| Package | Version | Licence | Added in | Role |
|---|---|---|---|---|
| `typescript` (dev) | 7.0.2 | Apache-2.0 | Phase 1 | Type checking (`npm run typecheck`); sources run directly on Node 24 type stripping |
| `vitest` (dev) | 5.1.1 | MIT | Phase 1 | Test runner |
| `@types/node` (dev) | 24.19.2 | MIT | Phase 1 | Node 24 type definitions |
