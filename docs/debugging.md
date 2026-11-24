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
- **Fix:** SPEC §7.3 now specifies that runs abutting on the same line (gap < 1.5 pt) are joined with no separator, other runs with one space, and Latin ligature code points (U+FB00–U+FB06) are expanded. This matches upstream `@repo/resume-pdf` `readPdf` for joining. Normalization is deliberately limited to the ligatures; a Codex review (Phase 1) noted that full NFKC would fold visible symbols such as `²` into `2`.
- **Check:** with the adjacency rule, `security.pdf` (online), `security-offline.pdf` and `overflow-offline.pdf` all pass their oracles. The regression test belongs to Phase 3, which implements the extractor: one offline fixture must pass, and a deliberately space-joined variant of the extractor must fail on it.

## 2. Two concurrent demo seeds were both refused (intermittent) — Phase 2 review, 2026-11-24

- **Symptom:** the command test "exactly one of two concurrent first seeds succeeds" passed on its first run, then failed in 2 of 5 reruns with exit codes `[2, 2]`. Both seeds reported "the demo database is in use".
- **Narrowing it down:**
  - Running the two seeds by hand in a shell succeeded once (`[0, 2]`), so the publish logic was not at fault.
  - A race in creating `.demo/` (both processes seeing it absent) was real, and was fixed by tolerating `EEXIST`, but the test still failed intermittently.
  - The captured stderr showed **both** processes failing at lock acquisition, never at mkdir.
  - Cause: the lock is an exclusive SQLite transaction on a fresh `lock.sqlite`. Two processes can both take SHARED, then both fail to upgrade, because each sees the other as busy and `timeout: 0` gives up immediately. It is SQLite's lock-upgrade deadlock avoidance, so neither process wins.
- **Fix:** `acquireDemoLock` retries for up to about 1 s with 10–50 ms random backoff, so one process wins; a lock that is genuinely held (a running demo server) still refuses. Commit: see the "Phase 2 review round 3" commit.
- **Check:** the concurrency test passed 8 of 8 consecutive reruns (previously 3 of 5). Removing the lock entirely fails 4 tests.
