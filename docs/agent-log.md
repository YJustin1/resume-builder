# Agent log

Each phase records the human instruction, the agent's work (Claude Code, model Claude Opus 5.5), the review, and the actual commands and results.

## Planning (before `start`)

- **Instruction:** evaluate the proposal against the course requirements, investigate jsonresume.org, recommend an architecture, and revise the spec and fixtures.
- **Work:**
  - wrote `EVALUATION.md`, including experiments E1–E14 (spike code kept outside this repository);
  - revised `SPEC.md` to v2 and added fixture files;
  - two Codex review sessions (`codex-review`, phase `spec`): 6 rounds in all, the final round with no blockers. Every finding was addressed or deliberately resolved; one premise question (profile summary) went to the owner, who excluded it.
- **Owner decisions:**
  - selective reuse with `resumed` + Even (reversing the agent's first recommendation to drop `resumed`, after experiment E13);
  - no `basics.summary`;
  - approval of D3–D16 and the v2 fixtures.

## Phase 0 — setup (2026-11-24)

See docs/decisions.md (Phase 0) and docs/debugging.md #1.

- **Online and offline exports:** both work through `resumed`.
- **Bug found by the offline check:** joining PDF text runs with spaces broke on ligature runs. Fixed in the SPEC §7.3 extraction rule.

## Phase 1 — library and integrity, service level (2026-11-24)

**Instruction:** "start" (after owner approval of the spec and fixtures).

**Work:**

- `src/core/`:
  - `types.ts` and `errors.ts`;
  - `fields.ts`: trimming and single-line text; dates via the pinned schema pattern plus a calendar check and common-precision ordering; email and URL via the pinned `@jsonresume/schema` validator plus an `http`/`https` rule; Markdown images detected with the theme's own `micromark`;
  - `configuration.ts`: configuration validation with the INVALID_INPUT vs INVALID_REFERENCE rule;
  - `impact.ts`: delete impact only; edit impact waits for the Phase 2 assembler.
- `src/db/`:
  - `schema.ts`: the SPEC §4 DDL, with composite FKs and RESTRICT on resume references;
  - `database.ts`: foreign keys on every connection, `user_version` migration, and IMMEDIATE transactions with savepoints when nested;
  - `snapshot.ts`, `rules.ts` (create/patch semantics) and `library.ts` (service layer);
  - `seed.ts`: the v2 fixture loader, as one transaction.
- `tests/phase1/`:
  - fixture-driven checks of status, code and affected resumes, plus a full row dump compared before and after every rejected step;
  - the direct-SQL constraint backstop;
  - contiguous ordering;
  - field rules, first-run profile writes, immutability, an all-or-nothing seed, and impact purity and order.
  - Assertions needing assembly or rendering appear as `it.todo`, 16 of them.

**Check:** `npm run check` gives typecheck clean and 66 passed, 16 todo.

**Planted faults** (scratch copy outside the repository, one at a time, each against the full suite):

| Fault | Result |
|---|---|
| delete never blocked | 11 tests fail |
| accomplishment references ignored | 2 fail |
| variant ownership unchecked | 2 fail |
| entry kind unchecked | 1 fails |
| calendar check removed | 2 fail |
| image check removed | 2 fail |
| COMMIT instead of ROLLBACK on error | 1 fails |
| non-contiguous positions | 1 fails |
| affected list unsorted | **0 fail at first.** Snapshots list resumes in ID order, which hid the missing sort |

The last row was a test gap. The response was `tests/phase1/impact.test.ts`, which feeds a snapshot with reversed resume order; the mutant then fails 1 test.

**Not yet covered (by design, later phases):** edit impact, exports, HTTP statuses through the API, rendering, T27 as a whole, T10 (server restart).

## Phase 1 review — Codex code review (2026-11-24)

**Instruction:** "Do a codex review of the results of phase 1 and phase 2."

**Review:** `codex-review` (phase `code`, base `a3e4b5b`), 3 rounds; the final round had no blockers. All 12 findings were addressed with regression tests (commits `20e227a`, `cc5b99f`, `f341455`). Highlights:

- **Data loss:** an omitted `experiences` silently cleared work selections; it is now required.
- **Wrong error:** an ID that exists in the wrong role gave the wrong error code.
- **Inconsistent snapshots:** snapshot reads were not one transaction. A real two-connection test now fails without the fix.
- **Owner decision:** education items have no URL.
- **Regression from my own fix:** after splitting the text validators, URLs skipped the Markdown-image check (round 2).
- **Unsafe positions:** a text `sort_index` was coerced, and an oversized integer could make reads throw, which would block repair.

## Phase 2 — assembly and HTTP API (2026-11-24)

**Work:**

- `src/core/`:
  - `apply.ts`: create/patch rules shared by writes and impact analysis;
  - `assemble.ts` (FR-05): refuses on a missing profile, ordering gaps, broken references or schema failure;
  - `impact.ts`: edit impact = resumes whose assembled JSON differs, with failure states compared as states.
- `src/server/`:
  - `app.ts`: Hono routes for §6, except preview and PDF;
  - `paths.ts`: §9 personal and demo database locations;
  - `main.ts`: server on loopback;
  - `demo-seed.ts`.
- `tests/phase2/`: every fixture through HTTP with exact exports and `expectedImpact`; T01 including determinism and reversed insertion order; T10 with two real server processes on one file DB; T18; T27; the §9 isolation tests 1–7; error handling with no stack traces.

**Fixture fix:** T09c's impact step lacked `"status": 200` (authoring omission, logged in fixtures/README.md).

**Check:** `npm run check` gives typecheck clean and 141 passed, 19 todo. The todos are all rendering (Phase 3).

**Planted faults:**

| Fault | Failing tests |
|---|---|
| first wording instead of the selected one | 23 |
| bullets reversed | 22 |
| last bullet dropped | 30 |
| empty `summary` emitted | 28 |
| empty skills section emitted | 26 |
| ordering gaps ignored | 1 |
| edit impact = every resume with work | 5 |
| failure states never equal | 1 |
| first `PUT /api/profile` returns 200 | 1 |
| DB_PATH symlink not followed | 1 |
| demo-file symlink check removed | 0 |

The last row is an equivalent mutant, not a gap: `lstat` never reports `isFile()` for a symlink, so the remaining check still refuses it.

## Phase 2 review — Codex code review (2026-11-24)

**Review:** `codex-review` (phase `code`, base `f341455`), 3 rounds (cap reached). The round-3 fixes await reviewer verification (see the owner report).

| Round | Findings | Highlights |
|---|---|---|
| 1 | 7 blockers, 2 improvements | Any web page could write to the local API (no Origin/Host/content-type checks); a case-alias or hard link to the demo DB; the assembler accepted duplicates and blank names; demo reset was non-atomic; the §9 tests bypassed the real commands; HTTP T06 and T20 record checks were missing; root paths with spaces failed |
| 2 | 3 blockers, 3 improvements | Reset raced a live demo server; two first seeds could both publish; orphaned selection rows were silently dropped; required export fields were unchecked; dangling demo symlinks blocked personal mode; the dev-proxy rule was unspecified |
| 3 | 2 blockers, 1 improvement | Deleting sidecars could destroy recovery data; the PID-file lock could be reclaimed under a live holder; large rowids threw |

**Response:**

- every fix has a regression test, and every test was checked by reverting the fix in a scratch copy;
- three reverts were equivalent behaviour (documented; the redundant lowercase check was removed);
- the lock was redesigned around OS file locks;
- a flaky concurrency test exposed a real SQLite lock-upgrade collision (docs/debugging.md #2).

**Check:** `npm run check` gives 175 passed, 19 todo (rendering, Phase 3).

## Phase 2 verification review — fresh Codex session (2026-11-24)

**Instruction:** "Sure, run a session. Push when you finish."

**Review:** `codex-review` (phase `code`, base `7aaa47e`), 3 rounds, each with 1–3 blockers, all confined to the demo-database lock and reset path:

| Round | Finding | Fix |
|---|---|---|
| 1 | A waiting `--reset` could publish after another | Identity re-check (later replaced) |
| 1 | Orphaned sidecars without a database | `lstat` check before every publish |
| 1 | Premise: in-place recovery vs byte-identical refusal | **Owner decision:** refuse and touch nothing; recovery happens only when the demo server opens the file |
| 2 | Post-rename, pre-release window | A lock **epoch** read before locking (busy = refuse) and re-checked after acquiring |
| 3 | A publisher killed after its rename rolled back the epoch | Commit the epoch at acquisition; EXCLUSIVE locking mode keeps the lock |

**Response:**

- each fix has a deterministic process-level test, using the test-only pause points `RB_TEST_PAUSE_BEFORE_LOCK` and `RB_TEST_PAUSE_AFTER_PUBLISH`;
- each fix was confirmed by reverting it in a scratch copy;
- the lock tests passed 5–8 consecutive reruns at each stage;
- a regex mismatch first looked like a flaky test, but the captured stderr showed correct behaviour with new wording.

**Status:** the cap was reached; the round-3 fix (epoch commit timing) is verified by tests but not yet by Codex.

**Check:** `npm run check` gives 180 passed, 19 todo.

## Phase 3 — render and export (2026-11-24)

**Instruction:** "Go ahead", approving the Phase 3 plan, the `parse5@8.1.1` pin and the `printedHtml` field.

**Work** (see docs/decisions.md, Phase 3):

- `src/render/`: the adapter, the parse5 content policy and the pdf.js page count. `/preview` serves the §3.5 CSP; `/export/pdf` sends `X-Page-Count` and `X-Overflow-Warning`.
- `tests/support/pdf.ts`, `oracle.ts`, `render.ts`: the §7.3 extractor and checks, plus a real renderer instrumented with a probe.
- `tests/phase3/`: T11, T12, T14, T22, T23, self-tests 1, 2 (×3), 4, 5 and 6a–c, and the debugging.md #1 offline regression. The HTTP fixture harness now also runs T16, T16b and T26's printed, PDF and direct-SQL steps; the 19 Phase 3 todos are gone.
- `tests/tools/candidate-goldens.ts`: writes candidate full-text goldens anywhere except `fixtures/`.

**Found by the tests:** Even renders skill keywords as `<li>`, contrary to the §7.3 basis. The owner chose to add them to the expected list rather than skip keyword lists (D18).

**Planted faults** (each reverted in a scratch copy; every one made at least one test fail):

- policy disabled;
- `X-Overflow-Warning` hard-coded to false;
- page count fixed at 1;
- CSP header removed;
- single `<noscript>` parse;
- pdf.js normalization on;
- NFKC added to the extractor;
- printer errors no longer mapped to `RENDER_FAILED`.

**Goldens:** the owner asked for "a codex audit [to] confirm" the candidates. Codex (`results` phase, session `rb-phase3-goldens`) found no blockers and one note: two Platform fields Even does not print. The owner then approved all three files (fixtures/README.md change log).

**Visual inspection:** the owner found the Overflow continuation pages too close to the top edge. Variant C was approved as D19 (docs/decisions.md): page margins, except at the top of page 1, plus unbroken bullets, with layout checks added.
The owner then inspected the fresh Security, Overflow and Platform PDFs: "all three look fine".

**Chrome process leak:** reproduced (7 processes left after a hung print). The owner chose the launch wrapper with a shorter timeout (D20, docs/decisions.md).

**Audit:** the owner asked for a Codex audit of the whole phase. Round 1 (base `b847ec6`) raised 3 blockers and 2 improvements, all fixed (docs/decisions.md, "Phase 3 Codex review"). Round 2 confirmed them and raised 1 new blocker (an empty-rendering Markdown bullet, D21), also fixed. Round 3, the cap, raised 2 blockers in that fix, which were fixed but not reviewer-verified, plus a premise question. The owner approved D21 ("reject on save") and chose to keep the phone link clickable (D22).

**Check:** `npm run check` gives 296 passed, 0 todo.

## Phase 4 — UI (2026-11-24)

**Instruction:** "Sounds good", approving the Phase 4 plan, the six dependencies and the `dev`/`demo` setup.

**Work:**

- **Dependencies:** React 19.3.1 and Vite 8.3.7, plus `@vitejs/plugin-react` and the React types, each pinned exactly to a release at least two weeks old (THIRD_PARTY.md). No router, component library, CSS framework or DOM-testing library.
- **Commands:**
  - `npm run dev` runs the API and the Vite dev server, with `/api` proxied.
  - `npm run demo` builds the UI, and the API server then serves it and the API together on 127.0.0.1:5174, with its own CSP.
  - `npm run build` builds the UI only.
- **`src/client/`:**
  - A **Library** view, labeled "Shared library". Edits to rendered shared fields show the impact prompt; fact and tag edits save directly; deletes are checked first and show the affected resumes when blocked. Profile and education include the first-run form.
  - A **Resumes** view, labeled "This resume only": ordered entries, bullets and skills with up/down controls, the fact shown next to each wording choice, no default wording, an "Unsaved changes" marker, and a Save / Discard / Cancel prompt when switching resumes.
  - Preview and export are disabled until saved. Preview appears in a sandboxed iframe, and the PDF overflow warning comes from `X-Page-Count`.
- **Tests:**
  - `tests/phase4/ui-smoke.test.ts` drives the built UI over HTTP in headless Chrome through the five §7.2 flows, plus the explicit-wording rule, the switch prompt and the preview sandbox. It fails on any console error except Chrome reporting that the sandbox blocked Even's script.
  - `client-logic.test.ts` covers the draft operations and the form-to-request conversion; `ui-serving.test.ts` covers the CSP, asset names, traversal and the Host check.
- **Found while building:**
  - Vitest loaded `vite.config.ts` (root `src/client`) and found no tests; a `vitest.config.ts` now fixes the test root.
  - The smoke test's first run caught the expected sandbox block of Even's script, which is now asserted explicitly.

**Check (before review):** `npm run check` gave 325 passed, 0 todo. The smoke test passed 3 of 3 reruns. `npm run demo` and `npm run dev` were started and exercised by hand with curl, and both stop cleanly.

**Codex review round 1** (session `rb-phase4-code`, base `9f0493c`): 5 blockers, 4 improvements, all addressed.

1. **Dev server CORS (BLOCKER).** Confirmed with curl: Vite granted `Access-Control-Allow-Origin` to `http://127.0.0.1:9999`. Fixed with `server.cors: false`.
2. **Dev server served the database (BLOCKER).** Confirmed: `/@fs/<project>/.probe/library.sqlite` returned the file. Fixed with `server.fs.allow` limited to `src/client` and `node_modules`, and denial of `*.sqlite*`, `.data/` and `.demo/`. Regression: `tests/phase4/dev-server.test.ts`, which starts the real config.
3. **Late responses could overwrite edits (BLOCKER).** Open, save, create and delete now lock the editor and the resume list (`<fieldset disabled>`) and never overlap. Smoke-test regression: Puppeteer holds the GET and PUT, the test checks that the controls are disabled while pending, then releases them.
4. **Shared edits skipped confirmation when the impact list was empty (BLOCKER).** The prompt now always appears, saying that no saved resume's export changes. Smoke-test regression includes Cancel.
5. **A failed Vite startup left the API running (BLOCKER).** `dev.ts` starts Vite first, so a busy UI port never opens the database; it passes the API's exit code through (2 on refusal) after closing Vite. Two more protections:
   - Vite's own SIGTERM handler, which exits immediately, is replaced by the launcher's;
   - an exit hook signals the API on any exit path.

   Regressions are in `tests/phase4/launch-commands.test.ts`.
6. **Stale output (IMPROVE).** The output panel is remounted per resume and per library version.
7. **Commas in keywords and tags (IMPROVE).** These are now one item per line, which round-trips because items are single-line.
8. **Overlapping prompts (IMPROVE).** Prompts are now queued. No automated test.
9. **Command coverage (IMPROVE).** `launch-commands.test.ts` runs the §9 refusal and fresh-start cases (2, 5, 6, 7, 7b) through `src/server/dev.ts` and `npm run demo` in isolated roots. `--ui` now locates `dist/client` from the module URL, because the build is a code artifact, not data under `RB_ROOT`.

Planted faults that failed tests: no editor lock; skipping the prompt when no resume is affected; comma-separated lists; Vite's default CORS; Vite's default `fs`; API started before Vite. **Not caught:** keeping Vite's SIGTERM handler. With the exit hook in place, its only effect is an exit-code race (143 or 0); no orphan resulted in 2 whole-file runs or per-test runs.

**Check:** `npm run check` gives 344 passed, 0 todo; the smoke and launch tests each passed 3 of 3 reruns.

**Codex review round 2:** the round-1 fixes held. 3 new blockers and 2 improvements, all addressed.

- **2. The dev server could still serve a database with an unusual name (BLOCKER).** `DB_PATH` may have any file name, such as `src/client/personal.db`, and Vite's public directory bypassed the deny list. `dev.ts` now resolves the database exactly as the API does (`resolvePersonalDbPath`) and exits 2 if it lies inside `src/client` or `node_modules`, the only served directories, whatever its name. `publicDir: false`.
- **10. Switching resumes could swallow a PDF warning (BLOCKER).** A pending preview or export now also locks resume switching, so its result appears under the resume that requested it. If the panel is invalidated anyway (a library edit remounts it), the request is aborted: no download and no stale result.
- **11. A pending profile save could lose newer edits (BLOCKER).** The profile form is locked from Save until the refresh. This also exposed a real bug: the "Profile saved." notice was lost when the refresh remounted the form, so it now lives in the parent.
- **9. Tests touched the live checkout (IMPROVE).** The dev-server and launch tests now run from a temporary project copy (`tests/support/project-copy.ts`) with synthetic databases and a private Vite cache. Added §9 cases through the launcher: the `.demo/../.demo` spelling, a dangling `DB_PATH` symlink, and a database inside a served directory.
- **12. The proxy was open before the API bound its port (IMPROVE).** `/api` answers 503 until this launcher's own API child prints its bound port. Test: an impostor server already on the API port is never reached through the proxy, and the launcher exits nonzero.

Planted faults: removing the served-directory refusal, the API gate, `publicDir: false`, the export lock, the abort, or the profile lock each fails a test.

**Check:** `npm run check` gave 351 passed, 0 todo; the smoke test passed 3 of 3 reruns.

**Codex review round 3 (the cap):** 2 blockers and 2 improvements, all fixed. **None of these fixes is verified by the reviewer**, because the cap allows no fourth round.

- **2. Database boundary gaps (BLOCKER).**
  - The containment check misread a child named `..private.db` as outside the directory; it is now component-wise.
  - A symlink inside the client directory could lead Vite to the database. The launcher's middleware now resolves each requested file (`/@fs/…` or under the client root) through symlinks and returns 403 for the database, its sidecars, or anything under `.data/`/`.demo/`.
  - The served directories come from one module (`src/server/served.ts`), shared by the Vite config and the launcher.
- **10. Leaving the Resumes view could hide a PDF warning or error (BLOCKER).** Leaving the view now cancels any pending preview or export: no unseen download, warning or error.
- **9. The test copy wrote into the live `node_modules` (IMPROVE).** The copy now has its own `node_modules` directory of per-package links, so Vite's `.vite-temp` and dependency cache stay in the copy. The allow list includes the packages' real directories. Checked: during a test run, the only write to the live `node_modules` is Vitest bundling its own config, which an unrelated test file also does.
- **13. A page opened during dev startup stayed stuck (IMPROVE).** The launcher prints the UI URL only after the API has bound, and the app retries the library load while it gets `503 API_STARTING`.

Planted faults that fail tests: prefix-based containment, no resolved-file check, printing the URL before the API is ready, no cancel on leaving the view, no retry.

**Suite stability on a loaded machine:**
- Symptom: with other heavy work on the machine (a VM and games; load average 40–80 on 10 cores), timing-bounded tests failed at random, a different one each run. Each passes alone.
- Changes, all test settings only:
  - `vitest.config.ts` runs at most 4 files in parallel, with a 30 s default timeout;
  - the suite sets `RB_PRINT_TIMEOUT_MS=60000` (a new override; the app default stays 15 s, and the D20 tests pass their own short timeouts);
  - the smoke test's waits were widened;
  - removing a test copy retries.
- Result: 3 of 3 full runs passed while that load continued.

**Check:** `npm run check` gives 354 passed, 0 todo, 3 of 3 runs.

### Phase 4 verification review — fresh Codex session (`rb-phase4-verify`, base `9f0493c`)

**Instruction:** "You can do another review. Kill the old demo." The leftover demo server from an earlier session's scratch copy (PID 16788) was stopped.

**Round 1:** 2 blockers, 2 improvements, 1 nit. None repeats an earlier finding; all addressed.

1. **A personal database could live in the build output (BLOCKER).** Confirmed: `resolvePersonalDbPath` accepted `dist/client/personal.sqlite`, which `npm run demo`'s `vite build` empties. Personal mode now refuses any path inside `dist/`, which is located next to the code, like the build. This covers `dev`, `api` and the launcher.
2. **The served file could still be the database (BLOCKER).**
   - Dev: the middleware now compares the file that would actually be read (for a directory, its `index.html`) by device and inode against the personal and demo databases, their sidecars and the lock file. That covers hard links with innocent names, as well as symlinks.
   - Built server: it serves only regular files with one link, never following symlinks or hard links.
3. **Stale Add choices (IMPROVE).** Pending entry, skill, accomplishment and wording choices are re-validated against the current library; a deleted one is dropped and Add is disabled. Add-bullet buttons now have distinct accessible names ("Add bullet to <entry>").
4. **An earlier save could close a newer edit form (IMPROVE).** A record's Edit and Delete stay disabled while its submission and refresh are pending.
5. **The first-run Cancel did nothing (NIT).** Removed from the always-visible first-run form.

Planted faults that failed tests: no build-output refusal; path comparison instead of identity; directory index ignored; the built server following links; no stale-choice validation; Edit not locked.

**Check:** `npm run check` gives 358 passed, 0 todo; the smoke test passed 3 of 3 reruns.
