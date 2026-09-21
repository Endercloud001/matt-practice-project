import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: { id: number };

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  BookmarkError,
  getCourseBookmarkState,
  saveLessonBookmark,
} from "./lessonBookmarkService";

describe("lessonBookmarkService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module", position: 1 })
      .returning()
      .get();
    lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "Lesson", position: 1 })
      .returning()
      .get();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
  });

  it("adds and removes an eligible Student bookmark idempotently", () => {
    expect(
      saveLessonBookmark({
        lessonId: lesson.id,
        userId: base.user.id,
        bookmarked: true,
      })
    ).toEqual({ lessonId: lesson.id, bookmarked: true });
    saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: true });
    expect(getCourseBookmarkState({ courseId: base.course.id, userId: base.user.id }))
      .toMatchObject({ canView: true, canEdit: true, lessonIds: [lesson.id] });

    saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: false });
    saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: false });
    expect(getCourseBookmarkState({ courseId: base.course.id, userId: base.user.id }).lessonIds).toEqual([]);
  });

  it.each([schema.UserRole.Instructor, schema.UserRole.Admin])(
    "rejects a %s",
    (role) => {
      testDb.update(schema.users).set({ role }).where(eq(schema.users.id, base.user.id)).run();
      expect(() => saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: true }))
        .toThrow(BookmarkError);
    }
  );

  it("keeps an existing bookmark visible but read-only while Draft", () => {
    saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: true });
    testDb.update(schema.courses).set({ status: schema.CourseStatus.Draft }).where(eq(schema.courses.id, base.course.id)).run();
    expect(getCourseBookmarkState({ courseId: base.course.id, userId: base.user.id }))
      .toMatchObject({ canView: true, canEdit: false, lessonIds: [lesson.id] });
    expect(() => saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: false }))
      .toThrow("Bookmarks cannot currently be edited for this course.");
  });

  it("hides bookmark state for signed-out and unenrolled viewers", () => {
    expect(getCourseBookmarkState({ courseId: base.course.id, userId: null }))
      .toMatchObject({ canView: false, lessonIds: [] });
    testDb.delete(schema.enrollments).run();
    expect(getCourseBookmarkState({ courseId: base.course.id, userId: base.user.id }))
      .toMatchObject({ canView: false, lessonIds: [] });
  });
});
