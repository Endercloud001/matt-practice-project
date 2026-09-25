# Issue #3 Purchase Total Verification

This note records the executable read-only endpoint delivered for Issue #3. It does not implement the dashboard UI or the later analytics metrics.

## Endpoint

`GET /api/analytics/purchase-total`

The resource route is registered outside `layout.app`, so the request does not execute the legacy layout loader that loads user records. It requires the normal session cookie, redirects a missing session to `/login`, rejects Student accounts with 403, and returns `Cache-Control: private, no-store`.

Successful responses include `ok`, a server-generated `asOf`, explicit `UTC` / `USD` / `en-US` configuration, the Purchase Total metric state, and normalized filters. The amount is integer cents. An authorized course scope with no purchases returns `empty/no_purchases`; no authorized courses returns `empty/no_authorized_courses`; a recorded zero purchase is `value` with `cents: 0`.

## Query parameters

- `range`: `all` (default), `last7days`, `last30days`, `lastYear`, or `custom`.
- `start`, `end`: required together with `range=custom`, as valid `YYYY-MM-DD` UTC calendar dates. Start is inclusive at midnight UTC; end is exclusive at midnight UTC. Start must precede end.
- `instructorId`: Admin-only narrowing; Instructor requests remain scoped to their own courses and the effective response filter is normalized to `null`.
- `courseId`: narrows to one currently existing course, with service authorization checked on every request.

The rolling preset ranges include the current UTC calendar day and the preceding days: 7, 30, and 365 days respectively. Valid future custom periods return a normal empty metric. This endpoint returns a single aggregate rather than a paginated collection, so page parameters do not apply to Issue #3.

## Verification

The service tests use `createTestDb()` migrations and `seedBaseData()` against real in-memory SQLite. They cover ownership scope and changes, Admin global and narrowed scope, Student rejection, empty authorization scope, deleted and unauthorized courses, duplicate purchase rows, zero versus absent purchases, and inclusive/exclusive date boundaries. Loader tests cover session behavior, HTTP statuses, no-PII response, normalized defaults, safe integer IDs, malformed and impossible custom dates, equal/reversed ranges, valid future dates, Admin global scope, Instructor filter normalization, and UTC preset bounds.

Commands run from the Issue #3 worktree:

```powershell
pnpm test -- app/services/analyticsService.test.ts app/routes/api.analytics.purchase-total.test.ts
pnpm typecheck
pnpm test
```

Final verification passed: focused tests 22/22, full suite 372/372 across 21 files, typecheck, Prettier, and `git diff --cached --check`. Two independent review axes (Standards and Spec) both passed with zero remaining findings. The review fixes covered project alias imports, role-aware effective filter output, specific malformed-date errors, and Admin/preset scope coverage.

A separate local dev-server request used an authenticated session and seeded scratch SQLite data. `GET /api/analytics/purchase-total?range=custom&start=2025-03-02&end=2025-03-03` returned HTTP 200, `Cache-Control: private, no-store`, and `purchaseTotal: { state: "value", cents: 4321 }`, with UTC-normalized bounds. The scratch database was removed after the check. No GitHub issue was modified.

The implementation branch is `codex/issue-3-purchase-total`, based on `f42ab9eab2558d87841e000367b749b898379d71`. This branch is a local committed handoff; integrate it independently from the prototype branch. It has not been pushed or merged.
