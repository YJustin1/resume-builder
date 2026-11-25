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

**Check:** `npm run check` gives 257 passed, 0 todo.
