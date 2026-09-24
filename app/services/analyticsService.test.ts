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
  getAnalyticsOverview,
  getAnalyticsMetric,
  getPurchaseTotal,
} from "~/services/analyticsService";

function createAdmin() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
}

function createCourse(instructorId: number, title: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replaceAll(" ", "-"),
      description: "Course",
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function purchase(courseId: number, pricePaid: number, createdAt: string) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, pricePaid, createdAt })
    .run();
}

describe("analyticsService Purchase Total", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("sums each purchase row once within an inclusive-start exclusive-end UTC period", () => {
    purchase(base.course.id, 1250, "2025-03-01T00:00:00.000Z");
    purchase(base.course.id, 1250, "2025-03-15T23:59:59.999Z");
    purchase(base.course.id, 9999, "2025-03-16T00:00:00.000Z");

    expect(
      getPurchaseTotal({
        userId: base.instructor.id,
        start: "2025-03-01T00:00:00.000Z",
        end: "2025-03-16T00:00:00.000Z",
      })
    ).toMatchObject({
      ok: true,
      currency: "USD",
      purchaseTotal: { state: "value", cents: 2500 },
    });
  });

  it("counts separate identical purchases and distinguishes recorded zero from no purchases", () => {
    purchase(base.course.id, 800, "2025-03-01T12:00:00.000Z");
    purchase(base.course.id, 800, "2025-03-01T12:00:00.000Z");
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "value", cents: 1600 },
    });

    testDb.delete(schema.purchases).run();
    purchase(base.course.id, 0, "2025-03-01T12:00:00.000Z");
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "value", cents: 0 },
    });

    testDb.delete(schema.purchases).run();
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "empty", reason: "no_purchases" },
    });
  });

  it("limits Instructors to current ownership and lets Admins narrow global scope", () => {
    const secondInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Second",
        email: "second@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(secondInstructor.id, "Other Course");
    purchase(base.course.id, 100, "2025-03-01T12:00:00.000Z");
    purchase(otherCourse.id, 300, "2025-03-01T12:00:00.000Z");

    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { cents: 100 },
    });
    const admin = createAdmin();
    expect(
      getPurchaseTotal({ userId: admin.id, instructorId: secondInstructor.id })
    ).toMatchObject({ purchaseTotal: { cents: 300 } });
    expect(
      getPurchaseTotal({ userId: admin.id, courseId: otherCourse.id })
    ).toMatchObject({ purchaseTotal: { cents: 300 } });
  });

  it("keeps an Instructor's purchase total scoped to their courses when an instructor filter is supplied", () => {
    const secondInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Second",
        email: "second@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(secondInstructor.id, "Other Course");
    purchase(base.course.id, 100, "2025-03-01T12:00:00.000Z");
    purchase(otherCourse.id, 900, "2025-03-01T12:00:00.000Z");

    expect(
      getPurchaseTotal({
        userId: base.instructor.id,
        instructorId: secondInstructor.id,
      })
    ).toMatchObject({
      purchaseTotal: { state: "value", cents: 100 },
      filters: { instructorId: null },
    });
  });

  it("rejects Students, distinguishes forbidden and deleted courses, and rechecks ownership", () => {
    expect(getPurchaseTotal({ userId: base.user.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const anotherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(anotherInstructor.id, "Other Course");
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: otherCourse.id })
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: 99999 })
    ).toEqual({ ok: false, error: "not_found" });

    testDb
      .update(schema.courses)
      .set({ instructorId: anotherInstructor.id })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: base.course.id })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns a successful empty result for an Instructor with no courses", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    testDb
      .delete(schema.courses)
      .where(eq(schema.courses.id, base.course.id))
      .run();
    expect(getPurchaseTotal({ userId: otherInstructor.id })).toMatchObject({
      ok: true,
      purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
    });
  });
});

