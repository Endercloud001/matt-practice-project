# Issue #5 Student progress verification

Scope: [Issue #5](https://github.com/Endercloud001/matt-practice-project/issues/5), based on Issue #4 commit `1c26181a2b44bb34c23cae56068c2458edb197f6`. Local branch: `codex/issue-5-student-progress`.

## Implementation

- Overview adds the fifth equal-size KPI, **Average Student Learning Progress**. Its full-precision percentage pools completed and possible student–lesson units; only the display rounds to a whole percentage.
- Eligibility uses currently present, in-period enrollment rows, deduplicated by student/course. Duplicate completion rows do not add units. Completion timestamps do not turn the current learning snapshot into a historical trend.
- `/instructor/analytics/:courseId` loads authorized course identity and initial metrics in the existing SQLite transaction. The page presents course identity/dates, purchase/enrollment totals, then **Course Average Student Learning Progress**.
- Shared page and retry presentation preserve request identity, scope and observation generation. Course retry explicitly includes the path course ID. Dates survive overview/course navigation and error recovery.
- Empty eligibility, no calculable lessons, genuine zero and safe read failures remain distinct. No quiz metrics, student table, course summary list, schema or new connection was added.

## Automated checks

- `pnpm test`: **26 files, 419 tests passed**, final run 2026-09-24 20:02 local time (Asia/Shanghai), after review fixes.
- `pnpm typecheck`: passed immediately after the final full test run.
- `git diff --cached --check`: passed for the reviewed implementation.
- TDD probes failed before the new progress API, course API, percentage presentation, missing-data explanations, five-card page, course hierarchy and recovery links were implemented. Their corresponding targeted runs passed afterward.

Service fixtures cover unequal course sizes, full precision, duplicate enrollments/completions, actual lesson/course membership, inclusive start/exclusive end, removed/pre-period enrollment residue, current completion outside the date window, no records/no lessons/zero, scoped authorization and recoverable progress read failure. Loader tests exercise session/role, course identity, current ownership, missing courses, Admin mismatch, path validation, date recovery and PII-free payloads. Static rendering checks named cards, five-card/course hierarchy, rounding, state explanations and one loading announcement.

## Browser acceptance

Headless Edge, using the existing local `playwright-core`, passed:

| Requirement | Evidence |
| --- | --- |
| Five equal-size cards; responsive layout | Measured equal desktop card width/height; overview and course pages have no document overflow at 390px. |
| Course hierarchy and recoverable dates | Course identity/dates precede purchase/enrollment totals, then learning outcomes. Explicit course link, Back/Forward and invalid-date correction retain date/course context, including exclusive end date. |
| Keyboard and loading semantics | Visible keyboard focus and Enter activate date presets; one polite status region; pending Retry announces Updating and disables conflicting filters. |
| Current progress and states | A one-lesson completed course plus a nine-lesson uncompleted course produces 10% pooled progress. Course 100%, genuine 0%, empty enrollment and no-lessons unavailable render distinctly. |
| Safe local failure and target-only Retry | Temporarily renamed `lesson_progress` in the isolated fixture database. Progress alone failed; restoring it and retrying carried the path course ID and changed only progress's observation time. |
| Response races | Applied Retry override did not survive A→B→A; delayed navigation did not overwrite a newer history scope. A held Retry containing 100% did not overwrite a fresh 0% snapshot after navigation. |
| Authorization and privacy | Retry after ownership revocation removed the old snapshot; restoring ownership allowed a fresh bookmark load. Foreign/missing course URLs showed authorization/not-found errors with date recovery; Admin could load a globally authorized course. HTML and parent/child data responses omitted the student PII sentinel. |

No browser page errors were observed. Expected HTTP 400/403 console messages came from intentional invalid-date and authorization probes. No screen-reader listening was performed; keyboard and live-region structure checks are not claimed as screen-reader listening.

Screenshots: [overview desktop](issue-5-overview-desktop.png), [overview mobile](issue-5-overview-mobile.png), [course desktop](issue-5-course-desktop.png), [course mobile](issue-5-course-mobile.png).

Temporary probes and detailed reports are stored under OS `%TEMP%`: `issue5-browser-acceptance.cjs` / `.json` and `issue5-supplement.cjs` / `.json`. Database fault injection and fixture progress/ownership changes were restored in `finally` blocks. The first browser agent later hit a workspace-credit error, but its completed report was recovered and inspected; the coordinator ran the supplementary probes directly.

## Independent review

Reviewers used GPT 5.6-Sol with medium reasoning, independently reviewing the explicitly staged implementation against #4 and Issue #5. Interrupted review attempts were replaced; only completed reports count.

- **Standards:** final **0 findings**. The initial judgement about too many responsibilities in the page was addressed by extracting payload parsing, retry state and filters. A follow-up duplication judgement was addressed with shared scope/date controls for normal and recovery forms.
- **Spec:** final **0 findings**. Fixed progress-empty copy to distinguish overview `所选期间暂无数据` from course detail `该课程暂无符合条件的学生`, with a failing-then-passing rendered-page regression test.

The primary browser suite was rerun after the final field extraction. The supplementary PII/state/held-retry probes also passed after the retry/page extraction. No unrelated legacy services were refactored.

## Local runtime

Normal checkout: `pnpm dev`; sign in as Instructor or Admin and visit `/instructor/analytics`.

This worktree uses an existing dependency junction. Local browser acceptance runs with `pnpm dev --config vite.browser.config.ts --host 127.0.0.1 --port 4175`. The untracked machine-specific configuration retains strict filesystem checks and allows only this worktree and the real dependencies. The isolated `data.db`, fixture script and temporary browser probes are not production deliverables.

## Delivery boundary

Only this issue's implementation, tests and verification evidence belong in its commit. User context copied into the worktree and original repository changes remain uncommitted. No push, merge, publish or Issue closure is part of this delivery.
