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

## Human acceptance update — 2026-09-26

The user confirmed the visible course-summary Retry behavior: the target course/metric refreshed, the explanation was visible, and other metrics did not refresh. Their supplied screenshot shows Student Snapshot Acceptance progress at 49%. This passes the visual/functional portion of item 4 below.

The local observer independently recorded HTTP 200, the target progress at 49%, unchanged sibling content, and one live region. Its text stated that the target metric refreshed and other metrics retain their earlier observation times. The database source had been restored before the user clicked Retry; a browser-only two-second delay made the pending state observable.

The user subsequently confirmed using a screen reader, hearing both the pending and completed announcements, and encountering no speech or operation problems. Item 4 passed for visual behavior and screen-reader listening. The user then explicitly confirmed items 1–3 had no problems, completing all four current integration acceptance items on 2026-09-26 (Asia/Shanghai). Screen-reader name/version was not supplied; this is an evidence detail, not an additional acceptance blocker. Local observer evidence: `E:/analytics-worktrees/dashboard-delivery-acceptance/manual-summary-retry-state.json`. User screenshot: `codex-clipboard-81ec796d-5322-4e7e-9abf-f1f7137e9fb2.png` (retained with local acceptance evidence).

## Completed human acceptance

All four items below passed by explicit user confirmation. This provides current integration acceptance for the overview, instructor cascade, course outcomes/student table and summary recovery. Earlier records retain their original scope and date: the new acceptance does not claim listening happened during those earlier runs or retroactively accept the separate prototype.

The local server is at `http://127.0.0.1:4178`; use the existing email-only local login. Instructor: `sarah.chen@ralph.dev`; Admin: `alex.rivera@ralph.dev` (confirmed in the local fixture).

1. **Passed — Admin overview:** instructor changes, refreshed course choices, date preservation, update announcements and keyboard/focus operation.
2. **Passed — Instructor overview:** five KPIs and course summaries, visible/audible missing-data explanations, understandable headings and vertically stacked mobile summaries.
3. **Passed — Course outcomes and student snapshots:** heading navigation, labels, pagination destinations, disabled controls, loading/refresh announcements, horizontal keyboard scrolling and mobile sticky Name.
4. **Passed — summary Retry:** the user confirmed target-only recovery, visible explanation, audible pending/completed announcements, and no speech or operation problems. The data source was restored before Retry. No further fault injection is needed for this accepted scenario.

The acceptance above is based on the user's confirmations, separately from automated checks. The prototype's historical evidence and separate closure remain distinct from production integration acceptance.

## Delivery boundary

The local follow-up commit and integration PR draft are reviewable. Publishing these new fixes, creating/merging the final integration PR, closing remaining Issues or the parent Spec, and deleting branches/worktrees are not claimed complete. The explicit authorization completed in this session was metadata synchronization and merging PR #11 into the integration branch.
