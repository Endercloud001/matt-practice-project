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
  getStudentQuizAverage,
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

function createQuiz(lessonId: number, title: string) {
  return testDb
    .insert(schema.quizzes)
    .values({ lessonId, title, passingScore: 0.7 })
    .returning()
    .get();
}

function attempt(options: {
  userId: number;
  quizId: number;
  score: number;
  attemptedAt?: string;
}) {
  testDb
    .insert(schema.quizAttempts)
    .values({
      userId: options.userId,
      quizId: options.quizId,
      score: options.score,
      passed: options.score >= 0.7,
      attemptedAt: options.attemptedAt ?? "2025-03-10T00:00:00.000Z",
    })
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

describe("analyticsService quiz outcomes", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("computes a student's best attempt average within the authorized period", () => {
    const lessons = createLessons({ courseId: base.course.id, count: 2 });
    const quizA = createQuiz(lessons[0].id, "Student Quiz A");
    const quizB = createQuiz(lessons[1].id, "Student Quiz B");
    attempt({
      userId: base.user.id,
      quizId: quizA.id,
      score: 0.4,
      attemptedAt: "2026-09-02T00:00:00.000Z",
    });
    attempt({
      userId: base.user.id,
      quizId: quizA.id,
      score: 0.8,
      attemptedAt: "2026-09-03T00:00:00.000Z",
    });
    attempt({
      userId: base.user.id,
      quizId: quizB.id,
      score: 0.6,
      attemptedAt: "2026-09-03T00:00:00.000Z",
    });
    expect(
      getStudentQuizAverage({
        userId: base.instructor.id,
        courseId: base.course.id,
        studentId: base.user.id,
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-04T00:00:00.000Z",
      })
    ).toEqual({ ok: true, result: { state: "value", value: 0.7 } });
  });

  it("returns empty for a student with no in-period attempts and forbids another instructor", () => {
    const lessons = createLessons({ courseId: base.course.id, count: 1 });
    createQuiz(lessons[0].id, "Empty Student Quiz");
    expect(
      getStudentQuizAverage({
        userId: base.instructor.id,
        courseId: base.course.id,
        studentId: base.user.id,
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-02T00:00:00.000Z",
      })
    ).toEqual({ ok: true, result: { state: "empty", reason: "no_attempts" } });
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    expect(
      getStudentQuizAverage({
        userId: other.id,
        courseId: base.course.id,
        studentId: base.user.id,
      })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("averages quizzes equally after selecting each student's best attempt and deduplicates participants", () => {
    const lessons = createLessons({ courseId: base.course.id, count: 2 });
    const quizA = createQuiz(lessons[0].id, "Quiz A");
    const quizB = createQuiz(lessons[1].id, "Quiz B");
    const secondStudent = createStudent("Second Student");

    // Quiz A has one participant at 100%; Quiz B has three participants at 0%.
    // The expected quiz average is (1 + 0) / 2 = 0.5, independent of student counts.
    attempt({ userId: base.user.id, quizId: quizA.id, score: 0.6 });
    attempt({ userId: base.user.id, quizId: quizA.id, score: 1 });
    attempt({ userId: base.user.id, quizId: quizB.id, score: 0 });
    attempt({ userId: secondStudent.id, quizId: quizB.id, score: 0 });
    attempt({ userId: base.instructor.id, quizId: quizB.id, score: 0 });

    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: base.course.id,
      })
    ).toMatchObject({
      averageBestAttemptQuizScore: { state: "value", value: 0.5 },
      participatingStudents: { state: "value", value: 3 },
      quizCount: { state: "value", value: 2 },
    });
  });

  it("filters attempts by attemptedAt and ignores an out-of-period higher score", () => {
    const [lesson] = createLessons({ courseId: base.course.id, count: 1 });
    const quiz = createQuiz(lesson.id, "Period Quiz");
    attempt({
      userId: base.user.id,
      quizId: quiz.id,
      score: 1,
      attemptedAt: "2025-02-28T23:59:59.999Z",
    });
    attempt({
      userId: base.user.id,
      quizId: quiz.id,
      score: 0.4,
      attemptedAt: "2025-03-01T00:00:00.000Z",
    });
    attempt({
      userId: base.user.id,
      quizId: quiz.id,
      score: 0.8,
      attemptedAt: "2025-03-10T00:00:00.000Z",
    });

    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: base.course.id,
        start: "2025-03-01T00:00:00.000Z",
        end: "2025-03-10T00:00:00.000Z",
      })
    ).toMatchObject({
      averageBestAttemptQuizScore: { state: "value", value: 0.4 },
      participatingStudents: { state: "value", value: 1 },
    });
  });

  it("distinguishes no quizzes, no in-period attempts, and a genuine zero score", () => {
    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: base.course.id,
      })
    ).toMatchObject({
      averageBestAttemptQuizScore: {
        state: "unavailable",
        reason: "no_quizzes",
      },
      participatingStudents: { state: "empty", reason: "no_records" },
      quizCount: { state: "value", value: 0 },
    });

    const [lesson] = createLessons({ courseId: base.course.id, count: 1 });
    const quiz = createQuiz(lesson.id, "Empty Quiz");
    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: base.course.id,
      })
    ).toMatchObject({
      averageBestAttemptQuizScore: { state: "empty", reason: "no_attempts" },
      participatingStudents: { state: "empty", reason: "no_records" },
      quizCount: { state: "value", value: 1 },
    });

    attempt({ userId: base.user.id, quizId: quiz.id, score: 0 });
    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: base.course.id,
      })
    ).toMatchObject({
      averageBestAttemptQuizScore: { state: "value", value: 0 },
      participatingStudents: { state: "value", value: 1 },
    });
  });

  it("enforces course authorization for quiz outcomes while allowing Admin access", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const foreignCourse = createCourse(otherInstructor.id, "Foreign Course");
    const [lesson] = createLessons({ courseId: foreignCourse.id, count: 1 });
    const quiz = createQuiz(lesson.id, "Foreign Quiz");
    attempt({ userId: base.user.id, quizId: quiz.id, score: 0.9 });

    expect(
      getCourseAnalytics({
        userId: base.instructor.id,
        courseId: foreignCourse.id,
      })
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      getCourseAnalytics({
        userId: createAdmin().id,
        courseId: foreignCourse.id,
      })
    ).toMatchObject({
      ok: true,
      averageBestAttemptQuizScore: { state: "value", value: 0.9 },
      participatingStudents: { state: "value", value: 1 },
    });
  });
});

