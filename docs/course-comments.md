# Course comments

## Confirmed behavior

### Visibility and publishing eligibility

- The comment area is shown on the course detail page.
- Only signed-in users can view comments.
- An Admin may publish a comment for any course.
- The user referenced by `course.instructorId` may publish a comment for that course.
- A Student may publish a comment only while a current enrollment exists for that course.
- The server derives the acting user from the session and reloads the user's current role and the course/enrollment state when accepting a write.
- Only Published courses accept new comments.
- Existing comments remain stored and viewable when a course is moved to Draft or Archived, as long as the signed-in viewer can open the course detail page.

### Content and display

- A comment is plain text.
- After trimming leading and trailing whitespace, the text must contain 10–500 characters.
- Comments are ordered newest first.
- The comment area appears only at the bottom of the course detail page, separated from the course details by visible spacing.
- Each displayed comment shows the publisher's user name, publication time, and text.
- Comments use a lightweight list layout: the user name and muted publication time share one row, the text appears below, and the item has no heavy standalone card treatment.
- For an eligible user on a Published course, the comment input appears directly above the comment list. The character count is shown at the lower left of the input area and the Publish button at the lower right.
- The input is plain text with no avatar. Publication time uses the concrete `YYYY-MM-DD HH:mm` format (for example, `2026-09-19 14:30`).
- The author and an Admin see a vertical-ellipsis menu at the top right of their deletable comments. The menu contains Delete; selecting it submits the deletion without a second confirmation and refreshes the page after the server successfully hard-deletes the comment.
- v1 has no replies, likes, rich text, or comment editing.
- v1 adds no report, sorting control, or other social actions.

### Deletion

- The comment author may delete their own comment.
- An Admin may delete comments.
- Deletion is a hard delete; the comment disappears from the list immediately.

## Acceptance criteria

- An unauthenticated viewer cannot view the comment list or publish form; a signed-in user can view comments when the course detail page is available.
- Only a current enrolled Student, the course's instructor user, or a current Admin can publish, and the server rechecks publishing eligibility and Published status on every publish request using the session identity and current database records.
- After trimming leading and trailing whitespace, text with 10 or 500 characters is accepted; text with 9 or fewer or 501 or more characters is rejected.
- The rendered comment shows the publisher's user name rather than a user ID, the concrete publication date and time, and the plain-text body. Comments are ordered newest first and have no avatar.
- The comment area is at the bottom of the course detail page with visible separation from course details. An eligible publisher sees the input above the list, the character count at lower left, and Publish at lower right.
- Only the comment author and Admin see the vertical-ellipsis delete menu. A delete action is sent to the server without a confirmation step; after successful hard deletion, the whole page refreshes and the comment is gone.
- The server independently enforces deletion permissions: only the comment author or a current Admin may delete, even if another user submits a forged request. Authors can still delete their own comments after unenrolling or after the course leaves Published status.
- There are no replies, likes, reports, rich text, editing, or user-controlled sorting controls in v1.
