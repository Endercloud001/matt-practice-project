# Lesson Bookmarks

## Purpose and Scope

Students enrolled in a course can bookmark individual lessons for later reference. The bookmark target is a lesson within a course, not the entire course.

## Privacy and Persistence

- Bookmarks are private to each student.
- Only a user whose current platform role is Student and who is enrolled in the course may use the bookmark feature. Instructors and Admins may not use it.
- A bookmark persists until the student manually removes it or the student loses eligibility because the enrollment is removed or the user's role changes to Instructor or Admin. Losing eligibility immediately deletes that student's related bookmarks, and restoring eligibility does not restore them.
- Completing a lesson does not remove its bookmark.
- Unauthenticated users, unenrolled users, Instructors, and Admins see neither the bookmark control nor bookmark status.
- Bookmarks are account-bound and are shared across the Student's devices and login sessions.

## Course Lifecycle

- While a course is Draft or Archived, an enrolled Student may view existing bookmarks on the course detail page and on an accessible lesson page.
- While a course is Draft or Archived, bookmarks cannot be added or removed.
- On a lesson page for a Draft or Archived course, the current bookmark state remains visible and the bookmark control is disabled. Hovering over the disabled control shows the exact Chinese UI tooltip string `\u8bfe\u7a0b\u5f53\u524d\u4e0d\u53ef\u7f16\u8f91\u4e66\u7b7e` (Unicode-escaped; English meaning: "Bookmarks cannot currently be edited for this course").

## Regional Access Restrictions

- PPP regional access restrictions do not delete bookmarks or revoke enrollment-based bookmark eligibility.
- An otherwise eligible Student can still view existing lesson and chapter bookmark indicators on the course detail page while regionally restricted.
- The lesson page preserves its existing regional access block, including hiding the lesson content, bookmark control, and curriculum sidebar. This block takes precedence over the Draft/Archived read-only control.
- The server rejects both add and remove bookmark requests while the Student is regionally restricted, including requests submitted directly without using the lesson page.
- When the regional restriction is lifted, bookmark operations become available again subject to the current role, enrollment, and course-state rules. Existing bookmarks remain intact.

## Placement and Interaction

- Bookmarks are integrated into existing pages. There is no dedicated bookmarks page.
- Students can add or remove a bookmark only on the lesson page itself, in the metadata row alongside the duration and GitHub link.
- The curriculum sidebar and the lesson list on the course detail page display passive bookmark indicators only. These lists do not provide bookmark toggles.
- In the course-detail lesson list, the bookmark icon appears at the far right, after the duration: `[status] [title] ... [duration] [bookmark]`.
- In the curriculum sidebar, the bookmark icon appears at the far right of the lesson row, after the lesson title.
- Unbookmarked lessons show no bookmark icon in lists. The icon appears only when a lesson is bookmarked.
- Chapter headings in both the lesson page's curriculum sidebar and the course detail page show a passive yellow bookmark indicator when at least one lesson in that chapter is bookmarked. In the sidebar, this applies whether the chapter is expanded or collapsed. The chapter indicator does not provide a bookmark operation.
- The standalone chapter page is outside this feature's scope and remains unchanged; no bookmark indicators or controls are added there.
- The bookmark control is disabled while a save is in progress. It updates only after an explicit successful server response. Failure and unconfirmed outcomes follow the Action and Error Behavior rules below.
- After a successful save, the lesson control and the corresponding icon in the current page's curriculum sidebar update together.
- After a successful save, chapter indicators are derived from the latest lesson bookmark states and update with the other current-page indicators.
- A successful save updates the control state without an additional success notification.
- Bookmark state does not need real-time synchronization across tabs or devices. It updates on the next navigation, refresh, or data reload.
- The lesson list and curriculum sidebar remain complete lists; this feature adds no bookmark-only filter.
- The unbookmarked lesson control uses a gray outline bookmark icon and the label `Bookmark`. The bookmarked lesson control uses a yellow filled bookmark icon and the label `Bookmarked`. Both use the existing `Open Code` outline button's border, rounded corners, size, and unchanged background treatment.
- On narrow screens, the bookmark button retains its text label and may wrap naturally when space is insufficient.

## Eligibility Changes and Concurrent Writes

- If duplicate enrollment rows exist for the same Student and course, the Student remains eligible while at least one enrollment row remains. Removing the final enrollment row deletes that Student's bookmarks for the course.
- The server accepts the last successful operation after its current eligibility check as the resulting state. Repeated add and remove requests are idempotent and do not produce errors.
- Enrollment removal and role changes that revoke eligibility perform bookmark cleanup as part of the same operation, so a concurrent bookmark request cannot leave a bookmark after revocation succeeds.

## Action and Error Behavior

- Expected permission or course-state failures remain on the current page as a structured local error. The page reloads the latest permission, regional access, and course state, then hides or disables the bookmark entry according to the current rules. If regional access is blocked, the existing lesson-page regional block applies.
- A definitive save rejection preserves the previous displayed bookmark state and shows an error, subject to hiding bookmark state when refreshed permissions no longer allow it.
- After an explicit successful save response, the lesson control, corresponding sidebar lesson indicator, and affected chapter indicator update together. A subsequent data reload failure does not roll back this confirmed state.
- If no definitive save response is received, the previous displayed bookmark state remains and an error explains that the save outcome is unconfirmed. The server may already have committed the operation even though the response was lost.
- The next successful navigation, refresh, or data reload reconciles bookmark state with the server, including after an unconfirmed save. A newer successful read can supersede a previously confirmed save response; a failed read cannot.

## Tooltip Accessibility

- The Draft/Archived read-only tooltip is available on mouse hover, keyboard focus, and touch activation using the exact Chinese UI string recorded above. Bookmark operations remain disabled while the read-only tooltip is available.

## Deletion Scope

- This feature adds no lesson or course deletion flow and preserves the existing restrictive foreign-key behavior.

## Acceptance Scenarios for Access, Save Outcomes, and Placement

- Given an eligible Student with an existing bookmark, entering a PPP-restricted region preserves the bookmark and its course-detail indicators. The lesson page shows its existing regional block, and direct add and remove requests are rejected. Lifting the restriction restores operations when the other eligibility and course-state requirements are met.
- Given an explicit successful save response, the lesson control, sidebar lesson indicator, and chapter indicator reflect the saved state together. If the subsequent data reload fails, all three retain that confirmed state.
- Given a save that commits on the server but whose response is lost, the page retains its previous displayed state and reports an unconfirmed outcome. The next successful data load displays the committed server state.
- Adding the first bookmark in a chapter makes its chapter indicator appear in the current lesson sidebar and on the next load of the course detail page. Removing the last bookmark makes both indicators disappear on the corresponding updates. Collapsing the sidebar chapter does not hide its chapter indicator.
- The standalone chapter page remains unchanged after bookmarks are added or removed elsewhere.
