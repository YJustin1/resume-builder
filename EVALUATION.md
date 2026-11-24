# Reusable Resume Builder — Proposal and Architecture Evaluation

**Date:** 2026-11-24 · **Status:** for owner review; nothing here is approved or implemented.

> **Revision (same day, after owner discussion):** The recommendation to drop `resumed` is **reversed**. A follow-up experiment (E13) showed that `resumed export` works with the installed Chrome, prints Letter by default, and passes both PDF oracles. The remaining downside (no control over JavaScript or network during printing) is minor and has a fallback. The owner approved selective reuse with `resumed` + Even (D1, D2). Superseded statements below are marked *[superseded]*. SPEC v2 records the adopted decisions.
**Inputs read:** `references/Final Project Proposal.pdf`, `references/948_final_project_guide-slides (2).pdf`, the instructor feedback quoted in the request, `project/SPEC.md`, `project/fixtures/*`, and `upstream/` at the commit below.
**Experiments:** scripts, inputs, outputs and logs are in `experiments/` (sibling of `project/` and `upstream/`, not part of either). Neither `upstream/`, `references/`, `SPEC.md` nor the fixtures were modified.

Labels used throughout: **[verified]** = executed or read in source here; **[source]** = read in code but not executed; **[assumed]** = inference, not checked.

---

## 1. Executive summary and recommendation

**Recommendation: Alternative B, selective reuse.** Build a small, single-package TypeScript application. Reuse the published JSON Resume schema and validator, one published theme, and the upstream approach to printing PDFs and reading them back. Do **not** fork `jsonresume/jsonresume.org`. Use the upstream application at a pinned commit as the **executed behavioural baseline**, not as the code base.

Main reasons:

1. **Upstream does not support the reference-based workflow, and its model works against it.** Each upstream "variant" is a full, independent JSON copy of the resume (`app.resume_variants.resume json`). Editing one copy does not change the others. Deleting an entry from the main resume leaves stale copies behind silently. Both behaviours were [verified] live against the upstream dev server (E12). Grafting a shared library onto that model means either replacing the variant storage, which breaks upstream's MCP tailoring that writes whole documents, or keeping two sources of truth in sync.
2. **The fork's cost is high and contributes nothing to grading.** It needs Node 24, pnpm 8.15.9, Effect 4, Postgres or PGlite, TanStack Router SSR, vanilla-extract, and an "every feature ships MCP tools" convention. The install is 2.4 GB of `node_modules`. The documented quickstart failed until 214 build tasks had run (E11). None of that is the graded contribution.
3. **The reusable parts are small and decoupled.** The schema and validator (`@jsonresume/schema@1.11.0`), a theme (`jsonresume-theme-even@0.27.0`), and Chromium + pdf.js together already give a working local JSON → HTML → PDF → text pipeline. Both fixture oracles pass on it, and planted faults make it fail (E2–E4).
4. *[superseded by E13: keep `resumed`; see the revision note]* **`resumed` adds nothing to keep.** Its `render` is just `theme.render(resume)`. Its `pdf` launches Puppeteer with no control over JavaScript, network or paper size, and it requires Node ≥ 24 [verified, `resumed@7.1.0` `engines`]. Upstream's own `@repo/resume-pdf` uses Playwright instead; that pattern is the better one to follow.
5. **The baseline comparison is real, not a straw man.** It runs against the existing upstream behaviour (E12). It is framed as a limitation relative to this workflow, not as an upstream bug.

Most significant risks:

- **The PDF ordering oracle depends on how text is extracted.** pdf.js's stream order puts Even's work bullets after Education, Projects and Skills on the page (E6). The SPEC's "increasing offsets" check passes only because it checks headers and bullets separately. It cannot show that a bullet sits under the right employer. Sorting text runs by position fixes this [verified].
- **Schema 1.11 declares inline Markdown in `highlights`, and both tested themes render it.** `**x**` prints as bold `x`, and a link prints as its text only (E5). This contradicts SPEC T16's "render literal text" for Markdown-like input. HTML-like input is escaped correctly.
- **Scope.** The current requirements add Projects, per-resume skills and a required overflow warning on top of a SPEC that was already sized for a week. The UI is the most likely place to run over.
- **The component that holds the logic could read as "CRUD plus a mapping"** unless the integrity, impact and assembly logic is visibly first-class and tested (§2).

---

## 2. Assessment against course requirements

Sources: guide slides 2–4, 6–9, 11–18.

| Course requirement | Addressed by the design? | Evidence still needed after implementation |
|---|---|---|
| Reuse code outside homework; link sources (s.1–2) | Yes: JSON Resume schema and theme, Chromium/Playwright, pdf.js; upstream used as the baseline | README credits with exact versions and licences (all MIT or Apache-2.0, §3.6) |
| Tag the starting commit; diff from the tag (s.2–3) | Planned; the concrete `start` content is in §7.1 | `git tag start`, a `git diff --stat start..main` that actually runs |
| 2–3 components; ≥1 with substantial own logic (s.6, s.9) | Yes: (1) library + integrity, (2) assembly + export, (3) UI. (1) and (2) hold the logic | Tests that fail on planted bugs in (1) and (2) |
| A case the starting point gets wrong or cannot do (s.2–3) | Yes, verified against upstream (E12) | The same scenario passing on our version, with expected values written beforehand (§7.4) |
| Tests with outside answers; plant a bug (s.10, s.17) | Yes: hand-written fixtures; planted faults already caught by the PDF oracle (E4) | Mutation demo on the real code (SPEC §7.4) |
| Two design or evaluation decisions with evidence (s.12–13) | Strong candidates (§12) | Commits, inputs, commands and results recorded at implementation time |
| A debugging story (s.14) | **Cannot be satisfied by design** | Must come from a real bug. Do not stage one |
| A known limitation (s.11, s.17) | Candidates: Markdown interpretation (E5), last-write-wins editing, no history | One concrete input the app gets wrong |
| One command runs the demo from a fresh clone (s.17–18) | Partly. Requires Node 24 and a Chromium | A fresh-clone rehearsal on a second machine or a clean user account |
| Synthetic test data only; no homework (s.4) | Yes | — |

**Is the scope appropriate?** Yes, with cuts. The guide sizes projects for "a couple weeks". One week is tight but feasible if the UI stays minimal (§11).

**Is there enough technical substance?** Borderline unless it is framed deliberately. The slide 7 trap ("storing and showing records is all it does") applies to a naive version of this project. What lifts it above CRUD is logic that makes decisions a library does not, and that a test can show to be wrong:

