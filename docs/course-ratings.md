# Course ratings

## Confirmed behavior

### Rating value

- A course rating is one of `1`, `1.5`, `2`, `2.5`, `3`, `3.5`, `4`, `4.5`, or `5` stars. `0.5` is not a valid rating.
- A course rating has no written comment.
- Each eligible user has at most one current rating for a course. Changing it replaces the star value and does not increase the rating count.
- The product provides no way for a user to withdraw a rating.

### Eligibility and lifecycle

- Only a user whose current platform role is Student may submit or change a rating.
- The Student must be enrolled in the course; completing the course is not required.
- A course author may never rate their own course, including if their current role is Student and they are enrolled.
- Only Published courses accept new ratings or changes.
- A rating remains stored and continues to count if its author leaves the course or changes to the Instructor or Admin role. It cannot be changed while the author is ineligible.
- If the author later becomes a Student again, they may change the same rating when they are enrolled and the course is Published. The rating count does not increase.
- Moving a course to Draft or Archived does not delete its ratings. If the course is published again, the retained ratings remain part of its rating summary.

### Public summary

- A rating summary contains a star graphic, the average rounded to one decimal place, and the rating count.
- A course with no ratings has no public rating summary displayed.
- Public rating summaries appear only on the home page's Featured Courses cards, the Browse Courses cards, and the course detail page.
- A public rating summary appears only while the course is Published. A Draft or Archived course hides its public summary even when its detail page is reached directly; publishing it again restores the summary from the retained ratings.
- The public summary is independent of whether the current viewer may rate the course.

### Rating input

- The rating input appears only on the course detail page.
- An eligible Student sees the input even when the course has no ratings, so they can submit the first rating.
- The input shows the current user's existing rating when one exists.
- The input supports half-star selection from `1` through `5`; the first star does not offer `0.5`.
- Selecting a value highlights it and saves it immediately. There is no separate save button.
- While the save is pending, the input shows a saving state and is disabled, so saves are serialized.
- On success, the new value remains selected. On failure, the input shows an error and restores the last saved value; a failed first rating returns to the unrated state.
- A user with a retained rating who is currently ineligible sees their own rating read-only with an explanation. A currently ineligible user with no prior rating sees no rating input.
- On a Draft or Archived course detail page, a user with a retained rating still sees that personal rating read-only even though the public summary is hidden.

## Approved implementation

### Persistence

- Add a `course_ratings` table with an ID, `courseId`, `userId`, `ratingUnits`, `createdAt`, and `updatedAt`.
- Store half-star units as an integer from `2` through `10`; divide by two at the service boundary. This represents every valid value exactly without decimal storage behavior. Validate the same range in the request layer and with a database check constraint.
- Enforce one row per `(courseId, userId)` with a unique constraint.
- Reference the course and user with foreign keys. Keep restrictive deletion behavior consistent with the current schema; this feature adds no course, user, or rating deletion flow.
- Add the table through a normal Drizzle migration so production and the in-memory service-test database use the same schema.

### Server behavior

- Put rating reads and writes in a rating service. Derive the acting user ID from the server session and reload the user's current role from the database rather than accepting either from submitted form fields.
- On every write, reload and validate the course, enrollment, current Student role, Published status, non-authorship, and allowed rating value. Client visibility and disabled controls are presentation only and never grant permission.
- Upsert by `(courseId, userId)` so a first rating inserts one row and a later rating updates that row and its timestamp.
- Compute an equally weighted `AVG(ratingUnits) / 2` and `COUNT(*)` across all retained current ratings. Former eligibility does not remove a rating from the aggregate. Return `average: null` and `count: 0` when there are no rows. Round only the displayed average to one decimal place; do not cache aggregate columns on the course.
- Extend the grouped course query used by the home and Browse loaders with one aggregate subquery or join, avoiding one query per card. In the course-detail loader, fetch the summary, current user's rating, and server-derived eligibility state without adding rating work to unrelated purchase, welcome, learning, or editing loaders.
- Add the summary fields only to the existing home, Browse, and detail data paths. Update their explicit loader mappings so the new fields are not dropped; leave dashboard, sidebar, purchase, redemption, welcome, learning, instructor, admin, and team surfaces unchanged.
- Keep the current course visibility rules unchanged. The rating feature adds no course deletion, rating withdrawal, or moderation endpoint.

### UI and route behavior

- Use one shared summary component on the three confirmed surfaces and a separate interactive input on the course detail page. Render the summary only when the course is Published and its rating count is greater than zero.
- Add a course-detail action for rating writes. Resolve the course from the route parameter, parse only the submitted rating value with the existing validation pattern, obtain identity from the server session, call the rating service, and return a structured success or error result.
- Submit with a fetcher. Optimistically highlight the chosen value and show a saving state, disable the input until the request finishes, revalidate the summary after success, and roll back with an error message after failure. A first-write failure rolls back to no selection.
- Let pointer users select left and right star halves except that the first star starts at `1`. Provide the equivalent `0.5` keyboard steps and accessible labels as normal input quality, without changing the business scale.
- When the service reports the user as eligible, show the interactive input even if no public summary exists. When a retained personal rating exists but the user is ineligible, show it read-only with the server-provided reason. Otherwise omit the input.
- Render fractional aggregate stars proportionally to the one-decimal average while keeping the numeric average and rating count visible.
- Add no runtime dependency; the existing components, validation pattern, route action, and database stack are sufficient.

### Verification

- Service tests cover the valid half-star set and rejected values, session-derived identity, Student-role enforcement, enrollment, Published status, author rejection, first insert, update without increasing count, retained ratings after role or enrollment changes, aggregate calculation, and grouped summaries.
- Query and route tests cover hiding zero-count summaries, showing summaries on all three approved Published surfaces, hiding public summaries for Draft and Archived courses, and restoring them after republishing.
- Route or component tests cover visibility of the first-rating input, loading an existing personal rating, read-only historical ratings and their reasons, pointer and keyboard half-star selection with a minimum of `1`, serialized saving, success refresh, update count stability, and failure rollback including a failed first rating.
