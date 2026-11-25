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

## Phase 3 — render and export (2026-11-24)

- **Renderer:** the default pipeline (`resumed.render` + Even 0.27.0, `resumed.pdf` + Puppeteer 25.18.1 + Chrome 158.0.8127.37). No fallback was needed. `src/render/adapter.ts` puts it behind `renderHtml` / `renderPdf`. Tests may replace the backend, but the §3.5 content policy always runs.
- **Exposing the printed HTML:** `renderPdf` returns `{ bytes, pageCount, printedHtml }`, where `printedHtml` is the exact string passed to `resumed.pdf`. Neither route sends it to the client. This extends the §3.2 step 5 signature and was approved with the Phase 3 plan.
- **Runtime policy, beyond the §3.5 list:**
  - The document is parsed twice, once with scripting on (as the printer sees it) and once with it off (as the sandboxed preview sees it), because the two parse `<noscript>` content differently and neither covers the other.
  - A non-empty, non-fragment `href` on any element other than `<a>` and `<link>` is refused. This covers `<base>`, `<area>`, and SVG `<image>`/`<use>`, which is how we enforce §3.5's "inline `<svg>` without external references".
  - Not checked: CSS `url()` in `<style>` or `style` attributes. User text cannot produce markup, because the theme escapes it (T16), so this would only matter for theme-authored CSS.
- **Even's `<script type="module">`:** it defines `<time-duration>`, which computes a duration from `Date.now()`. Even's own stylesheet hides it when printing (`@media print { time-duration { display: none } }`), and open-ended entries print a static "Present". So the PDF text, and with it the full-text goldens, does not drift with the date. In the preview the CSP blocks the script, so durations are absent on screen too.
- **Skill `level`:** Even does not print it (Platform: `SQL`, level `Intermediate`). This is theme behaviour that FR-04 already anticipates.
- **Printed-bullet check revised (D18, owner-approved):** Even 0.27.0 renders each skill **keyword** as an `<li>` (`ul.tag-list`). That contradicts §7.3's old basis, which said skills have no `<li>`, so T23 failed under the rule as written. The expected `<li>` list now ends with the skill keywords, skill by skill. The alternative of skipping Even's keyword lists was rejected because an item injected into one would go undetected. Code: `6b6e5a1`; SPEC §3.3, §7.3 and D18 updated to match.
- **Known defect, not fixed:** `resumed.pdf` has no `try/finally` around `browser.close()`. If `setContent` or `pdf` throws (for example after a 30 s navigation timeout), the Chrome process stays alive until the server exits. The request itself still returns `500 RENDER_FAILED`.
