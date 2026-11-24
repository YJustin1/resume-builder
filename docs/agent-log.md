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
