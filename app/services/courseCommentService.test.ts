import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  CourseCommentError,
  deleteCourseComment,
  getCourseCommentState,
  getCourseComments,
  publishCourseComment,
} from "./courseCommentService";

describe("courseCommentService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
  });

  it("publishes trimmed comments for enrolled Students and returns their names newest first", () => {
    const older = publishCourseComment(
      base.course.id,
      base.user.id,
      "  First comment  "
    );
    const newer = publishCourseComment(
      base.course.id,
      base.user.id,
      "Second comment"
    );

    expect(older.content).toBe("First comment");
    expect(getCourseComments(base.course.id)).toEqual([
      expect.objectContaining({
        id: newer.id,
        authorName: "Test User",
        content: "Second comment",
      }),
      expect.objectContaining({
        id: older.id,
        authorName: "Test User",
        content: "First comment",
      }),
    ]);
  });

  it.each(["a".repeat(9), " ".repeat(10), "a".repeat(501)])(
    "rejects comment text outside the trimmed 10–500 character range",
    (content) => {
      expect(() =>
        publishCourseComment(base.course.id, base.user.id, content)
      ).toThrow("Comments must be between 10 and 500 characters.");
    }
  );

  it.each(["a".repeat(10), "a".repeat(500)])(
    "accepts comment text at the trimmed %s-character boundary",
    (content) => {
      expect(() =>
        publishCourseComment(base.course.id, base.user.id, content)
      ).not.toThrow();
    }
  );

  it("allows the course instructor and an Admin to publish without enrollment", () => {
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    expect(() =>
      publishCourseComment(
        base.course.id,
        base.instructor.id,
        "Instructor comment"
      )
    ).not.toThrow();
    expect(() =>
      publishCourseComment(base.course.id, admin.id, "Administrator comment")
    ).not.toThrow();
  });

  it("allows the course instructor even after their role changes", () => {
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Student })
      .where(eq(schema.users.id, base.instructor.id))
      .run();

    expect(() =>
      publishCourseComment(
        base.course.id,
        base.instructor.id,
        "Instructor remains eligible"
      )
    ).not.toThrow();
  });

  it("does not treat another course's instructor as eligible without being an enrolled Student", () => {
    const secondCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Second Course",
        slug: "second-course",
        description: "Another course",
        instructorId: base.user.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Instructor })
      .where(eq(schema.users.id, base.user.id))
      .run();

    expect(() =>
      publishCourseComment(
        base.course.id,
        base.user.id,
        "Other course instructor"
      )
    ).toThrow("Only enrolled Students can comment on this course.");
    expect(secondCourse).toBeDefined();
  });

  it("rechecks role, enrollment, and Published status when publishing", () => {
    testDb.delete(schema.enrollments).run();
    expect(() =>
      publishCourseComment(
        base.course.id,
        base.user.id,
        "No enrollment comment"
      )
    ).toThrow("You must be enrolled to comment on this course.");

    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Archived })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    expect(() =>
      publishCourseComment(
        base.course.id,
        base.instructor.id,
        "Archived course comment"
      )
    ).toThrow("Only Published courses accept comments.");
  });

  it("keeps existing comments readable and lets authors delete after unenrolling or archiving", () => {
    const comment = publishCourseComment(
      base.course.id,
      base.user.id,
      "Stored course comment"
    );
    testDb.delete(schema.enrollments).run();
    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Archived })
      .where(eq(schema.courses.id, base.course.id))
      .run();

    expect(getCourseComments(base.course.id)).toHaveLength(1);
    expect(deleteCourseComment(comment.id, base.user.id)).toBe(true);
    expect(getCourseComments(base.course.id)).toHaveLength(0);
  });

  it("allows only an author or a current Admin to delete", () => {
    const comment = publishCourseComment(
      base.course.id,
      base.user.id,
      "Protected course comment"
    );
    const otherStudent = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    expect(() => deleteCourseComment(comment.id, otherStudent.id)).toThrow(
      CourseCommentError
    );
    expect(deleteCourseComment(comment.id, admin.id)).toBe(true);
  });

  it("rejects a former Admin who tries to delete another user's comment", () => {
    const comment = publishCourseComment(
      base.course.id,
      base.user.id,
      "Protected after role change"
    );
    const formerAdmin = testDb
      .insert(schema.users)
      .values({
        name: "Former Admin",
        email: "former-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Student })
      .where(eq(schema.users.id, formerAdmin.id))
      .run();

    expect(() => deleteCourseComment(comment.id, formerAdmin.id)).toThrow(
      "You cannot delete this comment."
    );
  });

  it("reports comment publishing controls only for eligible signed-in users", () => {
    expect(getCourseCommentState(base.course.id, null)).toEqual({
      canComment: false,
    });
    expect(getCourseCommentState(base.course.id, base.user.id)).toEqual({
      canComment: true,
    });
  });
});