describe("analyticsService course summaries", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("paginates authorized courses by title then id while keeping overview totals scoped to all courses", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "summaries-other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const foreignCourse = createCourse(otherInstructor.id, "A Foreign Course");
    const sameTitleCourses = Array.from({ length: 21 }, (_, index) =>
      createCourse(
        base.instructor.id,
        index < 2
          ? `A Shared Course ${index}`
          : `Course ${String(index).padStart(2, "0")}`
      )
    );
    testDb
      .update(schema.courses)
      .set({ title: "A Shared Course" })
      .where(eq(schema.courses.id, sameTitleCourses[0].id))
      .run();
    testDb
      .update(schema.courses)
      .set({ title: "A Shared Course" })
      .where(eq(schema.courses.id, sameTitleCourses[1].id))
      .run();
    purchase(sameTitleCourses[20].id, 2500, "2025-03-01T00:00:00.000Z");
    purchase(foreignCourse.id, 9000, "2025-03-01T00:00:00.000Z");

    const first = getAnalyticsOverview({
      userId: base.instructor.id,
      coursePage: 1,
    });
    const second = getAnalyticsOverview({
      userId: base.instructor.id,
      coursePage: 2,
    });

    expect(first).toMatchObject({
      ok: true,
      courseSummaries: { page: 1, pageSize: 20, totalCount: 22, totalPages: 2 },
      purchaseTotal: { state: "value", value: 2500 },
    });
    expect(second).toMatchObject({
      ok: true,
      courseSummaries: { page: 2, pageSize: 20, totalCount: 22, totalPages: 2 },
      purchaseTotal: { state: "value", value: 2500 },
    });
    if (!first.ok || !second.ok)
      throw new Error("Expected authorized analytics");
    expect(first.courseSummaries.rows).toHaveLength(20);
    expect(second.courseSummaries.rows).toHaveLength(2);
    expect(first.courseSummaries.rows.slice(0, 2).map((row) => row.id)).toEqual(
      sameTitleCourses.slice(0, 2).map((course) => course.id)
    );
    expect(
      new Set(
        [...first.courseSummaries.rows, ...second.courseSummaries.rows].map(
          (row) => row.id
        )
      ).size
    ).toBe(22);
    expect(second.courseSummaries.rows.map((row) => row.id)).not.toContain(
      foreignCourse.id
    );
    expect(JSON.stringify(first.courseSummaries)).not.toContain(
      base.user.email
    );
  });

  it("uses period-filtered distinct enrollments and course lessons for each row", () => {
    const otherCourse = createCourse(base.instructor.id, "Second Summary");
    const [firstLesson, secondLesson] = createLessons({
      courseId: base.course.id,
      count: 2,
    });
    createLessons({ courseId: otherCourse.id, count: 1 });
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
          enrolledAt: "2025-03-02T00:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: otherCourse.id,
          enrolledAt: "2025-02-28T23:59:59.999Z",
        },
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
      ])
      .run();
    purchase(base.course.id, 0, "2025-03-01T00:00:00.000Z");
    purchase(otherCourse.id, 500, "2025-03-10T00:00:00.000Z");

    const result = getAnalyticsOverview({
      userId: base.instructor.id,
      start: "2025-03-01T00:00:00.000Z",
      end: "2025-03-10T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      ok: true,
      purchaseTotal: { state: "value", value: 0 },
      enrollmentCount: { state: "value", value: 1 },
      studentProgress: { state: "value", value: 50 },
    });
    if (!result.ok) throw new Error("Expected authorized analytics");
    expect(
      result.courseSummaries.rows.find((row) => row.id === base.course.id)
    ).toMatchObject({
      purchaseTotal: { state: "value", value: 0 },
      enrollmentCount: { state: "value", value: 1 },
      studentProgress: { state: "value", value: 50 },
    });
    expect(
      result.courseSummaries.rows.find((row) => row.id === otherCourse.id)
    ).toMatchObject({
      purchaseTotal: { state: "empty", reason: "no_records" },
      enrollmentCount: { state: "empty", reason: "no_records" },
      studentProgress: { state: "empty", reason: "no_records" },
    });
  });

  it("keeps sibling row metrics available when purchases cannot be read", () => {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    testDb.$client.exec(
      "ALTER TABLE purchases RENAME TO unavailable_purchases"
    );

    const result = getAnalyticsOverview({ userId: base.instructor.id });

    expect(result).toMatchObject({
      ok: true,
      courseSummaries: {
        rows: [
          {
            purchaseTotal: { state: "error", reason: "read_failed" },
            enrollmentCount: { state: "value", value: 1 },
            studentProgress: { state: "unavailable", reason: "no_lessons" },
          },
        ],
      },
    });
  });

  it("returns empty rows after the last page and rejects invalid numeric pages", () => {
    expect(
      getAnalyticsOverview({ userId: base.instructor.id, coursePage: 3 })
    ).toMatchObject({
      ok: true,
      courseSummaries: { page: 3, totalPages: 1, totalCount: 1, rows: [] },
    });
    expect(
      getAnalyticsOverview({ userId: base.instructor.id, coursePage: 0 })
    ).toEqual({
      ok: false,
      error: "invalid_page",
    });
    expect(
      getAnalyticsOverview({ userId: base.instructor.id, coursePage: 1.5 })
    ).toEqual({
      ok: false,
      error: "invalid_page",
    });
  });
});
