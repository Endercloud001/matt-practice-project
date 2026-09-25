# Dashboard integration verification

Date: 2026-09-26, Asia/Shanghai. Review base: remote `dev` at `f42ab9e`. PR #11 merged into the integration branch at `057ed22`; its tree was verified identical to accepted head `3dd9000`. Follow-up fixes are on `codex/dashboard-integration-review` in the existing Issue #8 worktree.

## Review and fixes

The `code-review` Standards and Spec axes independently reviewed the complete #3–#8 diff, then reviewed the follow-up working changes.

- Standards: fixed the purchase test helper's two positional number parameters and all 14 callers. No unresolved hard violations. Duplicated authorization predicates remain a nonblocking future consideration; no broader refactor.
- Spec: fixed Admin instructor changes retaining old course options by submitting the new instructor scope with a cleared course and no pagination, preserving dates.
- Spec: course summaries now reuse compact metric cards with visible empty/unavailable/error reasons, isolated Retry, Updating, and one shared announcement region. Per-course IDs distinguish summary metrics from overview cards.
- Spec: quiz-count retries no longer require attempts; participant-count retries no longer require scores. Authorization and period filters remain in the existing transaction/service.

Two new real-SQLite tests and an enhanced rendered-page test failed before the fixes (3 failures). After fixes, all 60 targeted tests passed. The Admin browser probe failed before the fix because changing instructor did not navigate; after the fix it refreshed the course options and preserved the date preset.

## Fresh automated verification

- `pnpm test`: 28 files, **472 tests passed** at 01:10 Asia/Shanghai.
- `pnpm typecheck`: passed after that full run.
- Explicit changed-file Prettier check and `git diff --check`: passed. An earlier PowerShell array invocation was rejected as one combined filename; the corrected explicit-file invocation passed.
- `pnpm build`: passed. Existing source-map and unused-import warnings from unrelated modules remain; they did not fail the build.
- Tests use migrated in-memory SQLite. No application database reseed or schema migration was introduced.

## Fresh browser verification

Headless Chromium against the existing isolated local database, desktop and 390px:

- Course quiz panel matched an independent SQLite calculation: 47.5% best-attempt quiz average, 2 participating students, 2 quizzes. A future period rendered empty attempts rather than 0.0%.
- Admin changing instructor refreshed eligible course options, cleared course selection, and retained Last 30 days.
- A temporary `lesson_progress` rename exposed visible summary failure text and Retry. The table name was restored before retry; recovery sent one request for course 3/studentProgress, updated only that summary metric, and retained sibling values and observation semantics.
- Pending summary retry and filter navigation showed Updating; one live region announced refresh and retained observation times. Mobile summaries stayed stacked without document overflow.
- Repeated Issue #8 browser regression covered 20-row pagination, date reset/preservation, unauthorized and transitioning-scope PII removal, viewport-triggered overflow hints, sticky Name, keyboard scrolling and visible focus.
- No page errors occurred in completed browser runs. Desktop course and mobile summary screenshots were visually inspected.

One summary test run stalled because its browser URL matcher omitted React Router's `.data` suffix. The probe was corrected and rerun successfully; this was a test-harness issue, not a production fix. Temporary database table renaming was verified restored. No session files are included in this commit.

Local scripts, logs, reports and synthetic-data screenshots: `E:/analytics-worktrees/dashboard-delivery-acceptance/`. The earlier authentication state stays in the existing local acceptance directory and must not be uploaded.

## Human acceptance still required

The earlier #6 acceptance includes screen-reader behavior; #8 has user-confirmed human acceptance without a separate listening record. #2/#4/#5 records explicitly exclude listening. #7 now has additional automated browser coverage, not a claim of human listening. The current changes to instructor cascading and summary recovery require a focused human check before final integration.

The local server is at `http://127.0.0.1:4178`; use the existing email-only local login. Instructor: `sarah.chen@ralph.dev`; Admin: `alex.rivera@ralph.dev` (confirmed in the local fixture).

1. Admin overview: use the Instructor control with keyboard and your screen reader. Change instructor; confirm refreshed course choices, date preservation, a comprehensible update announcement, and usable focus after navigation. Report if automatic submission makes choosing an instructor difficult.
2. Instructor overview: read the five KPIs and course summaries. Confirm missing-data explanations are audible and visible, and summary heading structure is understandable. At 390px, summaries remain vertically stacked.
3. Course 3: review Course learning outcomes and Student snapshots. Confirm heading navigation, labels, pagination destination labels, disabled controls, and one coherent loading/refresh announcement. Check horizontal keyboard scrolling and sticky Name on mobile.
4. Error/Retry listening needs a controlled local fault. Ask the agent to prepare it when you are ready; do not run the database seed. The agent restores the fixture and remains available while you activate Retry and listen for the target metric/observation announcement.

Record browser/screen-reader versions, pass/fail for each item and any observed defect. Do not convert automated structure checks into a listening claim. If the prototype's historical listening requirement is still needed for its separate closure, decide that explicitly; production acceptance does not retroactively change its record.

## Delivery boundary

The local follow-up commit and integration PR draft are reviewable. Publishing these new fixes, creating/merging the final integration PR, closing remaining Issues or the parent Spec, and deleting branches/worktrees are not claimed complete. The explicit authorization completed in this session was metadata synchronization and merging PR #11 into the integration branch.
