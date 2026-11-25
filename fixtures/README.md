# Synthetic fixture contract

These fixtures contain no real candidate data. Expected files are written by hand, independently of any assembler, renderer or theme run. Do not regenerate them from the implementation, and do not edit them to make a test pass. Any change needs explicit owner approval and an entry in the change log below.

## Status

| File | Status |
|---|---|
| `primary.input.json`, `security.expected.json`, `engineering.expected.json`, `deletion.expected.json`, `overflow.input.json` | Original set (approved by owner before v2) |
| `security.pdf.expected.json`, `overflow.pdf.expected.json` | Original set, plus additive v2 fields (see change log) |
| `overflow.expected.json`, `first-run.expected.json`, `primary-mutations.expected.json`, `shared-edit.*`, `sections.*`, `sections-mutations.expected.json`, `deletion-more.expected.json`, `invalid-configs.json`, `text-handling.expected.json` | New in v2 — **approved by owner (2026-11-24)** |

## Input format (`*.input.json`)

- `profile`: `name` (required); `label`, `email`, `phone`, `url` (optional); `education` (ordered array of JSON Resume education objects, global to every resume). A legacy `profile.skills` key, if present, must be `[]`; skills now live in the top-level library.
- `experiences[]`: work entries. `id`, `name`, `position`; optional `location`, `url`, `startDate`, `endDate`.
- `projects[]` (optional, default `[]`): project entries. `id`, `name`; optional `url`, `startDate`, `endDate`.
- `skills[]` (optional, default `[]`): `id`, `name`; optional `level`, `keywords`.
- `accomplishments[]`: `id`, `fact`, `tags`, and exactly one parent: `experienceId` or `projectId`.
- `variants[]`: wording variants. `id`, `accomplishmentId`, `text`.
- `resumes[]`: `id`, `name`, `experiences[]` (`experienceId`, ordered `bullets[]` of `{accomplishmentId, variantId}`), optional `projects[]` (`projectId`, `bullets[]`), and optional `skills[]` (ordered skill IDs). Array order is the saved order. No ordinals are supplied; the seed loader derives them.

Experience and project IDs share one namespace (one `entries` table in the database).

## Files

- `primary.input.json`; `security.expected.json` and `engineering.expected.json` (T01): deep equality with array order significant. Validate separately against `@jsonresume/schema`.
- `primary-mutations.expected.json`: T02, T03, T05, T09a–c (T09c: an edit that normalizes to the current value has empty impact), T13, T17a–c, T24 (invalid dates rejected on write), T25 (email/URL formats, blank strings, a valid-email control, clearing with null; profile steps use PATCH), as step sequences with complete expected exports. `"file:<name>"` means deep equality with that file.
- `deletion.expected.json` (T04) and `deletion-more.expected.json` (T07, T20a–h): rejected deletes preserve every row; allowed deletes remove exactly the listed records.
- `invalid-configs.json` (T08a–i): each rejected payload, its status and code, and the unchanged export.
- `shared-edit.input.json` and `shared-edit.expected.json` (T21): the three-resume shared correction (Security and Cloud share v11; Engineering uses v12). Before and after exports, the expected impact set, and the baseline comparison counts.
- `sections.input.json`, `sections.platform.expected.json`, `sections.data.expected.json` (T18): Work, Projects, Skills and Education mapping with different per-resume selection and order. `sections-mutations.expected.json` (T19a–c) covers skill propagation, per-resume skill order, and section omission.
- `overflow.expected.json` (T12 JSON oracle): the header fields were typed by hand, and `highlights` is the independently written `orderedBullets` list of `overflow.pdf.expected.json`.
- `security.pdf.expected.json` (T11), `overflow.pdf.expected.json` (T12), `sections.pdf.expected.json` (T23): text oracles against the actual PDF bytes (SPEC §7.3). `orderedSequence` interleaves headers and bullets and is checked in position-sorted reading order. It encodes the chosen theme's fixed section order (Even 0.27.0: Work, Education, Projects, Skills); changing the theme requires owner review of this field. `overflowWarning` is the expected value of the page-count warning.
- `first-run.expected.json` (T27): first run from an empty database (no profile), impact across profile creation.
- `text-handling.expected.json` (T16, T16b): HTML-like text is escaped, while inline Markdown is interpreted by the theme (a documented limitation); T26 covers the URL/link/asset policy (SPEC §3.5): Markdown images (including nested-bracket forms) rejected on write, unsafe link schemes neutralized, and runtime refusal (`CONTENT_POLICY_VIOLATION`) of an image that bypassed validation.
- `<case>.pdf.text.txt` (T11, T12, T23; created in Phase 3): owner-reviewed full-text goldens (SPEC §7.3, "Approved full-text check"). These are an explicit, documented exception: they start from real output but are reviewed segment by segment against the independent expected JSON. Each carries an approval line.

## Change log

- **v2 (2026-11-24)**:
  - Added the new files listed above.
  - In `security.pdf.expected.json`, added `overflowWarning: false`, `orderedSequence`, and `absentInternalText` (canonical facts must never print). Tags are not listed because the tag `access` legitimately occurs inside selected wording.
  - In `overflow.pdf.expected.json`, added `overflowWarning: true`.
  - No existing value was changed or removed.
  - Reason: EVALUATION.md §9 (Projects and skills requirements; bullet-to-employer ordering; required overflow warning).
- **v2 approval (2026-11-24):** the owner approved every v2 fixture file listed above. The `<case>.pdf.text.txt` goldens do not exist yet; each still needs its own owner review when it is created in Phase 3.
- **Phase 2 (2026-11-24):** added the missing `"status": 200` to the first (impact) step of T09c in `primary-mutations.expected.json`. Authoring omission found when the HTTP runner first ran; no expected value changed.
- **Phase 3 (2026-11-24):** added `security.pdf.text.txt` (T11), `overflow.pdf.text.txt` (T12) and `sections.pdf.text.txt` (T23).
  - Generated with `node tests/tools/candidate-goldens.ts <scratch-dir>`.
  - A Codex audit (session `rb-phase3-goldens`, one round) checked every segment against the expected JSON, the input selections and Even's template, and found no blockers. Its one note is recorded in the header of `sections.pdf.text.txt`.
  - The owner approved all three on that audit; each file carries an `# Approved:` line.
  - No other fixture changed.