- dependency and impact analysis: which saved resumes change, or block, for a given edit or delete;
- atomic restricted deletion with structured conflicts;
- ownership validation (variant ∈ accomplishment ∈ entry ∈ resume selection);
- contiguous per-section ordering with atomic replacement;
- deterministic assembly to schema-valid JSON;
- PDF verification (content, order, overflow).

**Recommendation:** make `impactOf(change)` and `assemble(snapshot, resumeId)` pure, named core functions with their own fixtures. Then the "logic component" is visibly separate from the CRUD and the UI.

**Has the instructor's feedback been addressed?** Mostly. The deletion rule is written down (FR-03: restrict, list the affected resumes, leave no partial state), and T04/T05 plus `deletion.expected.json` pin it. PDF checking is programmatic (SPEC §7.3, two PDF oracles). Remaining gaps:

- no oracle file for rejected **experience** deletes (T07 is prose only);
- nothing for **project** or **skill** deletion;
- the PDF order check cannot detect a bullet printed under the wrong employer (E6).

---

## 3. JSON Resume source code investigation

### 3.1 Repository

- URL: https://github.com/jsonresume/jsonresume.org (`origin` of `upstream/`)
- Commit investigated: **`7d482856f107515a5e7fcc6b1952c76bdab4aef8`** (2026-11-24 11:44:33 +0000, "ci(docs): retry the Pages deploy once…"; `git describe` = `@jsonresume/schema@1.11.0-31-g7d482856`), 1,851 commits, 418 MB checkout.
- Licence: MIT (`LICENSE`, "Copyright (c) 2014-2026 JSON Resume contributors"). Every workspace `package.json` that declares a licence says MIT (205 of them) [verified].
- Toolchain: pnpm 8.15.9 (`package.json` `packageManager`), Node 24 (`.nvmrc`, CI `node-version: 24`), Turborepo.

### 3.2 Architecture relevant to us

The monorepo is a hosted multi-user platform. It has 6 apps and about 60 packages, plus 217 entries under `packages/themes/` (theme packages and a couple of notes files). The live site is `apps/app`: React 19, Vite 6, TanStack Router SSR, Hono, Effect 4 `HttpApi`, Effect SQL on Postgres, and PGlite in memory for dev and tests (`AGENTS.md` "Stack" table). Logic lives in `packages/*`, and most of those packages are `private` (not on npm).

| Package | Role | Relevance |
|---|---|---|
| `packages/schema` (`@jsonresume/schema` 1.11.0, published) | `schema.json` (draft-07), `validator.js` (uses the `jsonschema` library, not Ajv) | **Reuse as is** |
| `packages/types` (`@jsonresume/types` 0.9.0, published) | TS types generated from the schema | Optional reuse for the output type |
| `packages/resume-editor` (private) | Schema-driven form + JSON code view + live preview for **one** document | Not reusable (see 3.3) |
| `packages/resume-versions` (private) | Append-only history of the main resume; **variants** (named copies); change proposals | This is the baseline behaviour |
| `packages/resume-themes` (private) | `renderTheme(slug, resume)`; normalisers (`withProjectSummaries`, shapes, regions) | Pattern only; drags in about 200 themes |
| `packages/resume-pdf` (private) | `ResumePdf.print(html, paper)` via Playwright; `testing.ts` `readPdf` via pdf.js | **Pattern to copy or adapt** (MIT) |
| `packages/cli` (`resume-cli` 3.9.4, published) | `resume export x.pdf --theme even` via Puppeteer | Alternative starting point, rejected (§5) |
| `packages/database` (private) | Postgres migrations | Shows the data model (3.3) |
| `packages/mcp`, `packages/pathways` | MCP tools including the variant tools; an OpenAI copilot | Tailoring is done by an LLM (out of scope) |
| `packages/ui` (`@jsonresume/ui`, private in the repo; npm has only 0.0.0) | vanilla-extract design system | Not practically reusable |

### 3.3 Data model and execution paths (traced)

**One main resume per account, stored as one JSON document** [source]:

- `packages/database/src/migrations.ts:16` `1_profiles` has `resume jsonb`; `:74` adds `stored_resume jsonb`.
- The editor saves through `saveResumeAtom` (`packages/resume-editor/src/useEditorSession.ts:43`) → `PUT /api/account/resume` (`packages/api/src/AccountApi.ts:58`) → `Accounts.saveResume` (`packages/accounts/src/accounts.ts:80`).
- That writes the profile copy and appends a version row (`laterMigrations.ts:66` `16_resume_versions`, `resume json NOT NULL`).

**Variants are independent full-document copies** [source + verified E12]:

- Table `laterMigrations.ts:139–156` `20_resume_variants`: `(user_id, slug, name, job_id, resume json, …)`, comment "named copies of a resume".
- Create: `packages/api-server/src/variants.ts:45–49` takes `payload.resume ?? accounts.currentResume(user.id).resume`. `Variants.create` (`packages/resume-versions/src/variants.ts:88–108`) `INSERT`s that JSON.
- Save: `Variants.save` (`variants.ts:111–124`) `UPDATE … SET resume = <whole JSON>`. Remove: `variants.ts:126`.
- No foreign key or reference links a variant to the main resume or to any other variant. Nothing propagates edits, and nothing checks references on delete.
- Web UI: `packages/dashboard/src/VariantsCard.tsx` offers create and delete only (`createVariantAtom`, `deleteVariantAtom`; `packages/api-client/src/client.ts:185–186`). **There is no web UI for editing a variant.** Editing happens through `PUT /api/resume/variants/:slug` or the MCP tool `save_variant` (`packages/mcp/src/catalogVariants.ts:26–30`: "Tailor it for its job: reorder and reword highlights…"), normally driven by an LLM agent (`tailor_resume` prompt, `packages/mcp/src/catalog.ts:167`; Pathways needs `OPENAI_API_KEY`, `packages/pathways/src/copilot.ts:38`).
- Variants have no version history (only the main resume does).

