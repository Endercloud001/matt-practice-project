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
  analyticsMetricNames,
  getCourseAnalytics,
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

function createStudent(name: string) {
  return testDb
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase().replaceAll(" ", "-")}@example.com`,
      role: schema.UserRole.Student,
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

function createLessons(options: { courseId: number; count: number }) {
  const courseModule = testDb
    .insert(schema.modules)
    .values({
      courseId: options.courseId,
      title: `Module ${options.courseId}`,
      position: 1,
    })
    .returning()
    .get();

  return testDb
    .insert(schema.lessons)
    .values(
      Array.from({ length: options.count }, (_, index) => ({
        moduleId: courseModule.id,
        title: `Lesson ${index + 1}`,
        position: index + 1,
      }))
    )
    .returning()
    .all();
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

describe("analyticsService Student Progress", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("pools student-lesson units across different course sizes at full precision", () => {
    const secondCourse = createCourse(base.instructor.id, "Larger Course");
    const firstLessons = createLessons({ courseId: base.course.id, count: 2 });
    const secondLessons = createLessons({
      courseId: secondCourse.id,
      count: 4,
    });
    testDb
      .insert(schema.enrollments)
      .values([
        { userId: base.user.id, courseId: base.course.id },
        { userId: base.user.id, courseId: secondCourse.id },
      ])
      .run();
    testDb
      .insert(schema.lessonProgress)
      .values([
        {
          userId: base.user.id,
          lessonId: firstLessons[0].id,
          status: schema.LessonProgressStatus.Completed,
        },
        {
          userId: base.user.id,
          lessonId: secondLessons[0].id,
          status: schema.LessonProgressStatus.Completed,
        },
      ])
      .run();

    const result = getAnalyticsOverview({ userId: base.instructor.id });

    expect(result).toMatchObject({
      ok: true,
      studentProgress: { state: "value" },
    });
    if (result.ok && result.studentProgress.state === "value") {
      expect(result.studentProgress.value).toBeCloseTo(100 / 3, 12);
      expect(result.studentProgress.value).not.toBe(33);
    }
  });

  it("returns course identity with its initial metrics in one authorized result", () => {
    const [lesson] = createLessons({ courseId: base.course.id, count: 1 });
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    testDb
      .insert(schema.lessonProgress)
      .values({
        userId: base.user.id,
        lessonId: lesson.id,
        status: schema.LessonProgressStatus.Completed,
      })
      .run();

    const result = getCourseAnalytics({
      userId: base.instructor.id,
      courseId: base.course.id,
    });

    expect(result).toMatchObject({
      ok: true,
      course: { id: base.course.id, title: base.course.title },
      filters: { courseId: base.course.id },
      enrollmentCount: { state: "value", value: 1 },
      studentProgress: { state: "value", value: 100 },
    });
    expect(Date.parse(result.ok ? result.asOf : "")).not.toBeNaN();
  });

  it("filters current enrollments by the period before deduplicating them", () => {
    const lessons = createLessons({ courseId: base.course.id, count: 2 });
    const prePeriodStudent = createStudent("Pre Period");
    const endBoundaryStudent = createStudent("End Boundary");
    const removedStudent = createStudent("Removed Student");
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
          enrolledAt: "2025-03-05T00:00:00.000Z",
        },
        {
          userId: prePeriodStudent.id,
          courseId: base.course.id,
          enrolledAt: "2025-02-28T23:59:59.999Z",
        },
        {
          userId: endBoundaryStudent.id,
          courseId: base.course.id,
          enrolledAt: "2025-03-10T00:00:00.000Z",
        },
      ])
      .run();
    const removedEnrollment = testDb
      .insert(schema.enrollments)
      .values({
        userId: removedStudent.id,
        courseId: base.course.id,
        enrolledAt: "2025-03-02T00:00:00.000Z",
      })
      .returning()
      .get();
    testDb
      .insert(schema.lessonProgress)
      .values([
        {
          userId: base.user.id,
          lessonId: lessons[0].id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: "2025-03-20T00:00:00.000Z",
        },
        ...[prePeriodStudent, endBoundaryStudent, removedStudent].flatMap(
          (student) =>
            lessons.map((lesson) => ({
              userId: student.id,
              lessonId: lesson.id,
              status: schema.LessonProgressStatus.Completed,
            }))
        ),
      ])
      .run();
    testDb
      .delete(schema.enrollments)
      .where(eq(schema.enrollments.id, removedEnrollment.id))
      .run();

    expect(
      getAnalyticsOverview({
        userId: base.instructor.id,
        start: "2025-03-01T00:00:00.000Z",
        end: "2025-03-10T00:00:00.000Z",
      })
    ).toMatchObject({
      studentProgress: { state: "value", value: 50 },
    });
  });

  it("counts each completed lesson once and only inside its actual course", () => {
    const [firstLesson, secondLesson] = createLessons({
      courseId: base.course.id,
      count: 2,
    });
    const otherCourse = createCourse(base.instructor.id, "Other Course");
    const [otherLesson] = createLessons({ courseId: otherCourse.id, count: 1 });
    testDb
      .insert(schema.enrollments)
      .values([
        { userId: base.user.id, courseId: base.course.id },
        { userId: base.user.id, courseId: base.course.id },
      ])
      .run();
    testDb
      .insert(schema.lessonProgress)
      .values([
        {
          userId: base.user.id,
          lessonId: firstLesson.id,
          status: schema.LessonProgressStatus.Completed,
        },
        {
          userId: base.user.id,
          lessonId: firstLesson.id,
          status: schema.LessonProgressStatus.Completed,
        },
        {
          userId: base.user.id,
          lessonId: secondLesson.id,
          status: schema.LessonProgressStatus.InProgress,
        },
        {
          userId: base.user.id,
          lessonId: otherLesson.id,
          status: schema.LessonProgressStatus.Completed,
        },
      ])
      .run();

    expect(
      getAnalyticsOverview({
        userId: base.instructor.id,
        courseId: base.course.id,
      })
    ).toMatchObject({ studentProgress: { state: "value", value: 50 } });
  });

  it("distinguishes no enrollments, no lessons, and genuine zero progress", () => {
    expect(getAnalyticsOverview({ userId: base.instructor.id })).toMatchObject({
      studentProgress: { state: "empty", reason: "no_records" },
    });

    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    expect(getAnalyticsOverview({ userId: base.instructor.id })).toMatchObject({
      studentProgress: { state: "unavailable", reason: "no_lessons" },
    });

    createLessons({ courseId: base.course.id, count: 1 });
    expect(getAnalyticsOverview({ userId: base.instructor.id })).toMatchObject({
      studentProgress: { state: "value", value: 0 },
    });
  });

  it("retries only Student progress and keeps local read failures safe", () => {
    createLessons({ courseId: base.course.id, count: 1 });
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    testDb.$client.exec(
      "ALTER TABLE lesson_progress RENAME TO unavailable_lesson_progress"
    );

    expect(getAnalyticsOverview({ userId: base.instructor.id })).toMatchObject({
      enrollmentCount: { state: "value", value: 1 },
      studentProgress: { state: "error", reason: "read_failed" },
    });
    const failedRetry = getAnalyticsMetric({
      userId: base.instructor.id,
      metric: "studentProgress",
    });
    expect(failedRetry).toMatchObject({
      ok: true,
      metric: "studentProgress",
      result: { state: "error", reason: "read_failed" },
    });
    expect(failedRetry.ok && "enrollmentCount" in failedRetry).toBe(false);

    testDb.$client.exec(
      "ALTER TABLE unavailable_lesson_progress RENAME TO lesson_progress"
    );
    expect(
      getAnalyticsMetric({
        userId: base.instructor.id,
        metric: "studentProgress",
      })
    ).toMatchObject({
      result: { state: "value", value: 0 },
    });
    expect(analyticsMetricNames).toContain("studentProgress");
  });

  it("reauthorizes course analytics for deletion, ownership changes, and Admin", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "course-owner@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(otherInstructor.id, "Private Course");

    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: otherCourse.id,
      })
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      getCourseAnalytics({
        userId: createAdmin().id,
        courseId: otherCourse.id,
      })
    ).toMatchObject({
      ok: true,
      course: { id: otherCourse.id, title: otherCourse.title },
    });

    testDb
      .update(schema.courses)
      .set({ instructorId: base.instructor.id })
      .where(eq(schema.courses.id, otherCourse.id))
      .run();
    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: otherCourse.id,
      })
    ).toMatchObject({ ok: true, course: { id: otherCourse.id } });

    testDb
      .delete(schema.courses)
      .where(eq(schema.courses.id, otherCourse.id))
      .run();
    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: otherCourse.id,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
