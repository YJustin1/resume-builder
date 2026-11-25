# Reusable Resume Builder

A local, single-user resume builder. You keep **one library** of work experiences, projects, accomplishments, several **wording variants** per accomplishment, and skills. Each role-specific resume is a saved **configuration** that references library records rather than copying their text. Correcting a shared wording therefore updates every resume that uses it. Deleting a record that a saved resume still uses is blocked, and the affected resumes are listed. Exports are standard [JSON Resume](https://jsonresume.org) documents, rendered to HTML and PDF with reused third-party software.

**Status:** Phases 0–4 done (library and integrity rules, assembly and HTTP API, rendering and export, UI). Phase 5 (delivery) is next; see [SPEC.md](SPEC.md) §8 and [docs/agent-log.md](docs/agent-log.md).

## Run the app

Requirements: Node.js 24 (`.nvmrc`) and Google Chrome (tested on macOS 15 with Chrome 158).

```sh
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
npm run demo:seed -- --reset   # synthetic demo database at .demo/demo.sqlite (Security, Engineering, Overflow)
npm run demo                   # builds the UI; UI + API on http://127.0.0.1:5174 with the demo database
npm run dev                    # UI with live reload on http://127.0.0.1:5173 (API on 5174), personal database
npm run check                  # typecheck + all tests, including real PDF rendering and a browser smoke test
```

The personal database is `.data/library.sqlite` unless `DB_PATH` is set. Everything binds to `127.0.0.1` only.


## Starting point (third-party code)

The project starts from the JSON Resume ecosystem's **one-file-per-resume workflow**: a hand-maintained `resume.json` rendered by [`resumed`](https://github.com/rbardini/resumed) with the [Even theme](https://github.com/rbardini/jsonresume-theme-even) and validated by [`@jsonresume/schema`](https://github.com/jsonresume/jsonresume.org/tree/master/packages/schema).

- **Tag:** `start`. At this commit the repository holds only documents, synthetic fixtures and the pinned dependency manifest; there is **no application code**.
- **What is third-party:** every package in `package.json` and its lockfile. Versions, licences, sources and roles are in [THIRD_PARTY.md](THIRD_PARTY.md).
- **What we build:** everything in `git diff --stat start..main`. These are the shared library and integrity rules, the impact analysis and resume assembler, the export pipeline around `resumed`, and the UI ([SPEC.md](SPEC.md) §2).
- **What the starting point cannot do:** keep shared content consistent across resumes. Each resume is an independent document, so correcting a wording in one leaves the others stale, and nothing prevents deleting content other resumes depend on. The full jsonresume.org platform behaves the same way: its resume "variants" are independent copies ([EVALUATION.md](EVALUATION.md) E12). SPEC.md §7.5 defines the repeatable comparison.

### Run the starting-point workflow

Requirements: Node.js 24 (`.nvmrc`) and Google Chrome.

```sh
PUPPETEER_SKIP_DOWNLOAD=1 npm ci
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"   # macOS
mkdir -p out
npx resumed validate fixtures/security.expected.json
npx resumed export fixtures/security.expected.json --theme jsonresume-theme-even -o out/security.pdf
```

`PUPPETEER_SKIP_DOWNLOAD=1` stops Puppeteer from downloading its own browser into a user-level cache. Without a local Chrome, run `npx puppeteer browsers install chrome` instead (a user-level download of a few hundred MB).

## Documents

- [SPEC.md](SPEC.md): the implementation contract (v2): decisions, components, data model, behaviour, API, verification cases, phases.
- [EVALUATION.md](EVALUATION.md): the investigation of JSON Resume, the feasibility experiments and the architecture decision.
- [fixtures/README.md](fixtures/README.md): the synthetic test fixtures and their approval status.
- [THIRD_PARTY.md](THIRD_PARTY.md): reused software and attribution.

## Data policy

The repository holds synthetic data only. Personal databases (`.data/`), demo databases (`.demo/`) and generated exports (`out/`) are gitignored. No course homework or course reference material is included.