describe("analyticsService Enrollment Count", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("filters period boundaries before counting unique student-course relationships", () => {
    const secondCourse = createCourse(
      base.instructor.id,
      "Second Analytics Course"
    );
    testDb
      .insert(schema.enrollments)
      .values([
        {
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2025-03-01T00:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2025-03-10T00:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: base.course.id,
          enrolledAt: "2025-03-10T00:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: secondCourse.id,
          enrolledAt: "2025-03-05T00:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: secondCourse.id,
          enrolledAt: "2025-03-15T00:00:00.000Z",
        },
      ])
      .run();

    expect(
      getAnalyticsOverview({
        userId: base.instructor.id,
        start: "2025-03-05T00:00:00.000Z",
        end: "2025-03-15T00:00:00.000Z",
      })
    ).toMatchObject({
      ok: true,
      enrollmentCount: { state: "value", value: 2 },
    });
  });

  it("keeps Purchase Total available when the enrollment read fails", () => {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 1250,
        createdAt: "2025-03-10T00:00:00.000Z",
      })
      .run();
    testDb.$client.exec(
      "ALTER TABLE enrollments RENAME TO unavailable_enrollments"
    );

    const result = getAnalyticsOverview({ userId: base.instructor.id });

    expect(result).toMatchObject({
      ok: true,
      purchaseTotal: { state: "value", value: 1250 },
      enrollmentCount: { state: "error", reason: "read_failed" },
    });
    expect(Date.parse(result.ok ? result.asOf : "")).not.toBeNaN();
  });

  it("keeps Enrollment Count available when the purchase read fails", () => {
    testDb
      .insert(schema.enrollments)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2025-03-10T00:00:00.000Z",
      })
      .run();
    testDb.$client.exec(
      "ALTER TABLE purchases RENAME TO unavailable_purchases"
    );

    expect(getAnalyticsOverview({ userId: base.instructor.id })).toMatchObject({
      ok: true,
      purchaseTotal: { state: "error", reason: "read_failed" },
      enrollmentCount: { state: "value", value: 1 },
    });
  });

  it("returns a successful no-course state and rejects Students for both operations", () => {
    const instructorWithoutCourses = testDb
      .insert(schema.users)
      .values({
        name: "Empty Instructor",
        email: "empty-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();

    expect(
      getAnalyticsOverview({ userId: instructorWithoutCourses.id })
    ).toMatchObject({
      ok: true,
      purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
      enrollmentCount: { state: "empty", reason: "no_authorized_courses" },
    });
    expect(getAnalyticsOverview({ userId: base.user.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      getAnalyticsMetric({ userId: base.user.id, metric: "enrollmentCount" })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("retries only the requested enrollment metric and rechecks its scope", () => {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    testDb.$client.exec(
      "ALTER TABLE purchases RENAME TO unavailable_purchases"
    );

    const result = getAnalyticsMetric({
      userId: base.instructor.id,
      metric: "enrollmentCount",
    });

    expect(result).toMatchObject({
      ok: true,
      metric: "enrollmentCount",
      result: { state: "value", value: 1 },
    });
    expect(result.ok && "purchaseTotal" in result).toBe(false);
  });

  it("blocks an explicit foreign course in overview and retry after ownership changes", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(
      otherInstructor.id,
      "Other Analytics Course"
    );
    testDb
      .insert(schema.enrollments)
      .values({
        userId: base.user.id,
        courseId: otherCourse.id,
        enrolledAt: "2025-03-01T00:00:00.000Z",
      })
      .run();

    expect(
      getAnalyticsOverview({
        userId: base.instructor.id,
        courseId: otherCourse.id,
      })
    ).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      getAnalyticsMetric({
        userId: base.instructor.id,
        courseId: otherCourse.id,
        metric: "enrollmentCount",
      })
    ).toEqual({ ok: false, error: "forbidden" });

    testDb
      .update(schema.courses)
      .set({ instructorId: base.instructor.id })
      .where(eq(schema.courses.id, otherCourse.id))
      .run();

    expect(
      getAnalyticsOverview({
        userId: base.instructor.id,
        courseId: otherCourse.id,
      })
    ).toMatchObject({
      ok: true,
      enrollmentCount: { state: "value", value: 1 },
    });
    expect(
      getAnalyticsMetric({
        userId: base.instructor.id,
        courseId: otherCourse.id,
        metric: "enrollmentCount",
      })
    ).toMatchObject({
      ok: true,
      result: { state: "value", value: 1 },
    });
  });
});
