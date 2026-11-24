# Reusable Resume Builder — Implementation Specification (v2)

**Status:** Revised contract for implementation. It supersedes v1 (the preliminary draft) and incorporates `EVALUATION.md`.
**Scope:** Local, single-user MVP; about one week of development.
**Audience:** Project owner and AI coding agent.
**Authority when sources conflict:** (1) course final-project requirements, (2) instructor feedback, (3) the owner's updated requirements, (4) the original proposal, (5) this spec and the fixtures. Report any remaining conflict; do not resolve it silently.

## 0. Decisions adopted in v2

| ID | Decision | Status |
|---|---|---|
| D1 | Architecture: a small independent application that reuses published JSON Resume packages. No fork of jsonresume.org; the upstream app is used only as the executed behavioural baseline (§7.5). | Approved by owner |
| D2 | Rendering: `resumed` (`render`, `pdf`) with `jsonresume-theme-even` | Approved by owner |
| D3 | Theme: `jsonresume-theme-even@0.27.0`; fallbacks in §3.3 | Approved by owner (2026-11-24) |
| D4 | Runtime: Node 24 LTS (owner installed v24.22.3 via fnm) | Approved by owner (2026-11-24) |
| D5 | Database: SQLite via built-in `node:sqlite` | Approved by owner (2026-11-24) |
| D6 | Projects export `name`, `url`, `startDate`, `endDate`, `highlights`; no `summary`/`description` in the MVP (Even ignores `summary`, and `description` is deprecated) | Approved by owner (2026-11-24) |
| D7 | Skills are selected per resume as whole records (no per-resume keyword subsets) | Approved by owner (2026-11-24) |
| D8 | Education and profile (`basics`) are global and always included | Approved by owner (2026-11-24) |
| D9 | Text is stored and exported exactly as entered. Inline Markdown is interpreted by the theme, per JSON Resume 1.11; documented as a known limitation (T16b) | Approved by owner (2026-11-24) |
| D10 | No network control during printing (`resumed` exposes none). Export must still work offline; fonts fall back | Approved by owner (2026-11-24) |
| D11 | The page-count / overflow warning comes from the generated PDF and is shown on PDF export | Approved by owner (2026-11-24) |
| D12 | Section order is the theme's fixed order (Even: Work, Education, Projects, Skills); order within each section is ours | Approved by owner (2026-11-24) |
| D13 | `start` tag content as in §12 | Approved by owner (2026-11-24) |
| D14 | New fixture files; existing expected values unchanged (additive fields only) | Approved by owner (2026-11-24) |
| D15 | Keep the identifier `variant` in data, API and code, but call it a **wording variant** in UI and docs. It is never a "resume variant" (upstream's term for a whole-resume copy) | Approved by owner (2026-11-24) |
| D16 | Dates use the JSON Resume `iso8601` subset: `YYYY`, `YYYY-MM`, `YYYY-MM-DD` | Approved by owner (2026-11-24) |
| D17 | `basics.label` is global; `basics.summary` is **not supported** in the MVP; no per-resume headline | Approved by owner (summary excluded) |

Agents must not change any of these without owner approval.

## 1. Purpose and success criteria

Applicants keep near-identical resumes for different roles. This application separates three things: professional facts, alternative wordings of each accomplishment, and resume-specific selections. Users maintain one library of work experiences, projects, accomplishments, wording variants and skills. Each named resume is a saved **configuration** that references library records; it is never a copy of their text. Exporting resolves those references into a portable JSON Resume document, then renders it to HTML and PDF with reused third-party software.

A successful MVP lets a user:

- create work experiences and projects with accomplishments and several wording variants each;
- maintain shared skills, education and profile;
- assemble two or more resumes that select, order and word the same records differently;
- change one configuration without affecting another;
- edit shared records knowing which resumes they affect;
- be blocked from deleting records that saved resumes reference;
- export a schema-valid JSON Resume document and a searchable PDF, with a warning when the PDF exceeds one page.

Repeatable fixtures must expose:

- incorrect selection or ordering;
- unsafe shared-record deletion;
- edit propagation that reaches too few resumes, or too many;
- PDF truncation.

All application decisions are made in ordinary code; no model calls at runtime.

### 1.1 Scope

**Required:**

- local persistence (SQLite);
- React/TypeScript browser UI with a local TypeScript server;
- profile, education (global), work experiences, projects, accomplishments, wording variants, skills;
- resume create, select, order, edit, delete (two or more saved configurations), covering work entries, project entries, bullets per entry, wording choice, and skills;
- impact analysis for shared edits;
- restricted deletion;
- JSON Resume schema validation;
- HTML preview;
- PDF export with a page-count warning;
- independent fixtures, automated tests, reproducible setup and demo, and project evidence in the repository.

**Not required:**

- authentication, cloud sync, multi-user collaboration, version history;
- AI-generated text, job-description matching, ATS scoring;
- automatic one-page fitting;
- multiple or custom themes;
- importing existing resumes;
- drag-and-drop, rich text;
- LaTeX;
- per-resume education selection, per-resume skill keyword subsets, per-resume `basics`, and `basics.summary` (D17);
- volunteer, awards, publications, certificates and other sections;
- tag filtering;
- duplicating a resume;
- concurrent-edit detection.

## 2. Components and boundaries

| Component | Responsibility | Owner-written logic a test can falsify |
|---|---|---|
| 1. Library and integrity (`src/db`, `src/core/impact.ts`) | Store profile, education, entries, accomplishments, wording variants, skills and configurations. Enforce integrity. Compute impact | Dependency detection, restricted deletion, atomic writes, ownership checks, contiguous ordering, `impactOf` results |
| 2. Assembly and export (`src/core/assemble.ts`, `src/render`) | Validate a configuration, resolve references in order, map to JSON Resume, schema-validate, render HTML/PDF, count pages, report failures | Exact selection, order and exclusion; field mapping; determinism; export consistency; page-count warning |
| 3. User interface (`src/client`) | Library editor, configuration builder, impact and conflict display, preview and export | Visible distinction between shared and local actions; affected-resume display; error recovery |

Third-party software is reused and credited (§12), not claimed as original work: SQLite/Node, React, `resumed`, the JSON Resume schema and validator, the Even theme, Puppeteer/Chrome, and pdf.js. The assembler, the impact analysis and the referential-integrity rules are the main graded logic.

## 3. Architecture and implementation defaults

### 3.1 Platform

- **One Git repository, one package** (`client`, `server`, `core`, `db`, `render` directories; no monorepo).
- **Runtime and language:** Node 24 LTS (`.nvmrc` = `24`; `engines.node` = `>=24`), with TypeScript end to end.
- **Libraries:** React + Vite for the client; a small HTTP server (Express or Hono) bound to `127.0.0.1`; `node:sqlite`; Vitest.
- **Pinning:** exact versions with a committed `package-lock.json`. Record the Node version and the tested OS.
- **Server owns the data:** the server owns SQLite access, validation and export; the browser never opens the database.
- **Storage location:** data lives in a gitignored local directory (override with `DB_PATH`). Tests use isolated temporary databases and never touch the user's database.
- **Transactions:** one transaction per multi-row write or dependency-sensitive delete. Run `PRAGMA foreign_keys = ON` on every connection.
- **Read consistency:** assembly reads a consistent snapshot. The JSON, HTML and PDF for a request are produced from the same assembled object.

### 3.2 Reused rendering pipeline (verified in EVALUATION.md E2–E13)

1. **Validate:** `@jsonresume/schema@1.11.0` `validate(resume, cb)` (the package's own `jsonschema`-based validator). The schema allows additional properties, so schema validity is a weak check. Deep equality with the fixtures is the real oracle, and invalid-schema tests must use type violations.
2. **HTML:** `resumed@7.1.0` `render(resume, theme)` with `jsonresume-theme-even@0.27.0`. `resumed.render` just calls `theme.render`.
3. **PDF:** `resumed` `pdf(html, resume, theme)`. It launches Puppeteer (`puppeteer@25.x`, a peer dependency of `resumed`), sets the HTML content and prints.
   - **Browser:** install with `PUPPETEER_SKIP_DOWNLOAD=1` and set `PUPPETEER_EXECUTABLE_PATH` to an installed Chrome. Alternatively, with owner approval, run `npx puppeteer browsers install chrome` (a user-level cache).
   - **Paper:** Letter is Puppeteer's default (verified 612×792 pt). Never add `meta.pdfRenderOptions` to the exported JSON.
4. **Page count:** read the generated PDF bytes with `pdfjs-dist@6.5.438` (also used by the tests, §7.3).
5. **Rendering adapter:** `renderHtml(resume) → string` and `renderPdf(resume) → {bytes, pageCount}` behind one interface, so tests can inject a failing adapter (T14). No remote images or user-supplied asset URLs are emitted: the mapping never produces `basics.image`. The theme may request web fonts when online and must still render offline (Phase 0 gate).
6. **Escaping:** user text is never inserted as raw HTML by our code; the theme escapes HTML (verified for Even, T16).

### 3.3 Fallbacks (keep every core test unchanged)

- **F1:** if JavaScript or network behaviour during printing breaks a check, keep `resumed.render` but print with direct Puppeteer/Playwright calls, with JavaScript off and requests blocked. This mirrors upstream `@repo/resume-pdf`, MIT; attribute any copied code.
- **F2:** if the theme cannot preserve content or order, or its Markdown or section-order behaviour is unacceptable, use one fixed single-column local HTML template printed through the same PDF path. Record any fallback in `docs/decisions.md` and the README.
- **What each fallback changes (requires owner approval).** Independent JSON oracles, PDF content and order checks, exclusion sets and the printed-bullet sequence check apply unchanged under every renderer.

| Check | Default (`resumed.render` + `resumed.pdf`) | F1 (`resumed.render` + direct print) | F2 (fixed template + direct print) |
|---|---|---|---|
| Offline gate | Phase 0: `npx resumed export …` with the network off. **If it fails, Phase 0 still passes**: record the failure in `docs/decisions.md`, owner approves F1, and the offline gate moves to Phase 3 | Phase 3, through the F1 adapter (`npm run export:check -- --offline`) | Same as F1 |
| T16b (Markdown) | Markdown interpreted (as written) | Same | Template prints plain text. One owner-approved revision changes **both** fields together: `pdfMustContain` becomes `Used **bold** markers and \`code\` spans.`, and `pdfMustNotContain` becomes `[]` |
| `orderedSequence` section order | Even's | Even's | The template's order, by owner-approved fixture revision |
| Approved full-text files | Approved for Even | Re-approved | Re-approved |
| §3.5 URL/asset policy test (T26) | As written | Same | Write-time rejection of image syntax stays (it uses the theme's parser regardless of renderer). The template renders no Markdown, so, by revision: the link step expects the literal text, and the direct-SQL bypass step expects export `200` with the bypass string printed literally and no `<img>` (runtime enforcement still runs and finds nothing) |
| Contact items in the printed-bullet check (§7.3) | Even's contact `<li>` list | Same | The template renders contact values (email, phone, url) as `<li>` in one list before the entries, and highlights as `<li>`, with nothing else as `<li>`. The §7.3 rule applies unchanged |

### 3.5 URL, link and asset policy

The rules below are based on this behaviour of the pinned renderer, verified in EVALUATION.md E14:

- Even renders Markdown images in highlights as `<img>`, and **Chrome fetched the image URL while printing, including `http://127.0.0.1:…`**.
- `javascript:` and `data:` Markdown links are rendered with `href=""`.
- `https:` links are kept.

**Rules:**

1. **No user-supplied assets.**
   - **Policy scope:** the rule rejects syntax that **renders an image**, not image-like text. For example, `![alt][ref]` with no reference definition renders as literal text. It is accepted, and single-line fields cannot contain a definition.
   - **Write-time check:** every exported text field (variant text, entry and skill fields, profile fields, education) is parsed with **the same Markdown parser the theme uses**. That is `micromark` as resolved from `jsonresume-theme-even`'s dependency (2.11.4 in the lockfile). If the output contains an `<img` element, the write is rejected with `400 INVALID_INPUT`. A regex is not acceptable: E14 follow-up showed `![a [b] c](url)` defeats a simple bracket regex but is still rendered as an image.
   - The assembler never emits `basics.image` or `profiles`.
   - **Runtime enforcement (not only tests):** the render adapter parses every HTML document with an HTML parser (`parse5`) **before** returning it to the preview or passing it to `resumed.pdf`, and refuses it on any of the following:
     - an `img`, `picture`, `source`, `iframe`, `frame`, `object`, `embed`, `video` or `audio` element;
     - any `src`, `srcset`, `poster` or `data` attribute (inline `<svg>` without external references is allowed);
     - a `<link>` other than `rel="stylesheet"`/`preconnect` to `https://fonts.googleapis.com` or `https://fonts.gstatic.com`;
     - an `<a href>` that is non-empty and not `http:`, `https:` or `mailto:`.

     A violation returns `409 CONTENT_POLICY_VIOLATION`, naming the element, and **the printer is never invoked**. This guards against stored data that bypassed write validation (e.g. older rows or direct SQL).
   - Theme assets (web fonts) are the only network loads.
2. **URL fields** (`basics.url`; work and project `url`; education items have no URL in the MVP, by owner decision) must pass the schema `uri` format **and** use the `http:` or `https:` scheme; anything else is `400 INVALID_INPUT`.
3. **Links inside text.** Inline Markdown links are allowed (schema #600). Only `http:`, `https:` and `mailto:` targets may appear as non-empty `href` values in the printed HTML. Other schemes must be neutralized; the renderer does this, and a test asserts it.
4. **Preview isolation.** The preview is served in an `<iframe sandbox>` with neither `allow-scripts` nor `allow-same-origin`, and the preview response carries `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:`.

**T26** (`text-handling.expected.json`) verifies rules 1–3 against the pinned renderer.

### 3.4 Suggested layout (an implementation may adjust it with a documented reason)

```text
SPEC.md  EVALUATION.md  README.md  THIRD_PARTY.md  package.json  package-lock.json  .nvmrc
src/core/      # pure: config validation, assemble(), impactOf(), mapping
src/db/        # schema, migrations, repositories, transactions, seed loader
src/server/    # HTTP endpoints
src/render/    # resumed adapter, PDF page counting, (vendor/ for any copied third-party code)
src/client/    # React views
fixtures/      # owner-approved synthetic inputs and expected outputs
tests/         # unit, DB integration, export, PDF, baseline comparison
baseline/      # upstream comparison script + recorded transcript (optional to rerun)
docs/          # decisions, agent log, debugging story
```

## 4. Domain model and invariants

**IDs:** stable opaque strings (UUIDs for new records; readable fixed strings in fixtures). IDs never change.

**Field rules:**

- Required unless marked optional.
- Trim leading and trailing whitespace.
- Reject empty required fields, control characters (ordinary spaces are allowed) and malformed IDs.
- Text fields are single-line plain strings, stored and exported exactly as entered (after trimming). The theme may interpret inline Markdown (D9).
- **Schema formats on write:** fields the pinned schema constrains are checked on write, on configuration save and on impact proposals, using the pinned validator itself so the rules cannot diverge. Validate a minimal document containing only the candidate value. Verified behaviour of `@jsonresume/schema@1.11.0`:
  - `basics.email` (`format: email`): `not-an-email` is rejected;
  - `basics.url` and work and project `url` (`format: uri`): `not a url` and `example.com` are rejected, because a scheme is required; `https://example.com/x` is accepted;
  - dates: see below.

  A failing value is `400 INVALID_INPUT`, and the stored record is unchanged.
- **Clearing optional fields:** in a `PATCH` or `PUT` body, `null` clears an optional field, which is then omitted from exports. An empty or whitespace-only string is rejected with `INVALID_INPUT`. Omitting a key in a `PATCH` leaves that field unchanged.
- The user, not the software, is responsible for factual accuracy.

| Entity | Fields / constraints |
|---|---|
| Profile (singleton) | `name`; optional `label`, `email`, `phone`, `url`; `education`: ordered array of `{institution (required), area?, studyType?, startDate?, endDate?}` |
| Entry | `id`, `kind` ∈ {`work`, `project`} (immutable), `name`. Work: `position` (required), optional `location`, `url`, `startDate`, `endDate`. Project: optional `url`, `startDate`, `endDate` |
| Accomplishment | `id`, `entryId` (immutable), `fact` (canonical description, never exported), `tags` (ordered list of nonempty strings, never exported) |
| Wording variant (`variant`) | `id`, `accomplishmentId` (immutable), `text` (the bullet to render) |
| Skill | `id`, `name`; optional `level`, `keywords` (ordered list of nonempty strings) |
| Resume | `id`, `name` (internal label, never printed) |
| Entry selection | `resumeId`, `entryId`, `kind`, `sortIndex` (zero-based within that resume and kind) |
| Bullet selection | `resumeId`, `entryId`, `accomplishmentId`, `variantId`, `sortIndex` (zero-based within that entry) |
| Skill selection | `resumeId`, `skillId`, `sortIndex` |

**Dates (D16):** applies to work, project and education dates.

- **Format:** must match the pinned schema's `iso8601` pattern exactly: `^([1-2][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])|[1-2][0-9]{3}-(0[1-9]|1[0-2])|[1-2][0-9]{3})$`. That means years 1000–2999.
- **Calendar check:** full dates must also be real calendar dates (e.g. reject `2025-02-30`).
- **Order:** when both dates are present, the end must not be before the start, compared at their common precision (`2024` vs `2024-05` passes).
- **Missing end:** an omitted end means ongoing or unspecified; never invent one.
- **Errors:** an invalid date is rejected on write with `400 INVALID_INPUT`, and the stored record stays unchanged. A date accepted on write therefore never fails schema validation at export.

**Suggested relational structure** (verified behaviour of these constraints under `node:sqlite`: EVALUATION.md E10):

```text
profile(id CHECK id=1, name, label, email, phone, url, education_json)
entries(id PK, kind CHECK(kind IN ('work','project')), name, role_title, location, url,
        start_date, end_date, UNIQUE(id, kind),
        CHECK(kind='project' OR role_title IS NOT NULL))
accomplishments(id PK, entry_id FK->entries ON DELETE CASCADE, fact, tags_json, UNIQUE(id, entry_id))
variants(id PK, accomplishment_id FK->accomplishments ON DELETE CASCADE, text, UNIQUE(id, accomplishment_id))
skills(id PK, name, level, keywords_json)
resumes(id PK, name)
resume_entries(resume_id FK->resumes ON DELETE CASCADE, entry_id, kind, sort_index CHECK(sort_index>=0),
    PK(resume_id, entry_id), UNIQUE(resume_id, kind, sort_index),
    FK(entry_id, kind) -> entries(id, kind) ON DELETE RESTRICT)
resume_bullets(resume_id, entry_id, accomplishment_id, variant_id, sort_index CHECK(sort_index>=0),
    PK(resume_id, accomplishment_id), UNIQUE(resume_id, entry_id, sort_index),
    FK(resume_id, entry_id) -> resume_entries(resume_id, entry_id) ON DELETE CASCADE,
    FK(accomplishment_id, entry_id) -> accomplishments(id, entry_id) ON DELETE RESTRICT,
    FK(variant_id, accomplishment_id) -> variants(id, accomplishment_id) ON DELETE RESTRICT)
resume_skills(resume_id FK->resumes ON DELETE CASCADE, skill_id FK->skills ON DELETE RESTRICT,
    sort_index CHECK(sort_index>=0), PK(resume_id, skill_id), UNIQUE(resume_id, sort_index))
```

Use `NOT NULL` on required columns and prepared statements throughout. The library-internal cascades (entry → accomplishments → variants) run only as part of an allowed library deletion; resume references are always RESTRICT. SQLite reports only a generic `FOREIGN KEY constraint failed`, so affected-resume lists must come from application queries; the constraints are a backstop.

**Invariants:**

- **Uniqueness:** an entry occurs at most once per resume; an accomplishment at most once per resume; a skill at most once per resume; exactly one variant per selected accomplishment.
- **Ownership:**
  - a selected accomplishment belongs to the selected entry;
  - the variant belongs to that accomplishment;
  - an entry is selected only in its own kind's section.
  - No dangling IDs.
- **Ordering:** positions are unique and contiguous from zero in every ordered group after each successful save. The API derives positions from array order and never accepts client ordinals. Queries order explicitly; never rely on insertion or ID order.
- **No copies:** a resume stores IDs and order, never copies of text or a cached document. Resume names need not be unique.
- **Atomicity:** failed writes change nothing. Replacing a configuration validates the whole payload before committing, then deletes and re-inserts that resume's selection rows in one transaction. Reads and exports never mutate data.
- **Draft accomplishments:** an accomplishment may have zero variants while in draft; only accomplishments with an existing selected variant can be included.
- **Empty selections:** an empty resume is allowed. An entry selected with no bullets exports its header with `highlights: []`. Nothing is ever added automatically.

## 5. Behavioural requirements

### FR-01 — Library management

- Create, list, view and edit the profile, education, work entries, project entries, accomplishments, wording variants and skills.
- Tags are shown in the library. Canonical facts and tags are internal metadata and never exported.
- Wording is entered manually; no default variant is ever selected silently.
- An existing accomplishment or variant cannot be moved to a different parent, and an entry's `kind` cannot change; create a new record instead.
- Before saving an edit to a **rendered shared field**, the UI shows the resumes that will change (from `impactOf`, FR-04) and asks for confirmation. Rendered shared fields are:
  - variant text;
  - entry header fields;
  - skill name, level and keywords;
  - profile fields;
  - education.
- Edits to facts or tags change no export; their impact is empty.

### FR-01a — First run (no profile yet)

- A fresh personal database has no profile row.
- `GET /api/profile` returns `200 {"profile": null}`.
- Library records and resume configurations can be created before a profile exists.
- Every export (`/export/json`, `/preview`, `/export/pdf`) returns `409 PROFILE_REQUIRED` (message: "Set your name in the profile before exporting") until a profile with a `name` exists. The UI shows a first-run profile form in its place.
- `PUT /api/profile` with a `name` creates the profile; `PATCH` on a missing profile returns `409 PROFILE_REQUIRED`.
- **Impact before and at profile creation.** For FR-04, an assembly that fails with `PROFILE_REQUIRED` counts as the distinct state *unexportable*.
  - Before a profile exists, an edit leaves every resume unexportable, so it affects none.
  - A profile impact proposal (the `PATCH` shape) on a missing profile is evaluated as a creation. It must contain `name`, otherwise `400 INVALID_INPUT`, and it affects **every saved resume**, because each moves from unexportable to exportable.
  - Creating the first profile needs no confirmation prompt (nothing has been exported yet); the UI shows the first-run form instead.
- Covered by T27.

### FR-02 — Resume configuration

- **Resume lifecycle:** create a named resume, list and load saved resumes, rename, delete, and edit the configuration.
- **What the user selects:**
  - work entries and project entries, each with an ordered list of bullets (an accomplishment plus a chosen wording variant);
  - an ordered list of skills.
- Up/down controls order entries within each section, bullets within each entry, and skills.
- **Save scope:** Save applies only to the active resume ID. Unsaved changes do not affect exports or other resumes.
- **Unsaved state:** the UI marks unsaved changes and either requires a save before preview or export, or saves explicitly first. It never saves silently when switching resumes; it prompts to save or discard.
- **Isolation:** changing a selection, order or variant choice affects only that configuration. Removing a selection never deletes a library record.
- **Deleting a resume:** removes only its configuration rows, after confirmation.

### FR-03 — Shared record deletion (normative)

**Deletion is restricted while any saved resume depends on the record.** Check every saved configuration, not just the active one.

- **Variant:** blocked if selected by any resume.
- **Accomplishment:** blocked if selected by any resume. If unreferenced, its variants are deleted in the same transaction.
- **Entry (work or project):** blocked if included in any resume, even with no bullets. If unreferenced, its accomplishments and variants are deleted atomically.
- **Skill:** blocked if selected by any resume.
- **Education items and profile fields** are not referenced by configurations. Removing an education item is a profile edit; it affects every resume and shows its impact under FR-01.
- **Unreferenced deletes** succeed after UI confirmation. Deleting the last unreferenced variant of an accomplishment is allowed; the accomplishment becomes an unselectable draft.
- **A rejected deletion leaves the database unchanged,** including selection order and every other resume. No placeholder, automatic substitution, implicit removal or partial cascade. To proceed, the user removes or replaces the references explicitly, saves, and retries.
- **Error shape:** return `409 RECORD_IN_USE` with the affected resumes, even for direct API calls. Deduplicate and sort by ID.

Example: Security and Engineering both select accomplishment a1 with different variants.

- Deleting a1 lists both resumes.
- Deleting the variant only Security uses lists Security only.
- After Security switches to another variant, the now-unused variant deletes successfully.

### FR-04 — Impact analysis

Expose a pure core function, illustrative signature: `impactOf(snapshot, change) → { affectedResumes: {id,name}[], blocked: boolean }`.

- **Change forms:**
  - `{ "op": "edit", "type": "profile"|"experience"|"project"|"accomplishment"|"variant"|"skill", "id"?: string, "patch": {…} }`. The patch carries the **proposed new values** in the same shape as the corresponding `PATCH`/`PUT` body; `id` is omitted for `profile`.
  - `{ "op": "delete", "type": "experience"|"project"|"accomplishment"|"variant"|"skill", "id": string }`.
  - The patch is validated and normalized (trimmed) exactly as the write would be. An invalid patch gives `400 INVALID_INPUT`, not an impact result.
- **Edits — normative definition:** `affectedResumes` is the set of saved resumes R for which `assembleResume(snapshot, R)` and `assembleResume(snapshot ⊕ patch, R)` differ by deep equality (array order significant, object key order ignored).
  - So an edit that normalizes to the current value affects no resume.
  - Fact and tag edits affect none, because they are never exported.
  - Skill `level` or entry `location` edits affect every resume whose JSON contains them, whether or not the theme prints them. Impact is defined on the assembled JSON, never on PDF appearance.
  - `blocked` is always false for edits.
  - An implementation may use a reference query instead of assembling twice, but must return exactly this set.
- **Deletes:** `affectedResumes` are the resumes whose configurations reference the record, as defined in FR-03 (directly, or through the accomplishment's or entry's selections). `blocked` is true exactly when the list is non-empty.
- **Ordering:** results are deduplicated and sorted by resume ID.

The server uses the same function for FR-01 prompts, for FR-03 conflicts, and for `POST /api/impact`. The fixtures' `expectedImpact` values (including the no-op edit, T09c) are the oracle.

### FR-05 — Assembly

Expose a deterministic, side-effect-free core function: `assembleResume(snapshot, resumeId): JsonResume`.

1. Find the resume; validate references, ownership, kind, uniqueness and order. A missing or inconsistent record gives a structured failure, with no partial output and no fallback variant.
2. Build `basics` from the profile:
   - include `name`, `label`, `email`, `phone`, `url`;
   - omit absent optional fields; never emit empty strings or nulls;
   - never emit `summary`, `image`, `profiles` or `meta`.
3. Build `work[]` from the selected work entries in order: `name`, `position`, and the optional `location`, `url`, `startDate`, `endDate`, plus `highlights` = the chosen variant texts in order (empty if no bullets). `work` is always present, even when empty.
4. Build `projects[]` from the selected project entries in order: `name`, and the optional `url`, `startDate`, `endDate`, plus `highlights` (D6). Omit the section when no projects are selected.
5. Build `skills[]` from the selected skills in order: `name`, optional `level`, and `keywords` (omitted when empty). Omit the section when empty.
6. Copy `education[]` from the profile in saved order; omit when empty.
7. Exclude everything not selected: unused entries, accomplishments, variants and skills; IDs; tags; facts; internal resume names. Never sort by date, infer facts, deduplicate identical text, or inject timestamps or metadata.
8. Validate against the pinned schema before render or export; fail with an actionable error if invalid. Object key order is immaterial; array order is normative.

### FR-06 — Preview and export

- **JSON download:**
  - the UTF-8, schema-validated assembled object, served as `application/json`;
  - identical inputs give the same content.
- **HTML preview:**
  - the same assembled object, rendered by the same adapter as the PDF (`resumed.render` + Even);
  - displayed in a sandboxed iframe (`sandbox` without `allow-scripts`).
- **PDF download:**
  - searchable text on Letter paper;
  - no global shrinking, clipping, ellipses, or silently dropped content;
  - multiple pages allowed.
  - If rendering fails, return a clear error, never a misleading empty PDF or a success message.
  - PDF bytes need not be reproducible (metadata may vary).
- **Overflow warning (required, D11):**
  - Every PDF export counts pages from the generated PDF bytes (§3.2 step 4), never from estimated HTML height.
  - The response carries `X-Page-Count: <n>` and `X-Overflow-Warning: true|false` (true exactly when n > 1).
  - The UI shows a visible warning when the flag is true; the export still succeeds.
  - One-page fitting is not offered.
- **Order and inspection:** ordered entries and bullets must be preserved. A blank extra page, clipping or overlap found on visual inspection is a rendering defect even if text extraction passes.
- **Snapshots:** downloaded files are snapshots; later edits never change them. Saved configurations always use live shared records, not historical copies.

## 6. Interface and API contract

**Minimal UI:**

1. **Library view:** profile and education, work entries, project entries, accomplishments with wording variants and tags, skills.
2. **Resume view:**
   - the saved resume list;
   - per-section ordered entries with ordered bullets;
   - a variant selector that shows the canonical fact next to the chosen wording;
   - an ordered skill list;
   - save, remove and reorder controls;
   - preview and export buttons, plus the page-count warning.

Requirements:

- Inline errors and the affected-resume lists for conflicts and impact must be visible.
- Shared edits are visibly distinguished from local selection changes.
- Controls use accessible labels and are keyboard-operable.
- A blank state explains how to add a record.
- No drag-and-drop or rich text.

**Endpoints** (paths may change only if documented behaviour is preserved):

| Endpoint | Behaviour |
|---|---|
| `GET/PUT/PATCH /api/profile` | Read; `PUT` returns `201` when it creates the first profile and `200` when it replaces an existing one; replace (full body: `name`, optional contact fields, `education`); partial update (`PATCH`: only the keys present change, `null` clears an optional field). Impact proposals for `type: "profile"` use the `PATCH` shape |
| `GET/POST /api/experiences`, `GET/PATCH/DELETE /api/experiences/:id` | Work entries |
| `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id` | Project entries |
| `POST /api/experiences/:id/accomplishments`, `POST /api/projects/:id/accomplishments` | Create under the parent |
| `PATCH/DELETE /api/accomplishments/:id` | Update/delete |
| `POST /api/accomplishments/:id/variants`, `PATCH/DELETE /api/variants/:id` | Wording variants |
| `GET/POST /api/skills`, `PATCH/DELETE /api/skills/:id` | Skills |
| `GET /api/library` | Nested library for the editor, with usage counts |
| `POST /api/impact` | Body `{change}`; returns the `impactOf` result (read-only) |
| `GET/POST /api/resumes`, `GET/PUT/DELETE /api/resumes/:id` | List/create (a new resume is empty); read/replace name + whole configuration; delete |
| `GET /api/resumes/:id/export/json`, `/preview`, `/export/pdf` | JSON download, HTML preview, PDF download (with the page-count headers) |

Configuration `PUT` (array order is the saved order). `name` and `experiences` are required; an explicit `[]` is allowed, and omitting `experiences` is `INVALID_INPUT`, so a partial body can never silently clear the work selections. `projects` and `skills` default to `[]`:

```json
{
  "name": "Platform",
  "experiences": [{ "experienceId": "w1", "bullets": [{ "accomplishmentId": "aw2", "variantId": "vw21" }] }],
  "projects": [{ "projectId": "p1", "bullets": [{ "accomplishmentId": "ap1", "variantId": "vp11" }] }],
  "skills": ["s1", "s2"]
}
```

**Errors:**

| Status / code | When |
|---|---|
| `400 INVALID_INPUT` | Malformed requests, duplicates, wrong ownership, or an existing ID used in the wrong role or section |
| `400 INVALID_REFERENCE` | A nested ID that does not exist |
| `404 NOT_FOUND` | The addressed record does not exist |
| `409 RECORD_IN_USE` | A restricted delete |
| `409 PROFILE_REQUIRED` | Export, or profile `PATCH`, before a profile exists (FR-01a) |
| `409 CONTENT_POLICY_VIOLATION` | The rendered HTML breaks the §3.5 asset/link policy; nothing is printed |
| `500 ASSEMBLY_FAILED` / `500 RENDER_FAILED` | Internal or render failures |

- **Format:** `{ "error": { "code", "message", "affectedResumes"? } }`. `affectedResumes` appears only for `RECORD_IN_USE`.
- **Success statuses:** create `201`, read and update `200`, delete `204`.
- No stack traces in the UI.
- The server validates every input regardless of UI checks and never trusts client-supplied counts or ordinals.

## 7. Independent verification contract

The owner reviews and approves fixtures and expected results **before** an agent implements the corresponding feature. Never derive expected values from the assembler, the current output or the theme. Never use a snapshot-update command to make a failing test pass. Fixture details and status are in `fixtures/README.md`.

### 7.1 Fixtures

- `primary.input.json` (three experiences, five accomplishments, eight variants, Security and Engineering resumes), with `security.expected.json` and `engineering.expected.json`.
- `sections.input.json` (work, projects, skills, education; Platform and Data resumes), with `sections.platform.expected.json` and `sections.data.expected.json`.
- `shared-edit.input.json` (Security and Cloud share v11; Engineering uses v12).
- `overflow.input.json` (48 long bullets).
- Expected-outcome files: see §7.2.

Compare parsed JSON by deep equality, with array order significant, and validate it separately against the schema. Integration tests reload from SQLite rather than comparing in-memory objects.

### 7.2 Required cases

Each case starts from a fresh isolated database unless a sequence is stated.

| ID | Action | Independent expected result (file) |
|---|---|---|
| T01 | Assemble Security and Engineering; assemble twice; seed with shuffled row insertion order | Deep equality with `security.expected.json`/`engineering.expected.json`; identical results each time |
| T02 | Security: v11→v12, move a1 before a2, move e2 before e1 | `primary-mutations` T02; Engineering unchanged; library unchanged |
| T03 | Remove a1 from Security | `primary-mutations` T03; a1/v11/v12 still exist |
| T04 | Delete v11; delete a1 | `deletion.expected.json`; compare every stored row before and after, not only exports |
| T05 | Security switches to v12; delete v11; delete v12 | `primary-mutations` T05 |
| T06 | Delete unused v41, then a4; delete unused e3 | All 204; children removed; both exports unchanged |
| T07 | Delete e1; then delete r-security | `deletion-more` T07; then r-security deletion 204, library unchanged, Engineering export identical, r-security lookup 404 |
| T08 | Invalid configurations; one direct SQL insert of a mismatched reference | `invalid-configs.json` (T08a–i); the direct insert is rejected by a DB constraint |
| T09 | Edit v11; separately, both select v12 and edit it; an edit that normalizes to the current value | `primary-mutations` T09a/T09b/T09c, including `expectedImpact` |
| T10 | Persist the T02 configuration on a file DB, restart the server process, reassemble | Same as T02; order persists |
| T11 | Export Security JSON, preview and PDF | JSON equals expected; PDF satisfies `security.pdf.expected.json` (§7.3), including `orderedSequence`, `X-Page-Count: 1`, warning false |
| T12 | Overflow fixture JSON and PDF through the real pipeline | JSON deep-equals `overflow.expected.json`; PDF satisfies `overflow.pdf.expected.json`: ≥ 2 pages, all 48 bullets once and in order, warning true; inspect page breaks visually |
| T13 | Empty resume; then e1 with no bullets; delete e1 | `primary-mutations` T13 |
| T14 | Inject a rejecting render adapter; export | `500 RENDER_FAILED`; no file body, no DB change |
| T15 | Delete the last unreferenced variant of an accomplishment; try to select the missing variant | Delete 204; accomplishment remains as a draft; configuration rejected `INVALID_REFERENCE` |
| T16 | HTML-like wording | `text-handling.expected.json` T16 |
| T16b | Markdown-like wording (known limitation) | `text-handling.expected.json` T16b |
| T17 | Edit an experience name; edit fact/tags; edit profile name | `primary-mutations` T17a–c, including impact |
| T18 | Assemble Platform and Data | `sections.platform.expected.json`, `sections.data.expected.json` |
| T19 | Rename a shared skill; reorder skills in one resume; omit empty sections | `sections-mutations` T19a–c |
| T20 | Project, accomplishment, variant and skill deletes (blocked and allowed) | `deletion-more` T20a–h |
| T21 | Shared correction across three resumes | `shared-edit.expected.json`: before/after exports and the impact set |
| T22 | Page-count headers | The T11/T12/T23 exports carry headers consistent with each oracle's `overflowWarning` |
| T23 | Platform PDF | `sections.pdf.expected.json` |
| T24 | Invalid dates on write | `primary-mutations` T24: rejected with `INVALID_INPUT`, record unchanged; a year-only date is accepted |
| T25 | Email/URL formats, blank strings, a valid-email control, clearing with `null`; impact proposals for profile edits | `primary-mutations` T25: invalid writes rejected with `INVALID_INPUT`, record unchanged; the valid control and the `null` clear succeed with the listed exports and `expectedImpact` |
| T26 | URL/link/asset policy | `text-handling.expected.json` T26: image syntax (including the nested-bracket form) rejected on write; `javascript:`/`data:` links neutralized; `https:` link kept; an image row inserted by direct SQL makes export return `409 CONTENT_POLICY_VIOLATION` without calling the printer |
| T27 | First run without a profile | `first-run.expected.json`: fresh DB → `{"profile": null}`; a saved resume selecting e1 exports `409 PROFILE_REQUIRED`; an e1 edit proposal has impact `[]` before the profile exists and lists the resume after; the creation proposal lists the resume; the first `PUT` returns `201`, a later `PUT` `200` |

T04, T05, T07 and T20 are the critical deletion cases from the instructor feedback. T11, T12 and T23 use real rendering and extraction (no mocked PDF); T14 is deliberately mocked. A browser smoke test or recorded manual steps demonstrate:

- library creation;
- saving;
- a deletion conflict;
- the impact prompt;
- export with the overflow warning.

Unit and integration tests remain the correctness oracle.

### 7.3 PDF text, order and overflow oracle

- **Extraction:**
  - Use `pdfjs-dist` (pinned) on the actual PDF bytes, never on the HTML or JSON.
  - Call `getTextContent({ disableNormalization: true })`. pdf.js otherwise applies its own Unicode normalization (it extracts `5 µm` as `5 μm`), which would hide symbol changes from the oracle.
  - For each page, collect the non-empty text runs and sort them by position: descending y, with runs whose y values differ by ≤ 2 pt treated as one line and ordered by ascending x.
  - **Joining runs:** on the same line, append a run with **no separator** when it abuts the previous one (`|x − (prevX + prevWidth)| < 1.5 pt`), and with one space otherwise. Between lines and between pages, insert one space. Concatenate the pages in order.
    - Why: with fallback fonts (offline), Chrome emits ligatures such as `fi` as separate abutting runs, and joining every run with a space produced `fi ndings` (docs/debugging.md, Phase 0). Upstream `@repo/resume-pdf` `readPdf` uses the same adjacency rule.
  - Why position order: raw content-stream order is not reading order for Even (work highlights are emitted after later sections, EVALUATION.md E6).
- **Normalization:** replace only the Latin ligature code points U+FB00–U+FB06 (`ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ`) with their letter sequences, an extractor artefact. No other Unicode normalization is applied, so visible digits and symbols such as `²` or `①` are preserved and compared exactly. Then collapse whitespace runs, including line and page breaks, to one space, and trim. Preserve case, words and punctuation. Document any extractor-specific artefact you strip; never strip text broadly.
- **Assertions:**
  - `orderedBullets` and `orderedHeaders`: each string occurs exactly once, at increasing offsets.
  - `orderedSequence`: strictly increasing offsets of each string's single occurrence. This shows that each bullet sits under its own entry and that sections are in the theme's order.
  - `absentText` and `absentInternalText`: zero occurrences.
  - `pageCount` (exact) or `minPages`.
  - `overflowWarning`: equal to the export's warning flag.
- **Derived exclusion set (completeness):** in addition to the listed `absentText`, the test harness computes from the **input fixture** (never from application output) every library string not selected for that resume, and asserts each occurs zero times. That set is:
  - every variant text that is not a selected wording;
  - every fact;
  - every unselected entry name;
  - every unselected skill name.

  A string that happens to be a substring of a selected string is skipped, and the harness reports the skip.
- **Same-object rule:** the PDF test also asserts that the document passed to the renderer deep-equals the fixture's expected JSON. Any extra or invented bullet is then caught by JSON equality before rendering, and anything lost or added by the renderer is caught by the text checks.
- **Printed-bullet sequence check (catches bullets the renderer invents, drops, duplicates or reorders).**
  - **Where it applies:** the render adapter exposes the exact HTML string it passes to `resumed.pdf`, and the check runs on that string.
  - **Expected list:** take the text of every `<li>` element in document order (HTML-unescaped, whitespace-normalized). After the leading contact items, the list must equal exactly:
    1. the expected JSON's work highlights in order;
    2. then the project highlights in order (the theme's section order, D12).
  - **Contact items:** the leading items are Even's contact list. As a multiset, they must equal the expected document's present `basics.email`, `basics.phone` and `basics.url` values.
  - **Effect:** occurrence counts and numeric content are preserved, so an extra `42%.` or `Sample Candidate` item fails.
  - **Basis:** Even 0.27.0 renders contact items and highlights as `<li>` and skills without `<li>` (verified on the spike output, EVALUATION.md E5).
  - **Other renderers:** the fallback template F2 must render the contact values (email, phone, url) as `<li>` in one list before the entries, highlights as `<li>`, and no other content as `<li>` (§3.3). Any other theme requires an owner-approved revision of this rule.
  - **Coverage:** together with the PDF-text checks above (every expected bullet exactly once and in order in the PDF, plus the exclusion sets), this verifies the complete bullet sequence that reached the printer, and that it survived printing.
- **Approved full-text check (catches invented visible content anywhere, including outside `<li>`).**
  - **The oracle:** each PDF fixture case (T11, T12, T23) has an owner-approved file `fixtures/<case>.pdf.text.txt`. The normalized, position-ordered full text of the PDF (§7.3 extraction) must equal it exactly. Exact equality preserves counts, digits and order, so any added, dropped or changed visible text fails.
  - **Creation procedure (Phase 3, once per theme/renderer):**
    1. Generate a candidate text from the real pipeline.
    2. The owner reviews **every** segment and justifies it against the independent expected JSON. Each segment must be selected content, the theme's rendering of a selected date or field (e.g. `May 2025 – Aug 2025` for `2025-05-01`/`2025-08-01`), or theme chrome (section labels).
    3. Commit the file with an approval line naming the reviewer, the date and the renderer version.
  - **Honest limit:** this is a *reviewed golden*, an explicit, documented exception to the rule against deriving expectations from output. It is not independent in the way the hand-written JSON is; it adds change detection on top of the independent checks and never replaces them. A change of theme, renderer or Chrome major version that alters the text requires re-review, never a silent update.
- **Oracle self-test (required, kept as tests).** The oracle must fail in each of these runs:
  1. renderer input corrupted with an extra unselected library bullet (e.g. `Automated collection of access review evidence.` added to Northwind Lab for Security) — caught by the same-object rule and the exclusion set;
  2. **correct renderer input, with a test-only render adapter that inserts extra `<li>` bullets into the HTML before printing.** It is run three times, once each with `Injected novel bullet text that matches no fixture string.`, `42%.` and `Sample Candidate`. Each run is caught by the printed-bullet sequence check;
  3. correct renderer input, with a test-only adapter that inserts a novel `<p>Injected paragraph outside any list.</p>` into the HTML before printing, caught by the approved full-text check;
  4. one expected bullet dropped;
  5. two bullets swapped;
  6. **Symbol fidelity, run as independent cases:**
     - **(a) Positive control:** a PDF containing literal `µ` (U+00B5) and `²` must extract exactly as `µ` and `²`. This fails if pdf.js normalization is re-enabled, which would turn `µ` into `μ`.
     - **(b) Substitution with expected `μ` (U+03BC) and a PDF containing `µ`:** the full-text check must fail. With pdf.js normalization on, `µ` would be extracted as `μ` and this case would wrongly pass, so it detects the regression.
     - **(c) Substitution with expected `²` and a PDF containing `2`:** must fail, which detects normalization in our own code.
- **Multi-column regions** (Even's skills grid) are checked by skill names only.
- **Hard failures:** fail if extraction is unavailable, the document is empty, or the page count is invalid. Report missing, duplicated, unexpected or out-of-order text with the case ID.
- **Overflow fixture:** assemble and export through the real pipeline. Require ≥ 2 pages, never an exact count beyond that. Check every full bullet, not just the markers.
- **Limits:** visual inspection is still required for overlap, clipping and awkward breaks. Text checks do not prove ATS compatibility or perfect layout.

### 7.4 Demonstrate a check that can fail

After implementation, on a disposable branch or working copy:

1. Introduce a reversible fault, for example reverse bullet order, drop the final bullet, or skip the dependency query in `impactOf`.
2. Run the relevant check and record the failure.
3. Restore the code, rerun, and record the pass.

Never commit a known fault to the default branch. Record the actual commands and results.

### 7.5 Behavioural comparison with the starting point

The starting point (§12) renders hand-maintained JSON Resume files, one file per resume. It has no library, no wording variants, no references, no impact analysis and no restricted deletion. The full jsonresume.org platform has the same limitation: its resume "variants" are independent full copies. Verified at commit `7d482856f107515a5e7fcc6b1952c76bdab4aef8` (EVALUATION.md E12):

- correcting wording in one copy left the other copy and the base unchanged;
- removing a base entry left the copies holding it, with no warning.

Present this as a limitation relative to this workflow, not as an upstream bug.

**Repeatable check: `npm run check:baseline`** (`baseline/compare.mjs`, added after `start`). Both arms use the same initial data: the three `before` documents in `shared-edit.expected.json`. They are identical to what `shared-edit.input.json` assembles to.

- **Arm S (starting-point workflow).** This uses only the tools present at `start`: JSON files plus `resumed`.
  1. Write the three `before` documents to a temporary directory as independent files (`security.json`, `cloud.json`, `engineering.json`).
  2. Count the files whose highlights contain the old wording. This is *edits needed*: in the document workflow, each copy must be edited separately.
  3. Apply **one edit**: replace the wording in `security.json` only.
  4. Render all three with `resumed export` and extract their PDF text (§7.3).
  5. Count *stale resumes*: PDFs that still contain the old wording but were supposed to receive the correction, i.e. resumes that used v11.
- **Arm A (this application).**
  1. Seed `shared-edit.input.json` into a temporary database.
  2. Count the edits needed as `1` (one `PATCH /api/variants/v11`).
  3. Apply that edit through the API.
  4. Export all three PDFs through the application and extract their text.
  5. Count stale resumes the same way as Arm S.
  6. Additionally assert that the exports deep-equal `shared-edit.expected.json` `after`.
- **Counting rule (both arms):** let *T* be the resumes that used v11 (Security, Cloud).
  - A resume in *T* is **corrected** when its PDF contains the new wording exactly once and the old wording zero times. Otherwise it is **stale**; a missing bullet is therefore stale, not corrected.
  - Engineering is **unchanged** when its PDF contains `Built a request analysis workflow for service telemetry.` exactly once, and contains neither the old nor the new v11 wording.
- **Layout:**
  - **Arm S** is a standalone script, `baseline/arm-s.mjs`. It imports only `resumed`, the theme, `pdfjs-dist`, the fixture files, and helpers inside `baseline/`. It never imports `src/`, so it runs with the dependencies pinned at `start`. Run it with `node baseline/arm-s.mjs`.
  - **Arm A** is `baseline/arm-a.mjs`.
  - `check:baseline` runs Arm S, then Arm A.
  - Arm A prints `Arm A: UNAVAILABLE (application code not present)` and exits non-zero **only when the `src/` directory does not exist** (checked on the file system before any import).
  - In a checkout where `src/` exists, any import or runtime error is reported as a **failure** with its message, never as UNAVAILABLE.
- **Assertions on the completed app:**
  - Arm S = (edits needed 2, stale 1, Engineering unchanged true), with Security corrected. Cloud's PDF must contain the old wording **exactly once and the new wording zero times**, which shows the independent copy kept its old text (a dropped bullet fails this assertion instead of counting as stale).
  - Arm A = (1, 0, true), with Security and Cloud corrected and the exports deep-equal to `shared-edit.expected.json` `after`.
- **At `start` (pinned environment):** `npm run check:baseline:start` (script `baseline/run-at-start.sh`) does the following:
  1. `git worktree add <tmp> start`, an isolated checkout of the tagged commit.
  2. `npm ci` there, from the **lockfile at `start`**.
  3. Copy in `baseline/` from the current commit as the comparison runner. The output prints the runner's commit SHA and the `start` SHA.
  4. Run Arm S against the **fixtures at `start`**.
  5. Run Arm A, which reports UNAVAILABLE because `src/` does not exist there. That is a missing capability, a legitimate "cannot do".
  6. Remove the worktree.

  The course-guide form `git restore --source=start -- src && npm run check:baseline` remains a quick demonstration that Arm A depends on `src/`, but the pinned run above is the evidence.
- **Evidence:** the measured tables from both runs are committed as `docs/evidence/baseline.txt`.

Other comparisons:

- **B2 (T04/T20):**
  - Deleting shared content leaves stale copies in the baseline, silently.
  - Ours returns 409 with the affected list and changes nothing.
- **B3 (control, T01/T11):**
  - At the initial state, our assembled Security document deep-equals the hand-written `security.expected.json`, which is what the starting point renders.
  - Both PDFs satisfy the same oracle, so the difference is maintenance semantics, not formatting.
- **Upstream corroboration (optional for graders):** commit `baseline/upstream-variants.sh` with its recorded transcript (setup: Node 24, pnpm 8.15.9, about 5 GB). Its setup differs from Arm S: one base document plus two copies (Security, Cloud), with the correction made in Security. Report it as corroboration of copy semantics on the full platform, not as the same measurement.
- **No imitation:** do **not** build an in-app "document store" imitation of the baseline. Arm S uses the real starting-point tools on real files.

## 8. Agent work plan and acceptance gates

The human owns requirements, the data model, deletion and impact policy, expected values, and acceptance decisions; agents must not change them silently. Work one phase at a time:

1. Before editing, read SPEC.md, the README and the relevant files; summarize the plan and the affected modules.
2. After each phase, report the changed files, key choices, commands, actual results and unresolved issues.
3. Ask the owner before changing normative behaviour, adding major dependencies or broadening scope.
4. Never claim that unrun tests passed, delete user files, or overwrite independent expected outputs.
5. Commit small, reviewable changes; the owner reviews diffs before the next phase.

| Phase | Work delegated | Gate before the next phase |
|---|---|---|
| 0 — Setup (≈0.5 d) | Node 24 + Chrome configured; `npm ci`; reproduce the starting-point workflow; check offline export | `npx resumed export fixtures/security.expected.json --theme jsonresume-theme-even -o <tmp>.pdf` works online; offline it works, **or** the failure is recorded and F1 is approved for Phase 3 (§3.3); fixtures approved; `start` tag exists (§12) |
| 1 — Library & integrity (≈1.5 d) | Migrations, repositories, seed loader (v2 input format), service layer (create/edit/delete/save-configuration as functions), transactions, restricted deletion, `impactOf` for **deletes** | **Service-level** versions of T04–T08, T13, T15, T20, T24, and the write-validation steps of T25 and T26 (T25's `impact` steps and `expectedImpact` assertions are deferred to Phase 2; T26's printed-HTML and PDF steps to Phase 3): statuses become typed service errors with the same `code` and `affectedResumes`; "unchanged export" becomes "every library and selection row unchanged". DB-constraint backstop and rollback verified. No HTTP, no assembly yet |
| 2 — Assembly + HTTP API (≈1 d) | Pure validation/resolution, mapping, schema validation, `impactOf` for **edits** (defined on assembled JSON, FR-04); all §6 endpoints except `/preview` and `/export/pdf` | T01–T03, T09 (including T09c), T10, T13, T17–T19, T21 and T25's impact steps on exact expected objects, including every `expectedImpact`; T27; the **HTTP** versions of T04–T08, T13, T15, T20, T24, T25 (status codes, error bodies, unchanged JSON exports) |
| 3 — Render & export (≈1 d) | `resumed` adapter (exposing the printed HTML), `/preview` and `/export/pdf` endpoints, PDF page count, headers, failure path, PDF oracle utilities including the printed-bullet sequence check, the approved full-text files (owner review) and the self-tests; T26 printed-HTML/PDF steps | T11, T12, T14, T16, T16b, T22, T23 pass; output inspected visually; any fallback documented |
| 4 — UI (≈1.5 d) | Library editor, configuration builder, impact/conflict display, preview/export/warning | Clean-start manual workflow works; shared vs local distinctions visible |
| 5 — Delivery (≈1 d) | Full check run; `npm run check:baseline`; planted-fault demo; README/THIRD_PARTY; slide PDF; rehearsal | Fresh-clone procedure works; the slide PDF is exported; every file the slides cite passes `git ls-files --error-unmatch PATH` at the cited commit; owner can explain the decisions and the debugging story. **Owner handoff (not agent actions):** repository pushed with instructor and TA access (or public); repository URL and slide PDF submitted together in Canvas before the deadline (no late window); live demo slot booked |

If time runs short, these are the candidate cuts, in order. **A cut build counts as complete only after the owner approves a spec and fixture revision that applies the listed changes; an agent never cuts on its own.**

| Cut | Requirements and cases it changes |
|---|---|
| 1. Shared-edit confirmation modal → show the impact list without blocking the save | FR-01's confirmation sentence becomes "shows the affected resumes"; tests unchanged (impact is tested via `impactOf`/`POST /api/impact`) |
| 2. Tag display in the library | FR-01's "tags are shown"; no test changes |
| 3. Education editing UI → education edited only through seed JSON / `PUT /api/profile` | FR-01 UI scope only; API and tests unchanged |
| 4. HTML preview → JSON and PDF export only | FR-06 preview bullet, §6 `/preview`, T11's preview step, demo step 6 |

**Never cut:** restricted deletion, impact analysis, two or more saved resumes, the T21 comparison, the real-PDF oracles, the overflow warning.

## 9. Commands and delivery requirements

Document commands that actually work on a fresh clone. Target contract:

```sh
nvm use                                   # or any Node 24 install; see README
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS example
npm run demo:seed -- --reset             # synthetic demo DB at ./.demo/demo.sqlite only
npm run demo                              # local UI + API on 127.0.0.1 using ./.demo/demo.sqlite
npm run dev                               # local UI + API on the personal DB (DB_PATH or ./.data/library.sqlite)
npm run check                             # typecheck + unit + integration + real PDF tests
npm run check:baseline                    # §7.5 comparison
```

- **Demo seed composition:** `demo:seed` loads `fixtures/primary.input.json` and `fixtures/overflow.input.json` into one database. Their IDs are disjoint, and their profiles are identical, which the loader asserts and fails on mismatch. This provides Security, Engineering and Overflow for §10. With `--with-sections`, it also loads `sections.input.json`, and the profile is then taken from that file (adding `label` and education). Demo exports are not test oracles.
- **Database separation:**
  - `demo:seed` and `demo` always use the fixed path `./.demo/demo.sqlite` and **ignore `DB_PATH`**.
  - **Demo location validation** (run by `demo:seed` and `demo` before any open or write):
    1. Let `R = realpath(repository root)`.
    2. If `R/.demo` does not exist, create it with `mkdir` (mode 0700). If it exists, `lstat` must report a real directory, **not a symlink**; otherwise refuse.
    3. `realpath(R/.demo)` must equal `R/.demo`; this also rejects a symlinked ancestor inside the repository.
    4. If `R/.demo/demo.sqlite` exists, `lstat` must report a regular file, not a symlink, with link count 1; otherwise refuse. On a fresh clone the file does not exist yet, and seeding creates it.
    5. `demo:seed` refuses to overwrite an existing file without `--reset`.
  - **Personal default directory:** when `DB_PATH` is **unset**, personal mode first validates `R/.data`.
    - If it is absent, it is created with mode 0700.
    - If it exists, `lstat` must report a real directory, not a symlink.
    - When `DB_PATH` **is set**, a missing parent directory is never created; the command refuses to start with a clear error.
  - **Personal mode reserves `.demo/`:** `dev` and every non-demo command resolve `DB_PATH` (default `./.data/library.sqlite`), after the directory step above, as follows:
    1. `lstat(DB_PATH)`.
    2. If it exists (a file, or a symlink at any depth), the resolved target is `realpath(DB_PATH)`, which follows every symlink including the final component.
    3. If `lstat` reports a symlink whose target does not exist (dangling), refuse.
    4. If nothing exists at `DB_PATH`, the resolved target is `realpath(dirname(DB_PATH)) + "/" + basename(DB_PATH)`.

    The command refuses to start if the resolved target is `R/.demo` or anything under it. A personal database can therefore never be, or alias, the demo reset target.
  - Test commands use temporary directories only.
- **Required isolation tests:**
  1. Create a personal database, run `demo:seed -- --reset`, and assert the personal file's bytes are unchanged.
  2. `DB_PATH=./.demo/demo.sqlite npm run dev` (and an equivalent path such as `./.demo/../.demo/demo.sqlite`) is refused with a clear error.
  3. If `.demo/demo.sqlite` is a symlink to a file outside `.demo/`, `demo:seed -- --reset` is refused and the target's bytes are unchanged.
  4. If `.demo/` itself is a symlink to a directory holding a personal `demo.sqlite`, `demo:seed -- --reset` is refused and that database's bytes are unchanged.
  5. On a fresh clone (no `.demo/`), `demo:seed` creates `.demo/` and the database, and a subsequent `demo` starts.
  6. `DB_PATH` is a symlink located outside `.demo/` that points to `.demo/demo.sqlite`: `dev` refuses to start. A dangling `DB_PATH` symlink is also refused.
  7. On a fresh clone with no `.data/` and no `DB_PATH`, `npm run dev` starts and creates `.data/library.sqlite`. If `.data` is a symlink, it refuses.
- Both directories are gitignored.

- `npm run check` exits nonzero on any required failure. It never skips PDF assertions silently; a missing browser is a failure with a clear message.
- The README gives: host and port, Node version, browser setup (macOS and Linux notes), reset and demo steps, the expected test cases, and known limitations.
- **Never commit:** secrets, real resumes, course homework material, or course reference documents.
- **Gitignore:** databases, generated PDFs, environment files, build output.
- **Do commit:** small synthetic fixtures and any evidence the slides cite.

## 10. Live demonstration (about 20 minutes)

Start from the synthetic seed and a clean, known state, then:

1. Add an entry, an accomplishment and a variant in the UI.
2. Show Security and Engineering (or Platform and Data) built from the same library with different wording and order.
3. Save a Security-only change and show that Engineering is unchanged.
4. Edit a shared variant and show the impact list naming exactly the affected resumes.
5. Try to delete a referenced variant and accomplishment; show the affected resumes and the unchanged state. Replace the reference, then delete the now-unused variant.
6. Export JSON and PDF; show the overflow fixture with its warning.
7. Run the test command and show an expected-output file.
8. Show the baseline comparison (B1) and one limitation, for example Markdown interpretation (T16b), no history, or last-write-wins across tabs.

Run it live, not as a video.

## 11. Course evidence and final slide deck

The slide deck is the writeup; this spec is an implementation artifact. Evidence files:

- **`docs/decisions.md`:** candidate decisions, each with the alternative, the prompt, the diff/commit, the input, the command, the result and the response:
  1. restrict vs cascade vs placeholder on deletion;
  2. position-ordered PDF extraction vs stream order vs visual-only checking (spike evidence: EVALUATION.md E4/E6; re-run inside the repo);
  3. selective reuse vs forking jsonresume.org (E11/E12).
- **`docs/agent-log.md`:** phase, human instruction, agent work, review and actual test results. Credit agent assistance; do not invent contributors.
- **`docs/debugging.md`:** one real bug: symptom, diagnosis and ruled-out causes, fix commit, failing and passing check. Do not manufacture it from the planted-fault demo.
- **`README.md`:** the starting point and `start` tag, contributions, run commands, credits, changes from the proposal, limitations, and evidence pointers.

Six-slide plan:

1. Project, user, demo, repo and commit.
2. Starting point vs our components; agent roles.
3. Deletion decision.
4. PDF evaluation decision.
5. Debugging story.
6. Limitation and next check.

Make sure every cited file is tracked by Git.

## 12. Starting point and third-party code

**Starting point:** commit tagged `start`. It contains only:

- planning documents (this spec, EVALUATION.md, fixtures, README, THIRD_PARTY.md);
- `package.json`/`package-lock.json` pinning the third-party packages below;
- `.nvmrc` and `.gitignore`.

It contains **no application code**. The workflow it supports is the JSON Resume one-file-per-resume workflow:

```sh
npx resumed export fixtures/security.expected.json --theme jsonresume-theme-even -o security.pdf
```

Everything after `start` is project work, and `git diff --stat start..main` shows it. Code written before `start` (including spike code in `../experiments`, which is not in this repo) counts as starting point. Any third-party file later copied into the repo goes under `src/render/vendor/`, with a header giving source URL, commit and licence, and is listed in THIRD_PARTY.md.

**Third-party packages (credited, not original work):**

| Package | Version | Licence | Source | Role |
|---|---|---|---|---|
| `resumed` | 7.1.0 | MIT | https://github.com/rbardini/resumed | JSON Resume → HTML (`render`) and → PDF (`pdf`, via Puppeteer) |
| `jsonresume-theme-even` | 0.27.0 | MIT | https://github.com/rbardini/jsonresume-theme-even | HTML theme |
| `@jsonresume/schema` | 1.11.0 | MIT | https://github.com/jsonresume/jsonresume.org/tree/master/packages/schema | Schema and validator |
| `puppeteer` | 25.18.1 | Apache-2.0 | https://github.com/puppeteer/puppeteer | Headless Chrome driver used by `resumed.pdf` |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | https://github.com/mozilla/pdf.js | PDF text extraction and page count |

Application dependencies added later (React, Vite, the HTTP server, Vitest, TypeScript) are recorded in THIRD_PARTY.md when they are added. jsonresume.org itself (`7d482856…`, MIT) is a reference and the baseline only; none of its code is included.

## 13. Sources

- `references/Final Project Proposal.pdf` (pp. 2–3) and `references/948_final_project_guide-slides (2).pdf` (slides 2–4, 6–9, 11–18). These are outside the repository and must not be copied in.
- `EVALUATION.md`: upstream investigation, experiments E1–E13, alternatives, and decisions.
- JSON Resume schema 1.11.0 `SPEC.md` / `DECISIONS.md` (inline Markdown, #600; deprecated `projects.description`, #296; entry skill references, #313).
- resumed: https://github.com/rbardini/resumed · Even: https://github.com/rbardini/jsonresume-theme-even
