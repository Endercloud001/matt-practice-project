# Issue #4 analytics overview verification

## Checks

- `pnpm test` — 24 test files passed, 392 tests passed. Final run started 2026-09-24 09:06:03 local time; Vitest reported 5.79 seconds duration.
- `pnpm typecheck` — passed (`react-router typegen && tsc`) immediately after that test run.
- `git diff --check` — passed.
- Independent final Standards and Spec reviews — 0 findings. The two actionable Standards heuristics were addressed by sharing analytics scope/aggregation helpers and deriving the metric type/API validation from one list.

Analytics service tests use the real migrated test SQLite database. They cover inclusive start/exclusive end dates, enrollment relation de-duplication, one student in multiple courses, independent metric failures, target-only retry, fresh authorization on overview/retry, and empty scopes. Loader tests cover session redirect, role denial, empty native IDs, exact custom end dates, foreign/deleted course denial without metric payloads, Admin instructor/course mismatch, invalid dates, and response PII. Static rendering checks card naming, disabled retry, stale-scope text, one loading live region, and hidden skeleton decoration.

## Acceptance coverage

| Requirement | Evidence |
| --- | --- |
| Instructor/Admin navigation, dedicated overview, preserve one-course workflow | Edge navigation from `/instructor` and `/admin/courses`; overview route remains accessible for a single-course Instructor. |
| Session and scope authorization, no cross-course student PII | Loader/service tests plus Edge HTML, parent/child `.data`, and rendered page checks with sentinel name/email. |
| URL filters, presets, custom dates, instructor/course cascade, history and keyboard | Loader boundary tests; Edge confirmed exact exclusive custom end, preset replacement, instructor cascade, Back/Forward/reload, and focus+Enter preset submission. |
| Four delivered metrics and states | Real SQLite/service tests, loader tests, static card tests, and Edge overview values. Retention/Net remain unavailable; later Learning Progress/student/course summaries were not added. |
| Retry isolation, mixed timestamps, auth change, request races | Real SQLite read failure/retry; target timestamp changed while sibling stayed fixed; retry after ownership revoke cleared snapshot; restore plus Back/Forward loaded a fresh successful snapshot; held old navigation and retry could not replace the newer scope. |
| Responsive and accessible pending states | Static checks for named card, disabled Retry, stale-scope text, one loading live region and hidden skeleton; Edge at 390px had no horizontal overflow, one live region, no page errors, real delayed requests displayed updating/disabled filters. |

The fixture's instructor course had a recorded zero-price purchase, which displays as `$0.00`; empty purchase history remains a separate empty state. Admin overview returned `$22.50` and 2 enrollment relationships, while the Instructor's owned course returned `$0.00` and 1.

The coordinator's first cross-page navigation probe encountered one Vite dynamic-entry import failure while using the shared `node_modules` junction. Repeating the same two-role probe passed with no page errors, and the separate final browser suite passed all checks. This was a development-runtime transient and did not prompt changes to Vite filesystem security.

Screenshots: [desktop](issue-4-analytics-desktop.png) and [mobile](issue-4-analytics-mobile.png). Browser acceptance ran in headless Edge; these checks do not claim screen-reader listening.

The analytics overview foundations are available for follow-up issue #5; that work was not started in this branch.

## Run locally

In a normal checkout with dependencies installed, use `pnpm dev` and open `/instructor/analytics` after signing in as Instructor or Admin. In this shared-node_modules worktree, start with `pnpm dev --config vite.browser.config.ts --host 127.0.0.1 --port 4174`; the temporary config allows this worktree and the real dependency directory while retaining Vite's strict filesystem checks. It contains a machine-specific worktree path and is not part of the staged implementation. The worktree is based on #3 commit `ac703722e3a094426dbc90777cc9b54d6d9758aa`; the #2 prototype was used only as a reference and no prototype code was merged.
