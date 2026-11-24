# Decisions and evidence

Each entry records the choice, the alternative, the change (commit), the check (input, command, result) and the response. Planning decisions made before implementation are in SPEC.md §0 and EVALUATION.md.

## Phase 0 — setup and offline gate (2026-11-24)

- **Environment:** macOS 15.7 arm64; Node v24.22.3 (fnm); npm 11.19.1; Google Chrome 158.0.8127.37 via `PUPPETEER_EXECUTABLE_PATH`.
- **Install:** `PUPPETEER_SKIP_DOWNLOAD=1 npm ci`. npm 11 reports that Puppeteer's `postinstall` was not run (`npm warn install-scripts`). This is intended: that script only downloads a browser.
- **Online gate:** `npx resumed export fixtures/security.expected.json --theme jsonresume-theme-even -o out/security.pdf` succeeded.
- **Offline gate:**
  - `resumed export` exposes no network switch, but it forwards Chrome flags. Offline is simulated with a dead proxy:
    `npx resumed export fixtures/<name>.expected.json --theme jsonresume-theme-even -o out/<name>-offline.pdf --puppeteer-arg=--proxy-server=127.0.0.1:9 --puppeteer-arg=--proxy-bypass-list='<-loopback>'`
  - Both exports succeeded (0.68 s and 0.61 s), producing 1 page (security) and 4 pages (overflow).
  - Both PDFs pass the fixture oracles (`orderedSequence`/`orderedBullets`, `absentText`, `absentInternalText`) once runs are joined by the rule now in SPEC §7.3. Before that fix they failed (see docs/debugging.md).
- **Result:** the Phase 0 gate passes with the default renderer, so F1 is not needed. The dead-proxy flag gives the Phase 3 tests a reproducible offline mode through `resumed` itself.
