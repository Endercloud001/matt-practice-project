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
  getCourseRatingState,
  getRatingSummary,
  submitCourseRating,
} from "./ratingService";

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
  });

  it("lets an enrolled Student rate a Published course", () => {
    const rating = submitCourseRating(base.course.id, base.user.id, 4.5);

    expect(rating).toMatchObject({
      courseId: base.course.id,
      userId: base.user.id,
      rating: 4.5,
    });
    expect(getRatingSummary(base.course.id)).toEqual({
      average: 4.5,
      count: 1,
    });
  });

  it.each([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5])(
    "stores %s stars exactly",
    (value) => {
      expect(
        submitCourseRating(base.course.id, base.user.id, value).rating
      ).toBe(value);
    }
  );

  it.each([0.5, 0.75, 1.25, 5.5, Number.NaN])(
    "rejects invalid rating %s",
    (value) => {
      expect(() =>
        submitCourseRating(base.course.id, base.user.id, value)
      ).toThrow("Rating must be between 1 and 5 in half-star steps.");
    }
  );

  it("enforces integer half-star units in the database", () => {
    expect(() =>
      testDb
        .insert(schema.courseRatings)
        .values({
          courseId: base.course.id,
          userId: base.user.id,
          ratingUnits: 2.5,
        })
        .run()
    ).toThrow();
  });

  it("updates an existing rating without increasing the count", () => {
    submitCourseRating(base.course.id, base.user.id, 2);
    submitCourseRating(base.course.id, base.user.id, 5);

    expect(getRatingSummary(base.course.id)).toEqual({ average: 5, count: 1 });
  });

  it("calculates an equally weighted aggregate", () => {
    const secondStudent = testDb
      .insert(schema.users)
      .values({
        name: "Second Student",
        email: "second@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    testDb
      .insert(schema.enrollments)
      .values({ userId: secondStudent.id, courseId: base.course.id })
      .run();

    submitCourseRating(base.course.id, base.user.id, 4.5);
    submitCourseRating(base.course.id, secondStudent.id, 3);

    expect(getRatingSummary(base.course.id)).toEqual({
      average: 3.75,
      count: 2,
    });
  });

  it("returns an empty summary when a course has no ratings", () => {
    expect(getRatingSummary(base.course.id)).toEqual({
      average: null,
      count: 0,
    });
  });

  it("enforces current Student role", () => {
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Instructor })
      .where(eq(schema.users.id, base.user.id))
      .run();

    expect(() => submitCourseRating(base.course.id, base.user.id, 4)).toThrow(
      "Only Students can rate courses."
    );
  });

  it("enforces current enrollment", () => {
    testDb.delete(schema.enrollments).run();

    expect(() => submitCourseRating(base.course.id, base.user.id, 4)).toThrow(
      "You must be enrolled to rate this course."
    );
  });

  it.each([schema.CourseStatus.Draft, schema.CourseStatus.Archived])(
    "rejects ratings while a course is %s",
    (status) => {
      testDb
        .update(schema.courses)
        .set({ status })
        .where(eq(schema.courses.id, base.course.id))
        .run();

      expect(() => submitCourseRating(base.course.id, base.user.id, 4)).toThrow(
        "Only Published courses can be rated."
      );
    }
  );

  it("rejects a course author even when they are a Student and enrolled", () => {
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Student })
      .where(eq(schema.users.id, base.instructor.id))
      .run();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.instructor.id, courseId: base.course.id })
      .run();

    expect(() =>
      submitCourseRating(base.course.id, base.instructor.id, 4)
    ).toThrow("Course authors cannot rate their own course.");
  });

  it("retains a rating in the aggregate after role and enrollment changes", () => {
    submitCourseRating(base.course.id, base.user.id, 4.5);
    testDb.delete(schema.enrollments).run();
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Admin })
      .where(eq(schema.users.id, base.user.id))
      .run();

    expect(getRatingSummary(base.course.id)).toEqual({
      average: 4.5,
      count: 1,
    });
  });

  it("lets a retained rating be changed after Student role and enrollment return", () => {
    submitCourseRating(base.course.id, base.user.id, 2.5);
    testDb.delete(schema.enrollments).run();
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Instructor })
      .where(eq(schema.users.id, base.user.id))
      .run();
    testDb
      .update(schema.users)
      .set({ role: schema.UserRole.Student })
      .where(eq(schema.users.id, base.user.id))
      .run();
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    submitCourseRating(base.course.id, base.user.id, 4);

    expect(getRatingSummary(base.course.id)).toEqual({ average: 4, count: 1 });
  });

  it("reports an eligible unrated Student state", () => {
    expect(getCourseRatingState(base.course.id, base.user.id)).toEqual({
      personalRating: null,
      canRate: true,
      reason: null,
    });
  });

  it("reports a retained rating and reason when the author becomes ineligible", () => {
    submitCourseRating(base.course.id, base.user.id, 3.5);
    testDb.delete(schema.enrollments).run();

    expect(getCourseRatingState(base.course.id, base.user.id)).toEqual({
      personalRating: 3.5,
      canRate: false,
      reason: "You must be enrolled to rate this course.",
    });
  });

  it.each([schema.CourseStatus.Draft, schema.CourseStatus.Archived])(
    "reports a retained rating as read-only while the course is %s",
    (status) => {
      submitCourseRating(base.course.id, base.user.id, 3.5);
      testDb
        .update(schema.courses)
        .set({ status })
        .where(eq(schema.courses.id, base.course.id))
        .run();

      expect(getCourseRatingState(base.course.id, base.user.id)).toEqual({
        personalRating: 3.5,
        canRate: false,
        reason: "Only Published courses can be rated.",
      });
    }
  );

  it("omits personal controls for a signed-out viewer", () => {
    expect(getCourseRatingState(base.course.id, null)).toEqual({
      personalRating: null,
      canRate: false,
      reason: null,
    });
  });
});