**Intra-document references only.** Schema 1.9+ lets `work[].skills` and similar entries name `skills[].id` (`packages/schema/DECISIONS.md:107–110`, #313). That is a reference inside one document, not shared across resumes.

**Rendering and PDF** [source + verified E2]:

- `renderTheme` normalises the resume, then calls the theme's `render(resume)` (`packages/resume-themes/src/render.ts`; Even is loaded at `loaders.ts:26` from `jsonresume-theme-even@^0.18.1`; `DEFAULT_THEME = 'elegant'`, `render.ts:18`).
- `ResumePdf.print`: one Chromium context with `javaScriptEnabled: false` (`packages/resume-pdf/src/pdf.ts:80`), a network policy that allows only the public web (`:86`, `policy.ts`), an injected `@page` size, and `page.pdf({format, printBackground, preferCSSPageSize:false})` (`:120–123`). It has an optional one-page `fitOnePage` shrink (`fit.ts:23`), which is out of our scope.
- Upstream's PDF tests (`recommended.test.ts`) extract text with pdf.js (`testing.ts:38` `readPdf`). They check that every word is present, that job and school names are in order, a 0.25 in margin, and page counts against stored baselines. This is close to our oracle. It does **not** check per-bullet order or that bullets sit under the right employer.

**Infrastructure and external services.** The dev server needs no secrets [verified E11; `apps/app/scripts/dev.ts` sets dev-only placeholders]. Production assumes Postgres, email, GitHub OAuth, OpenAI (jobs and Pathways) and PostHog. `/@username` renders read public GitHub gists over the network.

### 3.4 What the investigation did not cover

- The legacy `apps/registry` and `apps/homepage2` (reference-only per `AGENTS.md`).
- Job matching, ATS, import, MCP auth, explore and analytics, which do not bear on the decision.
- I did not run upstream's PDF route or its test suites. They need `playwright-core install chromium-headless-shell`, a user-level download that I avoided.

---

## 4. Existing functionality vs. proposed contribution

| Capability | Upstream status | Evidence | Our MVP |
|---|---|---|---|
| JSON Resume schema + validation | **Already implemented** | `packages/schema/validator.js`; E2 | Reuse |
| HTML rendering with themes | **Already implemented** | `resume-themes/render.ts`; E2 (Even), E7 (jake-technical) | Reuse one published theme |
| PDF generation | **Already implemented** | `resume-pdf/src/pdf.ts:66–130` | Reuse the pattern (Playwright, JS off, network policy) |
| PDF text-extraction checks | **Partially implemented** (word presence, job order, page-count baselines; no per-bullet order, no bullet→employer association) | `resume-pdf/src/recommended.test.ts` | Extend: position-ordered, per-bullet, exact-count oracle |
| Multi-page output without truncation | **Already implemented** (Chromium paginates); optional shrink to fit | `fit.ts`; E3 | Reuse; no shrinking |
| Page-count / overflow warning to the user | **Not found** (only the opt-in `?fit=1` shrink and a test baseline) | `grep` for page-count UI found only `fit` | Implement |
| Work, projects, education, skills sections | **Already implemented** as document fields; the editor generates forms from the schema | `resume-editor/src/model.ts:129` `formSections` | Map to these fields |
| Multiple resumes per user | **Implemented as independent copies** (≤ 40 variants) | `variants.ts:5,88–124` | Replace with configurations |
| Resume tailoring | **Implemented, LLM-driven** (an agent rewrites a variant copy) | `catalogVariants.ts`, `prompts.ts:36`, Pathways | Out of scope (manual selection) |
| Shared experiences / accomplishments across resumes | **Not found** | No table or field links variants to shared records | **Implement (core)** |
| Multiple wording variants per accomplishment | **Not found** (the schema has no notion of it) | Schema fields (§3.3) | **Implement (core)** |
| Edits propagate to every referencing resume | **Not found**; verified non-propagation | E12 | **Implement (core)** |
| Reference integrity / restricted delete | **Not found**; deleting the base entry leaves stale copies silently | E12 | **Implement (core)** |
| Per-resume selection and ordering of shared items | **Not found** (each copy is edited freely as JSON) | §3.3 | **Implement (core)** |
| Local single-user operation without services | **Partially implemented**: the dev server runs on in-memory PGlite (no persistence across restarts [source: README "always on an in-memory PGlite database"]) | E11 | Local SQLite file |
| Version history | Main resume only | `16_resume_versions` | Out of scope |

**Overlap:** schema, theme rendering, PDF printing, PDF text reading. **Must be implemented:** everything in the "Implement (core)" rows, the overflow warning, the stronger PDF oracle, and the UI.

---

## 5. Architecture alternatives and trade-offs

| | A: Fork jsonresume.org | B: Selective reuse (**recommended**) | C: Independent app + `resumed` | D1: Fork `packages/cli` only | D2: Fixed template (fallback) |
|---|---|---|---|---|---|
| Reused | Accounts, editor, variants, themes, PDF, PGlite tests | Schema + validator, one theme, the upstream PDF print and read pattern | Schema, theme, `resumed` CLI | `resume-cli` commands, Puppeteer export | Chromium + pdf.js only |
| We build | Library tables (Effect SQL), HttpApi groups, atoms, dashboard UI in vanilla-extract, MCP tools (house rule), sync with the variants model | Library + integrity, assembler, adapters, small UI | Same as B | Library + assembler in a JS/Commander CLI; no UI | Same as B + an HTML template |
| Fit with reference storage | Poor: variants and the editor are document-centric; needs migration or dual sources | Native | Native | Native | Native |
| Existing editor usable? | No: edits one JSON document; our choices are selections, not text | n/a | n/a | n/a | n/a |
| Setup on this Mac | Node 24 + pnpm 8; 2.4 GB `node_modules`; quickstart broke until a 1 m 52 s build (E11) | Node 24; ~10 packages; Chrome or Playwright Chromium | Node ≥ 24 required by `resumed`; Puppeteer downloads Chrome | Puppeteer download; Babel build | Same as B |
| Testability | Good infra (Vitest + PGlite), but Effect 4 learning curve | Plain Vitest; pure core | Same as B | Jest | Same as B |
| Contribution clarity | Small diff in a huge tree; must explain unrelated code | Whole repo is ours except credited deps | Same as B | Mixed JS legacy + ours | Clearest, but less reuse |
| External services | None in dev (some routes reach GitHub) | None (fonts optional, E8) | None | None | None |
| One-week feasibility | **Low**: stack ramp-up dominates | **High** | High | Medium; loses the UI component | High |

**Why not A.** It maximises reused code, but none of that code holds the contribution. The editor, variants, tailoring and accounts would all have to be bypassed or adapted. The convention "a feature isn't done until its tools are in `@repo/mcp`" only applies to upstream contributions, but ignoring it means the fork diverges from its own rules. The decisive fact is E12: the variant model is copy-based by design ("your resume itself never changes"). The reference model therefore has to *replace* it, not extend it.

**Is there a smaller starting point inside the monorepo?** Only two candidates are self-contained:

- `packages/schema`, which is published, so depend on it rather than fork it.
- `packages/cli` (`resume-cli`), which is published. It is JavaScript with Babel, Jest and Puppeteer, and has no storage or UI. Forking it would give a CLI-only product with legacy tooling.

`resume-editor`, `resume-pdf` and `resume-themes` are private, Effect-based, and coupled to `@repo/api-client` and `@jsonresume/ui`. Copying `resume-pdf`'s ~60 lines of print logic and `testing.ts`'s ~30-line `readPdf`, with attribution, is the right granularity.

**B vs C.** *[superseded: E13 showed the Puppeteer download can be skipped by pointing it at an installed Chrome, and paper size defaults to Letter, so B with `resumed` (effectively C) was adopted]* They differ in one dependency. C buys a CLI wrapper at the cost of Node ≥ 24, a Puppeteer download, and no control over JavaScript, network or paper size (`resumed/dist/index.js` `pdf()`: `launch({args})`, `setContent`, `page.pdf`). B calls `theme.render` directly, which is what `resumed.render` does anyway [verified: `S = (e, t) => t.render(e)`].

**D2 (proposal fallback).** A fixed single-column HTML template keeps all core logic and tests. It also removes three theme issues at once: Markdown interpretation, section order, and remote fonts. Keep it ready as a fallback. It is ~1 day of work, and the PDF pipeline is theme-independent [verified: oracles pass with two different themes].

**Not recommended:** RenderCV via upstream's `jsonresume-to-rendercv` converter (adds Python and Typst; **unverified**).

---

## 6. Feasibility experiments

Environment [verified]:

- macOS 15.7 (24G222), arm64; system Node v22.14.0, npm 11.19.1; no pnpm, no Poppler.
- Google Chrome 158.0.8127.37 installed.
- Experiments used a **portable Node v24.22.3** unpacked into the session scratch directory (SHA-256 checked; nothing installed system- or user-wide).
- npm cache and pnpm store were redirected to scratch.

Pinned experiment dependencies (`experiments/package-lock.json`): `@jsonresume/schema@1.11.0`, `jsonresume-theme-even@0.27.0`, `jsonresume-theme-jake-technical@0.2.2`, `resumed@7.1.0`, `playwright-core@1.65.1`, `pdfjs-dist@6.5.438`. All were installed with `npm install --ignore-scripts`. Run from `experiments/` with Node 24.

| ID | Purpose | Command (from `experiments/`) | Input | Actual result | Establishes / does not establish |
|---|---|---|---|---|---|
| E1 | Build synthetic inputs | `node scripts/build-inputs.mjs` | `security.expected.json` (used directly as the document); overflow mapped mechanically from `overflow.input.json`; extended (projects/skills/education); hostile text | 4 JSON files | — |
| E2 | Schema → HTML → PDF → text, standard fixture | `node scripts/render-pdf.mjs security ../project/fixtures/security.pdf.expected.json` | security | schema valid; HTML 8,237 B; **1 page**; oracle **PASS**; 3 requests to Google Fonts during print | Local pipeline works without `resumed.pdf`/Puppeteer, using system Chrome via `channel:'chrome'`. Does not establish Playwright-managed Chromium on another machine |
| E3 | Overflow / pagination | `node scripts/render-pdf.mjs overflow ../project/fixtures/overflow.pdf.expected.json` | 48 bullets | **4 pages** (10/15/15/8 bullets); oracle **PASS**; visually inspected: no clipping or overlap, breaks between bullets, no blank page | No truncation with Even. Does not establish that a single very long bullet splits cleanly (fixture bullets are 3 lines) |
| E4 | Can the oracle fail? | as E2/E3 with `security-planted`, `overflow-planted` | dropped Case 25, swapped 01/02, injected the unselected wording; dropped one Security bullet | Both **FAIL** with specific messages (`bullet count=0: Case 25…`, `out of order: Case 02…`, `present but should be absent…`) | The oracle detects omission, reordering and leakage |
| E5 | Section coverage and text escaping | `node scripts/render-pdf.mjs extended`, `… hostile` | projects ×2, skills ×2, education ×1; `<script>`, `**…**`, backticks, `[text](url)` | Even prints **Work → Education → Projects → Skills**, regardless of JSON key order; all present. `<script>` escaped in HTML (`&lt;script&gt;`) and literal in PDF. **Markdown interpreted**: asterisks and backticks removed, link printed as "text" | Theme fixes section order; Markdown changes printed text |
| E6 | Extraction order | `node scripts/layout-order.mjs security '[…]'`, `… extended '[…]'` | header→bullet sequence | pdf.js **stream order FAIL** (Even work bullets come after Skills); **position-sorted PASS** (security, extended); overflow passes both | The SPEC oracle must use position-ordered extraction to check bullet→employer. Suspected cause (not verified): Even's timeline styling paints highlights in a later layer |
| E7 | Second theme | `THEME=jsonresume-theme-jake-technical node scripts/render-pdf-theme.mjs …` | security, overflow, extended, hostile, projsummary | security 1 page **PASS**; overflow 3 pages **PASS**; stream order PASS; no `<script>`; still Google Fonts; Markdown also interpreted. **Even ignores `projects[].summary`** (renders only the deprecated `description`); jake renders both | Pipeline is theme-agnostic; the project field choice depends on the theme |
| E8 | Offline rendering | `OFFLINE=1 THEME=… node scripts/render-pdf-offline.mjs {security,overflow} …` | all `http(s)` requests aborted | Both themes **PASS** with the same page counts (1/4 and 1/3) | Demo works without network (fallback fonts). Appearance differs; not visually inspected offline |
| E9 | JS on/off determinism | `node scripts/render-pdf-js.mjs security-current` vs `NOJS=1 …` | ongoing role (no `endDate`) | Identical header text ("May 2025 – Present") | No visible `Date.now()` effect observed; keep JS off anyway |
| E10 | DB backstop with no native module | `node scripts/sqlite-fk.mjs` | SPEC §4 composite FKs | `node:sqlite` (SQLite 3.54.1, Node 24, no warning printed): mismatched variant/accomplishment and accomplishment/experience **rejected**; deleting a referenced variant/accomplishment/experience **rejected**, counts unchanged; unreferenced deletes and resume delete cascade correctly. The error is the generic `FOREIGN KEY constraint failed` | DB constraints work as a backstop. Affected-resume lists must come from app queries. (First run had a confounded case that hit the PK; corrected and rerun) |
| E11 | Can upstream run locally? | scratch `git clone --local`; `npx pnpm@8.15.9 install --filter 'app...' --frozen-lockfile` (`PUPPETEER_SKIP_DOWNLOAD=1`, `HUSKY=0`); `pnpm --filter app dev` | — | Install **OK in 37.7 s** (it still ran every theme's `prepare` and the legacy Prisma postinstalls); `node_modules` **2.4 GB** + 2.2 GB store. The documented `dev` → **HTTP 500**, `Failed to resolve entry for package "@jsonresume/ui"` (no `dist/`). After `turbo run build --filter='app^...'` (**214 tasks, 1 m 52 s**): `/`, `/dashboard/editor`, `/signup` → 200 | Upstream runs on macOS with Node 24 + extra build; README quickstart insufficient. PDF route not run |
| E12 | Upstream baseline behaviour | `bash scripts/upstream-baseline.sh` (dev server from E11) | synthetic account; base resume; variants Security and Cloud; correct the wording in Security; correct the base; empty the base `work` | Security changed; **Cloud and base unchanged**; after correcting the base, **Cloud still stale**; after removing the base work entry, **Cloud still holds it**, no warning (`experiments/logs/upstream-baseline-transcript.txt`) | Copy semantics confirmed on real code. Not a bug: the documented design |

**E13 (follow-up):** `resumed` PDF path.

- **Commands:** `PUPPETEER_SKIP_DOWNLOAD=1 npm install --ignore-scripts puppeteer@25.18.1`, then `PUPPETEER_EXECUTABLE_PATH=<Google Chrome> npx resumed export inputs/{security,overflow}.json --theme jsonresume-theme-even -o out/<name>-resumed.pdf`, then `node scripts/check-pdf.mjs <pdf> <oracle>`.
- **Results:**
  - security: 1 page, MediaBox 612×792 (Letter), bullets and absent text **PASS**, 1.59 s;
  - overflow: 4 pages, **PASS**, 0.88 s;
  - `resumed validate`: valid.
- **Establishes:** `resumed` works locally with no browser download.
- **Does not establish:** offline behaviour through this path. JavaScript and network cannot be controlled during printing.

**E14 (follow-up, during spec review):** Markdown links and images through Even.

- **Command:** `node scripts/render-pdf.mjs mdlinks`.
- **Input:** highlights containing `![alt text](http://127.0.0.1:9/probe.png)`, `[click](javascript:alert(1))`, `[d](data:text/html,hi)` and `[site](https://example.com/page)`.
- **Results:**
  - The image became `<img src="http://127.0.0.1:9/probe.png">`, and **Chrome requested that URL during printing**.
  - The `javascript:` and `data:` links were rendered with `href=""`.
  - The `https:` link was kept.
- **Establishes:** user text can trigger network loads (including to localhost) through Markdown images. SPEC §3.5 therefore rejects image syntax on write.
- **Follow-up:** a simple bracket regex misses `![a [b] c](url)`, but `micromark@2.11.4` (Even's parser) renders it as `<img>`. SPEC §3.5 therefore uses the theme's own parser for the write check, and enforces the policy on the parsed HTML at runtime.

Pre-install inspection [verified]: I read the root `prepare` (husky), `packages/cli` `prepare` (Babel), the legacy apps' `postinstall` (Prisma generate), `.npmrc`, and `apps/app/scripts/dev.ts` before running E11.

**Not verified:**

- ~~`resumed export` or `resumed.pdf`~~ (verified later in E13);
- Poppler `pdftotext` (would need `brew install poppler`);
- `npx playwright install chromium` on a machine without Chrome;
- upstream `/@user.pdf`;
- whether a single bullet longer than a page splits cleanly;
- Linux or Windows.

---

## 7. Recommended starting point and baseline

### 7.1 Starting point

There are two parts, and both get linked in the README.

1. **External sources** (credited, not claimed):
   - the JSON Resume schema and validator (`@jsonresume/schema`, MIT, from `jsonresume/jsonresume.org` `packages/schema`);
   - `jsonresume-theme-even` (MIT, rbardini);
   - `playwright-core` (Apache-2.0);
   - `pdfjs-dist` (Apache-2.0);
   - the print and read pattern adapted from upstream `packages/resume-pdf/src/pdf.ts` and `testing.ts` @ `7d48285` (MIT; keep the copyright notice in any copied file).
2. **`start` tag in our repo.** The first commit contains:
   - `package.json` and lockfile with the pinned deps;
   - the fixtures (unchanged, owner-approved);
   - a ~50-line `render` script that turns a **hand-written** JSON Resume file into HTML and PDF and runs the PDF text oracle.

   This is the "JSON Resume document workflow" the ecosystem supports: one file per resume. At `start`, T11/T12 already pass on the hand-written `security.expected.json` and overflow documents, which proves the reused pipeline works. The shared-library checks cannot run because there is no library, assembler or configuration. That is the course's "cannot do" case.

   Per slide 2, anything written before `start`, including this spike, counts as starting point. Do not put core logic before the tag.

### 7.2 What the starting point lacks

Relative to our workflow, not as bugs: no shared records, no wording variants, no per-resume selection, no propagation, no reference integrity, no overflow warning. Upstream jsonresume.org shows the same limitation at platform scale (E12).

### 7.3 Distinguishing reused code from ours

- Dependencies stay in `package.json` only.
- Any file copied from upstream goes under `src/render/vendor/` with a header (source URL, commit, licence) and is listed in `CREDITS.md`.
- Graded components live in `src/core`, `src/db`, `src/server` and `src/client`.
- `git diff --stat start..main` is the contribution.

### 7.4 Reproducible behavioural comparison

Is the user's candidate (Security = A, Cloud = A, Engineering = B) appropriate? **Yes.** It matches real upstream behaviour (E12: correcting Security leaves Cloud stale). Strengthen it as follows. Each scenario needs expected values written down before implementation:

- **B1: shared correction.** New fixture `shared-edit.input.json` with Security(v11), Cloud(v11), Engineering(v12). Do **not** add Cloud to `primary.input.json`; that would change the T04 oracle. One edit of v11. Expected: Security and Cloud show the new text at the same position; Engineering is byte-identical to before.
  - Metrics: *edits needed to correct all affected resumes* (baseline 2, ours 1) and *stale documents after one correction* (baseline 1, ours 0). Generalised: N resumes sharing → N edits and N−1 stale vs 1 and 0.
- **B2: deleting a shared accomplishment.** Baseline: removing the entry from the base or one copy leaves other copies holding it, with no notice (E12). Ours: `409 RECORD_IN_USE` listing the affected resumes, state unchanged (T04).
- **B3: equal-output control.** At the initial state, our assembled JSON for Security deep-equals the hand-written document the baseline renders, and both PDFs pass the same text oracle. This isolates the difference to maintenance semantics, not formatting.
- **B4 (optional): drift detection.** Given three independently edited documents, nothing in the baseline reports that they disagree about the "same" accomplishment. Ours cannot drift by construction. Use this as an argument on a slide, not a test.

How a grader reruns it:

- At `start`: `npm run check:shared` reports "no assembler / not implemented". A missing capability is a legitimate "cannot do".
- At `main`: it passes.
- The upstream half is a documented, optional script (`baseline/upstream-variants.sh` + recorded transcript). It needs Node 24, pnpm 8.15.9 and ~5 GB of disk, so keep it out of `npm run check`.
- Do **not** write a "document store" stand-in that imitates the baseline inside our app. That would be the weakened baseline the request rules out.

Naming hazard: upstream "variant" means **a copy of a whole resume**; ours means **one phrasing of one accomplishment**. In the UI, slides and docs, use "wording" or "phrasing" (or state the difference explicitly), or graders will conflate them.

---

## 8. Recommended MVP architecture and scope

### 8.1 Components

| # | Component | Responsibility | Own logic a test can falsify |
|---|---|---|---|
| 1 | Library & integrity (`src/db`, `src/core/impact.ts`) | Profile, education, entries (work and project), accomplishments, wordings, skills, resumes; transactions; restricted deletion; `impactOf(change)` | Dependency sets, conflict lists, atomicity, ownership, contiguous ordering |
| 2 | Assembly & export (`src/core/assemble.ts`, `src/render`) | Validate a configuration; resolve references in order; map to JSON Resume; schema-validate; render; print; extract page count; overflow flag | Exact selection, order, exclusion, field mapping, determinism, page-count warning |
| 3 | UI (`src/client`) | Library editor; configuration builder (select, order, choose wording); shared-edit impact prompt; conflict display; preview and export | Shared vs local distinction (manual or smoke test) |

### 8.2 Data model (proposed; replaces SPEC §4 tables)

```text
profile(id=1, name, label?, email?, phone?, url?, summary?)            -- global
education(id, institution, area?, study_type?, start_date?, end_date?, sort_index)  -- global, all included (D8)
entries(id, kind CHECK(kind IN ('work','project')), name, role_title?, location?, url?,
        start_date?, end_date?, UNIQUE(id, kind))                      -- kind immutable
accomplishments(id, entry_id FK->entries ON DELETE CASCADE, fact, tags_json, UNIQUE(id, entry_id))
wordings(id, accomplishment_id FK->accomplishments ON DELETE CASCADE, text, UNIQUE(id, accomplishment_id))
skills(id, name, level?, keywords_json)
resumes(id, name)
resume_entries(resume_id FK CASCADE, entry_id, kind, sort_index,
               PK(resume_id, entry_id), UNIQUE(resume_id, kind, sort_index),
               FK(entry_id, kind)->entries(id, kind) ON DELETE RESTRICT)
resume_bullets(resume_id, entry_id, accomplishment_id, wording_id, sort_index,
               PK(resume_id, accomplishment_id), UNIQUE(resume_id, entry_id, sort_index),
               FK(resume_id, entry_id)->resume_entries CASCADE,
               FK(accomplishment_id, entry_id)->accomplishments(id, entry_id) RESTRICT,
               FK(wording_id, accomplishment_id)->wordings(id, accomplishment_id) RESTRICT)
resume_skills(resume_id FK CASCADE, skill_id FK->skills RESTRICT, sort_index,
              PK(resume_id, skill_id), UNIQUE(resume_id, sort_index))
```

Why one `entries` table with `kind`: work and projects share the accomplishment/wording logic, which is a stated requirement. A single parent table keeps one code path, and the composite FK with `kind` stops a project from being ordered inside the work section. The alternative, two parent tables with polymorphic accomplishments, needs nullable dual FKs and duplicated checks.

Mapping:

- `work[]`: `{name, position←role_title, location?, url?, startDate?, endDate?, highlights}`.
- `projects[]`: `{name, url?, startDate?, endDate?, highlights}`. Project prose is a decision (D6): Even renders only `description`, which the schema deprecates.
- `skills[]`: `{name, level?, keywords?}` in per-resume order.
- `education[]` and `basics` are global.
- Omit empty optional sections. Always emit `work` (SPEC FR-04).

### 8.3 Technology stack

| Concern | Recommendation | Change from SPEC | Basis |
|---|---|---|---|
| Runtime | **Node 24 LTS**, pinned via `.nvmrc` + `engines` | SPEC said "LTS supported by deps" | `node:sqlite` stable without a warning (E10); `pdfjs-dist@6` needs ≥ 22.13 |
| DB driver | `node:sqlite` (built in) | SPEC: "compatible driver" | E10; no native build. Fallback: `better-sqlite3@13` |
| Server | Small HTTP server (Express or Hono); bind 127.0.0.1 | none | — |
| UI | React + Vite, plain CSS | none; **do not** reuse `@jsonresume/ui` | private / npm 0.0.0 |
| Schema | `@jsonresume/schema@1.11.0` `validate()` | SPEC said Ajv | Package's own validator; E2 |
| Theme | `jsonresume-theme-even@0.27.0` (alt: `jake-technical@0.2.2`; fallback D2) | SPEC: via `resumed` | E2–E7 |
| PDF | `playwright-core`, `chromium.launch({channel:'chrome'})`, falling back to Playwright's Chromium; JS off; network blocked or limited to fonts | Drop `resumed` *[superseded: adopted `resumed.pdf` via Puppeteer + installed Chrome; this row is now fallback F1 in SPEC v2]* | E2, E8; upstream `resume-pdf` |
| Extraction | `pdfjs-dist` pinned, **position-sorted** runs; also used at runtime for the page count | SPEC listed Poppler first | E6; no system install |
| Tests | Vitest | none | — |

### 8.4 MVP scope

**In:**

- library CRUD for profile, education, work and project entries, accomplishments with wordings and tags, skills;
- resume configurations covering entries, bullets and skills;
- restricted deletion with affected lists;
- shared-edit impact prompt;
- JSON export, HTML preview, PDF export with page count and a >1-page warning;
- fixtures and tests;
- baseline evidence.

**Out:** the request's out-of-scope list, plus:

- per-resume education selection (D8);
- per-resume skill keyword subsets;
- tag filtering;
- duplicating a resume;
- an optimistic concurrency check (document last-write-wins across tabs as a limitation).

---

## 9. Required specification and fixture revisions

Revisions are proposed only. None have been made.

### 9.1 Outdated or contradicted requirements in `SPEC.md`

| SPEC location | Current text | Conflict (authority) | Proposed revision |
|---|---|---|---|
| §1.1 "Not required … dedicated Projects"; "Education and skills are shared across all resumes"; FR-04 maps only `work` | Projects and per-resume skills excluded | Prompt §4 (authority 3) requires both | Add the entries `kind`, `resume_skills` and the mapping from §8.2 |
| §3 / §13 "Use `resumed` and `jsonresume-theme-even`" | Renderer via `resumed` | Findings: `resumed` needs Node ≥ 24 and Puppeteer, and adds no function | Theme `render()` + playwright-core (already allowed: "local headless Chromium (e.g. Playwright)") |
| §3 "compatible draft-07 validator (e.g. Ajv)" | Ajv | The package ships its own `jsonschema` validator | Use `@jsonresume/schema` `validate`; note `additionalProperties: true` (schema validity is a weak oracle; invalid-case tests must use type violations) |
| FR-05 "Offer a page-count/overflow notice if easily available; not a required UI feature" | Optional | Prompt §4 requires a warning | Required: export response carries `pageCount` from the real PDF; UI shows a warning when `pageCount > 1`; export still succeeds |
| §4 / FR-01 "do not treat bullet text as HTML or Markdown"; T16 "preview/PDF render literal text" | Plain text | Schema 1.11 declares inline Markdown in `highlights` (`schema.json` work.highlights); both themes interpret it (E5) | Decide (D9). Recommended: keep text unchanged in JSON; document Markdown interpretation as a **known limitation**; T16 asserts HTML escaping only, plus a T16b documenting the Markdown behaviour |
| §7.3 "normalized concatenation … increasing start offsets" | Stream order | E6: stream order does not reflect visual order with Even | Specify position-sorted extraction (page, then y descending, then x); add an interleaved header→bullet sequence check; for multi-column regions (Even skills grid) check names only |
| §4 dates "real `YYYY-MM-DD`" | Full dates only | Schema accepts `YYYY`, `YYYY-MM`, `YYYY-MM-DD` | Accept the schema `iso8601` pattern; validate month and day ranges (D16) |
| §7.4 "tag the actual starting commit `start` (…unmodified starter/template…)" | Vague | §7.1 here | Make it concrete |
| §13 file names `…Proposal(1).pdf`, `…slides (2)(1).pdf` | Wrong names | Actual names in `references/` | Fix the names |
| FR-03 | Variant, accomplishment and experience rules only | Prompt requires skills (and projects) | Extend: entry of either kind (blocked if in any `resume_entries`), skill (blocked if in any `resume_skills`); education/profile not referenceable |
| Terminology "variant" | — | Collides with upstream's "variant" (resume copy) | Rename to "wording" in SPEC, API and UI, or define it explicitly |

### 9.2 Missing behavioural rules

1. Entry `kind` is immutable. A work entry cannot be selected into the projects section (composite FK).
2. Skill selection: whole skill records, unique per resume, contiguous order. Editing a skill name or keywords propagates. Deleting is restricted.
3. Overflow warning semantics: computed from the generated PDF, never from HTML height. Shown after PDF export; preview may offer "check pages", which renders the PDF.
4. Section order is the theme's (Even: Work → Education → Projects → Skills, E5). JSON key order is immaterial. Within-section order is ours.
5. Network policy during printing: block all network for determinism and privacy, which gives fallback fonts (E8), or allow font hosts only (D10).
6. `impactOf`:
   - for a shared edit, the affected resumes are those referencing the record directly or through an ancestor;
   - for a delete, the same set, plus the decision (allowed or blocked);
   - output deduplicated and sorted by ID (consistent with FR-03).
7. Concurrent edits from two tabs: last write wins (documented limitation), unless an optimistic `version` check is approved.
8. `basics.label` and `summary` are global. Per-resume headlines are out of scope unless D17 changes that.

### 9.3 Fixture coverage (existing → needed)

| Behaviour | Existing coverage | Gap / proposed addition (new files; existing oracles unchanged) |
|---|---|---|
| Shared edit affects only referencing resumes | T09 prose | `shared-edit.input.json` (Security v11, Cloud v11, Engineering v12) + `shared-edit.after.*.expected.json` (B1) |
| Independent configuration changes | T02/T03 prose | `t02.security.expected.json`, `t03.security.expected.json` (oracles independent of the implementation) |
| Referenced accomplishment deletion | `deletion.expected.json` ✓ | — |
| Referenced wording deletion | `deletion.expected.json` ✓; T05 prose | `t05.expected.json` (sequence: switch, delete v11 OK, delete v12 blocked listing both) |
| Referenced experience deletion | T07 prose | Add an e1 attempt (affected: engineering, security) to a new `deletion-entries.expected.json` |
| Referenced project / skill deletion | **none** | Project p1 and skill s1 referenced by one resume → 409 listing it |
| Unreferenced deletion succeeds | T06 prose | Expected post-state row counts per table |
| Invalid references / duplicates | T08 prose | `invalid-configs.json`: each payload + expected status and code (wrong ownership, unknown ID, duplicate accomplishment/entry/skill, project in the work section) |
| Deterministic assembly and ordering | T01 ✓ | Assemble twice → deep-equal; shuffle DB insertion order → same output |
| Work and Projects mapping | **none** | `sections.input.json` + `sections.expected.json`: 2 work, 2 projects (one reusing the same accomplishment logic), ordered differently per resume |
| Resume-specific skills | **none** | Two resumes selecting different skill subsets and orders; a skill rename propagates to both |
| Persistence across restarts | T10 prose | Make it a server restart on a file DB, not just a DB reopen |
| PDF completeness and order | `security.pdf.expected.json` ✓ (no header→bullet association) | Add `orderedSequence` interleaving headers and bullets; add canonical facts and tags to `absentText` (they must never print) |
| Multi-page overflow | `overflow.pdf.expected.json` ✓ | Add `"overflowWarning": true`; add `"overflowWarning": false` for security; add `sections.pdf.expected.json` |
| HTML / Markdown text | T16 prose | Split into T16 (HTML escaping; literal in the PDF) and T16b (Markdown: documented expected printed text) |

The existing fixtures held up: both PDF oracles passed on real output and failed on planted faults (E2–E4). No change to their expected values is proposed.

---

## 10. Risks, limitations and unresolved questions

### 10.1 Technical risks

| Risk | Likelihood / impact | Mitigation / fallback |
|---|---|---|
| Theme behaviour (Markdown, section order, `projects.summary` ignored, remote fonts) leaks into oracles | Already observed / medium | Choose D6/D9/D10 explicitly; fallback D2 fixed template |
| Chromium availability on the grader's Mac | Medium / high for the demo | `channel:'chrome'`, else `npx playwright install chromium` (user-level cache, ~hundreds of MB; ask first); document both |
| Node 24 not installed locally (system has 22.14) | Certain / low | User-level install via nvm/fnm/Volta (**needs approval**); `.nvmrc` |
| Extraction differences across pdf.js versions | Low / medium | Pin `pdfjs-dist`; position-sorted reading |
| UI consumes the week | High / high | Build the core and tests first (§11); keep the UI to plain forms + up/down buttons; fall back to a CLI over the same core for the demo |
| Integrity logic diverges between the app layer and DB constraints | Medium / medium | Test both: API-level tests + direct SQL attempts (SPEC T08) |

### 10.2 Scope risks

- Projects + skills + overflow warning add ~1 day to the SPEC's plan.
- The shared-edit confirmation UI and dirty-state handling (FR-01/FR-02) are the most expensive UI items. If time runs short, show the impact list read-only, without a modal confirmation.

### 10.3 Unresolved contradictions (reported, not resolved)

1. Required Projects and per-resume skills (prompt) vs SPEC §1.1 exclusion.
2. Required overflow warning (prompt) vs SPEC FR-05 "not required".
3. Plain-text semantics (SPEC, T16) vs schema-declared Markdown and theme behaviour.
4. ~~Proposal/SPEC dependency on `resumed` vs findings (§5).~~ Resolved: `resumed` kept (E13, owner approval).
5. The prompt says "Maintain shared education" without saying whether education is selectable per resume. The SPEC says it is shared and always included.

### 10.4 Decisions requiring your approval before implementation

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Architecture | B (selective reuse); upstream only as the executed baseline |
| D2 | Renderer | *[superseded]* `resumed` render + pdf with Even (owner approved) |
| D3 | Theme | Even 0.27.0 (verified); jake-technical as an alternative; D2 template as fallback |
| D4 | Node 24 install method on your Mac (user-level) | nvm/fnm/Volta; your choice |
| D5 | SQLite driver | `node:sqlite` |
| D6 | Project prose field | None in MVP (highlights only); otherwise emit `description` (deprecated but rendered by Even) |
| D7 | Skills granularity | Whole records per resume; no keyword subsets |
| D8 | Education | Global, always included |
| D9 | Markdown in text | Accept as schema semantics; document as a known limitation; adjust T16 |
| D10 | Network during printing | Block all (deterministic, offline-safe) |
| D11 | Overflow warning surface | On PDF export (and an optional preview button) |
| D12 | Section order | Accept the theme's fixed order |
| D13 | `start` tag content | §7.1 |
| D14 | Fixture policy | Add new fixture files; keep existing oracles unchanged |
| D15 | Terminology | Rename "variant" → "wording" |
| D16 | Date precision | Schema `iso8601` (YYYY, YYYY-MM, YYYY-MM-DD) |
| D17 | Per-resume `basics.label`/`summary` | Out of scope (global) |

---

## 11. Recommended implementation roadmap

Each gate is a command that must pass before the next milestone starts. Day estimates assume a single developer with agent help.

| # | Milestone | Content | Verification gate |
|---|---|---|---|
| M0 (0.5 d) | Repo + start | Node 24 pin, deps, approved fixtures + new fixture files, `render` script on hand-written JSON; tag `start` | `npm run check:render` passes T11/T12 on hand-written docs from a fresh clone |
| M1 (1.5 d) | Library & integrity | Schema/migrations, repositories, transactions, restricted delete, `impactOf`, seed loader | T04–T08, T15, new entry/skill/project deletion cases; direct-SQL backstop test; planted fault (e.g. skip the dependency query) makes T04 fail |
| M2 (1 d) | Assembly | Pure `assemble`, mapping work/projects/skills, schema validation, JSON export API | T01–T03, T09, T10, T13, T17, sections and skills fixtures, determinism |
| M3 (1 d) | Render & export | Adapter, print, position-sorted extraction, page count and overflow flag, render-failure path | T11, T12, T14, T16/T16b, overflow warning true/false; visual inspection of 3 PDFs recorded |
| M4 (1.5 d) | UI | Library editor, configuration builder, impact and conflict display, preview/export | Scripted manual walkthrough from a clean seed; optional Playwright smoke test |
| M5 (1 d) | Evidence & delivery | Baseline B1–B3 (+ optional upstream transcript), README, CREDITS, mutation demo, slides, fresh-clone rehearsal | `npm ci && npm run check` on a clean checkout; `git diff --stat start..main` |

**Defer first if time runs short, in order:** shared-edit confirmation modal (keep the impact list) → tag display → education editing UI (seed JSON) → preview button (keep export) → project dates/URL → upstream baseline rerun script (keep the transcript).

**Never cut:** restricted deletion, two or more saved resumes with independent order and wording, the B1 comparison, the real-PDF oracles, the overflow warning.

---

## 12. Potential course evidence

**Design and evaluation decisions** (slides 3–4). Each must still be backed by commits and checks made during implementation.

1. **Restrict vs cascade vs placeholder on deleting shared content.** The instructor raised this explicitly. Evidence: T04/T05 fixture results; a rejected-delete row comparison before and after; the upstream contrast (E12: copies silently keep deleted content).
2. **How to check PDF order.** Alternatives: visual-only, stream-order extraction, position-ordered extraction. Evidence already exists: E6 shows stream order fails on correct output, and E4 shows the oracle catches planted faults. Re-run on the real pipeline and record the commit.
3. **Fork vs selective reuse.** Evidence from this report: E11 install and build costs and the quickstart failure; E12 copy semantics.
4. **`resumed` vs direct theme render + Playwright.** A smaller, factual decision.

**Baseline comparisons:**

- B1 shared correction (edits needed 2 → 1; stale documents 1 → 0);
- B2 delete-while-shared (silent stale copy → 409 with affected list);
- B3 equal-output control.

**Record during implementation:**

- exact dependency versions and the `start` SHA;
- for each gate, the command plus pass/fail output;
- the planted-fault run (fails), the restore, and the rerun (passes), on a throwaway branch;
- prompts given to agents and what was accepted, changed or rejected;
- one genuine debugging story (symptom, ruled-out causes, fix commit, check);
- one concrete limitation input (e.g. a wording containing `**` printing without asterisks, if D9 is accepted);
- screenshots or PDFs of the overflow warning.
