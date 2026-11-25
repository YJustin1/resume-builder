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
- **Chrome left running after a failed print (D20, fixed):**
  - `resumed.pdf` has no `try/finally` around `browser.close()`.
  - Reproduced: a stylesheet request that never answers made the export fail after 30 s with "Navigation timeout". It left 7 headless Chrome processes, and they kept Node from exiting.
  - Fix: `resumed.pdf` is given `moduleName` pointing at `src/render/puppeteer-tracked.ts`. That module calls the real `puppeteer.launch`, records each browser in an `AsyncLocalStorage` print session, and sets the session timeout (15 s) on launch and on every page. The adapter closes every recorded browser in a `finally`. `resumed.pdf` still does the printing.
  - The session store lives on a `globalThis` symbol: `resumed` imports the wrapper natively while vitest loads the adapter through its own module graph, and a module-local store lost the tracking (planted fault).
  - Test `tests/phase3/print-cleanup.test.ts`: a local proxy that accepts `CONNECT` and never answers stands in for a black-holed `fonts.googleapis.com`. The real Security export over HTTP must return `500 RENDER_FAILED` within the timeout, with the browser process gone; a successful print must close its browser too.
  - Planted faults: no close, no page timeout, and a module-local store each fail the test. The test passed 6 of 6 reruns.
- **Page margins and unbroken bullets (D19, owner-approved after visual inspection):**
  - The owner found that Overflow's continuation pages started too close to the top edge. Even sets no page margins and Puppeteer defaults to 0.
  - Three variants were compared:
    - (A) Puppeteer margins left a white strip above Even's grey header on page 1;
    - (B) CSS `@page` margins with none on page 1 kept the header flush, but split Case 10 across pages, showing that the old unsplit output was luck;
    - (C) B plus `li { break-inside: avoid }` was chosen.
  - The adapter injects it before `</head>`, so preview and print get the same HTML. Overflow is still 4 pages; Security and Platform still 1 page each; the approved goldens are unchanged.
  - New checks: no text baseline inside the 36 pt margins (top of pages 2+, bottom of every page), and every highlight whole on one page.
  - Planted faults: removing the stylesheet fails the margin check (text at 780 pt), and removing only the keep-together rule fails the split check (Case 10).

## Phase 3 Codex review (session `rb-phase3-code`)

**Round 1:** 3 blockers, 2 improvements, all addressed.

1. **Phone number blocked export (BLOCKER).**
   - Even renders `basics.phone` as `<a href="tel:…">`, and the runtime policy refused it: any saved phone made preview and PDF export return `409`.
   - The same applied to `irc:`/`ircs:`/`xmpp:` links in bullets, which micromark keeps.
   - Fix: `neutralizeLinks` (src/render/policy.ts) blanks every `<a href>` outside http/https/mailto to `href=""`, splicing only that attribute by its parse5 source position, before the policy check. This is SPEC §3.5 rule 3 ("must be neutralized"), now worded to say which layer does it. The phone prints as text and is no longer a clickable `tel:` link.
   - While checking this: Even prints `basics.url` without its scheme and trailing slash, so the printed-bullet contact multiset now compares the URL in that display form (a theme formatting rule, like dates).
   - Tests: `tests/phase3/contacts-links.test.ts` (API: phone and url in preview and PDF; a bullet with irc/xmpp links) and unit tests in render.test.ts.
2. **Font wait escaped the D20 timeout (BLOCKER).** `resumed.pdf` awaits `page.evaluate(() => document.fonts.ready)`, which only the CDP `protocolTimeout` (default 180 s) bounds. The launch wrapper now sets `protocolTimeout` to the session timeout. Regression: a page whose font load starts after `load` and never finishes must fail within the timeout, not with a navigation timeout, and must leave no Chrome.
3. **A missing golden left the gate green (BLOCKER).** `readGolden` now throws with the missing path, and the PDF gate and self-test 3 always run the full-text check.
4. **Line order depended on content-stream order (IMPROVE).** The pairwise same-line comparator was not transitive. `groupLines` now sorts by baseline, groups against each line's first baseline, then sorts by x. A permutation test covers it; the approved goldens are unchanged.
5. **Candidate generator could overwrite approved goldens (IMPROVE).** It compares real paths against the actual fixture directory, and writes with `wx`.

Planted faults: removing neutralization, `protocolTimeout`, the new sort, or the Security golden each fails tests; the generator refuses a symlink to `fixtures/` and an existing file.

**Round 2:** no regressions in the round-1 fixes; 1 new blocker.

6. **Markdown could erase a selected bullet (BLOCKER).**
   - Variant text such as `[RFC]: https://example.com/spec` saved with `200`, but micromark reads the whole line as a reference definition, so the bullet printed empty.
   - Probing micromark found the same for `---`/`***`/`___`, a bare code fence, `*`, `[]()` and `&nbsp;`.
   - Fix (D21, pending owner approval):
     - `markdownText` (src/core/fields.ts) rejects variant text whose micromark rendering has no visible text, with `400 INVALID_INPUT` and an explanation;
     - the render adapter refuses such a stored highlight with `500 RENDER_FAILED` naming it, before rendering, so nothing is printed.
   - Only variant text is checked, because it is the only exported field Even renders as Markdown for our documents. Names and positions print literally.
   - Tests: `tests/phase3/empty-markdown.test.ts`. Planted faults: removing either check fails it.

**Round 3 (the cap):** 2 blockers in the round-2 fix, both fixed, but **not verified by Codex** (no fourth round), plus 1 premise blocker for the owner.

7. **Zero-width text still erased a bullet (BLOCKER).** `&ZeroWidthSpace;` and `&#x200B;` decode to U+200B, which the check treated as visible. `rendersNoText` now also ignores `\p{Default_Ignorable_Code_Point}`, which covers soft hyphen and zero-width characters. Tests cover both spellings on write and a stored row at render time.
8. **An image-only bullet returned the wrong error (BLOCKER).** The empty-text backstop ran before the content policy, so a stored `![x](…)` gave `500 RENDER_FAILED` instead of §3.5's `409 CONTENT_POLICY_VIOLATION`. The backstop now runs after the policy. Regression: image-only direct-SQL row → 409 naming `<img>`, printer never invoked.
9. **D21 needs owner approval (PREMISE BLOCKER).** The write restriction narrows inputs the previous contract accepted; SPEC §8 requires owner approval. Awaiting the owner.

Planted faults: counting zero-width characters as visible fails 7 tests; running the backstop before the policy fails 1.
