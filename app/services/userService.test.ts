import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { saveLessonBookmark } from "./lessonBookmarkService";
import { updateUserRole } from "./userService";

describe("userService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("removes a Student's bookmarks when their role changes", () => {
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module", position: 1 })
      .returning()
      .get();
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "Lesson", position: 1 })
      .returning()
      .get();
    testDb.insert(schema.enrollments).values({ userId: base.user.id, courseId: base.course.id }).run();
    saveLessonBookmark({ lessonId: lesson.id, userId: base.user.id, bookmarked: true });

    updateUserRole({ id: base.user.id, role: schema.UserRole.Instructor });

    expect(testDb.select().from(schema.lessonBookmarks).all()).toEqual([]);
  });
});
