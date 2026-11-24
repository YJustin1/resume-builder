# Debugging log

Real bugs only, each with symptom, cause (including what was ruled out), fix, and check. One of these becomes the slide-deck debugging story.

## 1. Offline PDFs failed the text oracle ("fi ndings") — Phase 0, 2026-11-24

- **Symptom:** the offline gate exported `security.expected.json` and `overflow.expected.json` without errors, but a text check reported `Documented access review findings for the team.` and all 48 overflow bullets as missing. The same check on the online export passed.
- **Narrowing it down:**
  - The online PDF passed with the identical check script, so the script logic and the fixtures were not at fault.
  - Joining the runs exactly as pdf.js emits them (adding a newline only at `hasEOL`) found the bullet; joining every run with a space did not. The text was therefore present, and the fault lay in how runs were joined.
  - Dumping the run geometry showed the offline PDF splits `findings` into the runs `"Documented access review"`, `" "`, `"fi"`, `"ndings for the team."`. The `fi` run ends at x = 337.5 and the next run starts at x = 337.6, so they abut.
  - Cause: offline, Chrome falls back from the Lato web font to a local font that renders the `fi` ligature as a separate run.
  - Ruled out: missing text, reordering, and page breaks (the bullets are on one line).
- **Fix:** SPEC §7.3 now specifies that runs abutting on the same line (gap < 1.5 pt) are joined with no separator, other runs with one space, and the text is NFKC-normalized. This matches upstream `@repo/resume-pdf` `readPdf`.
- **Check:** with the adjacency rule, `security.pdf` (online), `security-offline.pdf` and `overflow-offline.pdf` all pass their oracles. The regression test belongs to Phase 3, which implements the extractor: one offline fixture must pass, and a deliberately space-joined variant of the extractor must fail on it.
