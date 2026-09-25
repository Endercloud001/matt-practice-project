import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  quizzes,
  quizAttempts,
  purchases,
  users,
  LessonProgressStatus,
  UserRole,
} from "~/db/schema";

type PurchaseTotalOptions = {
  userId: number;
  instructorId?: number;
  courseId?: number;
  start?: string;
  end?: string;
};

export type PurchaseTotalResult =
  | {
      ok: true;
      asOf: string;
      timezone: "UTC";
      currency: "USD";
      locale: "en-US";
      filters: { instructorId: number | null; courseId: number | null };
      purchaseTotal:
        | { state: "value"; cents: number }
        | { state: "empty"; reason: "no_purchases" | "no_authorized_courses" };
    }
  | { ok: false; error: "forbidden" | "not_found" };

export type AnalyticsOverviewOptions = PurchaseTotalOptions & {
  coursePage?: number;
  studentPage?: number;
};

export type AnalyticsMetric<T> =
  | { state: "value"; value: T }
  | {
      state: "empty";
      reason: "no_records" | "no_authorized_courses" | "no_attempts";
    }
  | {
      state: "unavailable";
      reason: "missing_source_data" | "no_lessons" | "no_quizzes";
    }
  | { state: "error"; reason: "read_failed" };

export const analyticsMetricNames = [
  "purchaseTotal",
  "enrollmentCount",
  "studentProgress",
  "retentionRate",
  "netRevenue",
  "averageBestAttemptQuizScore",
  "participatingStudents",
  "quizCount",
] as const;
export type AnalyticsMetricName = (typeof analyticsMetricNames)[number];

export type CourseSummary = {
  id: number;
  title: string;
  purchaseTotal: AnalyticsMetric<number>;
  enrollmentCount: AnalyticsMetric<number>;
  studentProgress: AnalyticsMetric<number>;
};

export type CourseSummaries = {
  rows: CourseSummary[];
  page: number;
  pageSize: 20;
  totalCount: number;
  totalPages: number;
};

export type StudentSnapshots = {
  course: { id: number; title: string };
  rows: {
    id: number;
    name: string;
    email: string;
    enrolledAt: string;
    studentProgress: AnalyticsMetric<number>;
    quizAverage: AnalyticsMetric<number>;
  }[];
  page: number;
  pageSize: 20;
  totalCount: number;
  totalPages: number;
};

type AnalyticsOverviewMetricsResult =
  | {
      ok: true;
      asOf: string;
      timezone: "UTC";
      currency: "USD";
      locale: "en-US";
      filters: { instructorId: number | null; courseId: number | null };
      purchaseTotal: AnalyticsMetric<number>;
      enrollmentCount: AnalyticsMetric<number>;
      studentProgress: AnalyticsMetric<number>;
      retentionRate: AnalyticsMetric<number>;
      netRevenue: AnalyticsMetric<number>;
    }
  | { ok: false; error: "forbidden" | "not_found" };

type AnalyticsOverviewSuccess = Extract<
  AnalyticsOverviewMetricsResult,
  { ok: true }
>;

export type AnalyticsOverviewResult =
  | (AnalyticsOverviewSuccess & {
      courseSummaries: CourseSummaries;
      studentSnapshots?: StudentSnapshots;
    })
  | { ok: false; error: "forbidden" | "not_found" | "invalid_page" };

export type CourseAnalyticsResult =
  | (AnalyticsOverviewSuccess & {
      course: { id: number; title: string };
      averageBestAttemptQuizScore: AnalyticsMetric<number>;
      participatingStudents: AnalyticsMetric<number>;
      quizCount: AnalyticsMetric<number>;
      studentSnapshots: StudentSnapshots;
    })
  | { ok: false; error: "forbidden" | "not_found" | "invalid_page" };

export type AnalyticsMetricResult =
  | {
      ok: true;
      asOf: string;
      metric: AnalyticsMetricName;
      result: AnalyticsMetric<number>;
    }
  | { ok: false; error: "forbidden" | "not_found" };

export type AnalyticsFilterOptionsResult =
  | {
      ok: true;
      courses: { id: number; title: string }[];
      instructors: { id: number; name: string }[];
    }
  | { ok: false; error: "forbidden" };

export function getAnalyticsFilterOptions(options: {
  userId: number;
  instructorId?: number;
}): AnalyticsFilterOptionsResult {
  return db.transaction((tx) => {
    const viewer = tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, options.userId))
      .get();
    if (!viewer || !canViewAnalytics(viewer.role))
      return { ok: false, error: "forbidden" };

    const selectedInstructorId =
      viewer.role === UserRole.Instructor
        ? options.userId
        : options.instructorId;
    const authorizedCourses = tx
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(
        selectedInstructorId === undefined
          ? undefined
          : eq(courses.instructorId, selectedInstructorId)
      )
      .all();
    const instructors =
      viewer.role === UserRole.Admin
        ? tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.role, UserRole.Instructor))
            .all()
        : [];
    return { ok: true, courses: authorizedCourses, instructors };
  });
}

function canViewAnalytics(role: string | undefined) {
  return role === UserRole.Instructor || role === UserRole.Admin;
}

function canViewCourse(options: {
  role: string;
  viewerId: number;
  courseInstructorId: number;
  selectedInstructorId?: number;
}) {
  if (options.role === UserRole.Instructor) {
    return options.courseInstructorId === options.viewerId;
  }
  return (
    options.selectedInstructorId === undefined ||
    options.courseInstructorId === options.selectedInstructorId
  );
}

type AnalyticsTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type AuthorizedAnalyticsScope =
  | {
      ok: true;
      role: UserRole;
      courses: { id: number; title: string }[];
    }
  | { ok: false; error: "forbidden" | "not_found" };

function getAuthorizedScope(
  tx: AnalyticsTransaction,
  options: PurchaseTotalOptions
): AuthorizedAnalyticsScope {
  const viewer = tx
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, options.userId))
    .get();
  if (!viewer || !canViewAnalytics(viewer.role))
    return { ok: false, error: "forbidden" };

  if (options.courseId !== undefined) {
    const requestedCourse = tx
      .select({ id: courses.id, instructorId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, options.courseId))
      .get();
    if (!requestedCourse) return { ok: false, error: "not_found" };
    if (
      !canViewCourse({
        role: viewer.role,
        viewerId: options.userId,
        courseInstructorId: requestedCourse.instructorId,
        selectedInstructorId: options.instructorId,
      })
    ) {
      return { ok: false, error: "forbidden" };
    }
  }

  const conditions = [];
  if (viewer.role === UserRole.Instructor)
    conditions.push(eq(courses.instructorId, options.userId));
  if (viewer.role === UserRole.Admin && options.instructorId !== undefined)
    conditions.push(eq(courses.instructorId, options.instructorId));
  if (options.courseId !== undefined)
    conditions.push(eq(courses.id, options.courseId));
  return {
    ok: true,
    role: viewer.role,
    courses: tx
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(conditions.length ? and(...conditions) : undefined)
      .all(),
  };
}

function readPurchaseCents(
  tx: AnalyticsTransaction,
  options: { courseIds: number[]; start?: string; end?: string }
) {
  const conditions = [inArray(purchases.courseId, options.courseIds)];
  if (options.start) conditions.push(gte(purchases.createdAt, options.start));
  if (options.end) conditions.push(lt(purchases.createdAt, options.end));
  return tx
    .select({ cents: sql<number>`sum(${purchases.pricePaid})` })
    .from(purchases)
    .where(and(...conditions))
    .get()?.cents;
}

function readEnrollmentCount(
  tx: AnalyticsTransaction,
  options: { courseIds: number[]; start?: string; end?: string }
) {
  const conditions = [inArray(enrollments.courseId, options.courseIds)];
  if (options.start)
    conditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end) conditions.push(lt(enrollments.enrolledAt, options.end));
  return tx
    .select({ userId: enrollments.userId, courseId: enrollments.courseId })
    .from(enrollments)
    .where(and(...conditions))
    .groupBy(enrollments.userId, enrollments.courseId)
    .all().length;
}

function readStudentProgress(
  tx: AnalyticsTransaction,
  options: { courseIds: number[]; start?: string; end?: string }
): AnalyticsMetric<number> {
  const enrollmentConditions = [
    inArray(enrollments.courseId, options.courseIds),
  ];
  if (options.start)
    enrollmentConditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end)
    enrollmentConditions.push(lt(enrollments.enrolledAt, options.end));

  const eligibleEnrollments = tx
    .select({ userId: enrollments.userId, courseId: enrollments.courseId })
    .from(enrollments)
    .where(and(...enrollmentConditions))
    .groupBy(enrollments.userId, enrollments.courseId)
    .all();
  if (eligibleEnrollments.length === 0) {
    return { state: "empty", reason: "no_records" };
  }

  const lessonCounts = tx
    .select({
      courseId: modules.courseId,
      count: sql<number>`count(${lessons.id})`,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, options.courseIds))
    .groupBy(modules.courseId)
    .all();
  const lessonCountByCourse = new Map(
    lessonCounts.map((row) => [row.courseId, row.count])
  );
  const possibleLessonCount = eligibleEnrollments.reduce(
    (total, enrollment) =>
      total + (lessonCountByCourse.get(enrollment.courseId) ?? 0),
    0
  );
  if (possibleLessonCount === 0) {
    return { state: "unavailable", reason: "no_lessons" };
  }

  const completionConditions = [
    inArray(modules.courseId, options.courseIds),
    eq(lessonProgress.status, LessonProgressStatus.Completed),
  ];
  if (options.start)
    completionConditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end)
    completionConditions.push(lt(enrollments.enrolledAt, options.end));
  const completedLessonCount = tx
    .select({
      userId: lessonProgress.userId,
      courseId: modules.courseId,
      lessonId: lessonProgress.lessonId,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, modules.courseId)
      )
    )
    .where(and(...completionConditions))
    .groupBy(lessonProgress.userId, modules.courseId, lessonProgress.lessonId)
    .all().length;

  return {
    state: "value",
    value: (completedLessonCount / possibleLessonCount) * 100,
  };
}

type QuizAnalytics = {
  averageBestAttemptQuizScore: AnalyticsMetric<number>;
  participatingStudents: AnalyticsMetric<number>;
  quizCount: AnalyticsMetric<number>;
};

export type StudentQuizAverageResult =
  | { ok: true; result: AnalyticsMetric<number> }
  | { ok: false; error: "forbidden" | "not_found" };

function readQuizAnalytics(
  tx: AnalyticsTransaction,
  options: { courseIds: number[]; start?: string; end?: string }
): QuizAnalytics {
  const quizRows = tx
    .select({ quizId: quizzes.id })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, options.courseIds))
    .all();
  const quizCount = quizRows.length;
  if (quizCount === 0) {
    return {
      averageBestAttemptQuizScore: {
        state: "unavailable",
        reason: "no_quizzes",
      },
      participatingStudents: { state: "empty", reason: "no_records" },
      quizCount: { state: "value", value: 0 },
    };
  }
  const conditions = [
    inArray(
      quizAttempts.quizId,
      quizRows.map((row) => row.quizId)
    ),
  ];
  if (options.start)
    conditions.push(gte(quizAttempts.attemptedAt, options.start));
  if (options.end) conditions.push(lt(quizAttempts.attemptedAt, options.end));
  const attempts = tx
    .select({
      userId: quizAttempts.userId,
      quizId: quizAttempts.quizId,
      score: sql<number>`max(${quizAttempts.score})`,
    })
    .from(quizAttempts)
    .where(and(...conditions))
    .groupBy(quizAttempts.userId, quizAttempts.quizId)
    .all();
  if (attempts.length === 0) {
    return {
      averageBestAttemptQuizScore: { state: "empty", reason: "no_attempts" },
      participatingStudents: { state: "empty", reason: "no_records" },
      quizCount: { state: "value", value: quizCount },
    };
  }
  const students = new Set<number>();
  for (const attempt of attempts) {
    students.add(attempt.userId);
  }
  const byQuiz = new Map<number, number[]>();
  for (const { quizId, score } of attempts) {
    const values = byQuiz.get(quizId) ?? [];
    values.push(score);
    byQuiz.set(quizId, values);
  }
  const quizMeans = [...byQuiz.values()].map(
    (scores) => scores.reduce((a, b) => a + b, 0) / scores.length
  );
  return {
    averageBestAttemptQuizScore: {
      state: "value",
      value: quizMeans.reduce((a, b) => a + b, 0) / quizMeans.length,
    },
    participatingStudents: { state: "value", value: students.size },
    quizCount: { state: "value", value: quizCount },
  };
}

function readStudentQuizAverage(
  tx: AnalyticsTransaction,
  options: { courseId: number; studentId: number; start?: string; end?: string }
): AnalyticsMetric<number> {
  const quizRows = tx
    .select({ quizId: quizzes.id })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, options.courseId))
    .all();
  if (quizRows.length === 0)
    return { state: "unavailable", reason: "no_quizzes" };
  const conditions = [
    eq(quizAttempts.userId, options.studentId),
    inArray(
      quizAttempts.quizId,
      quizRows.map((row) => row.quizId)
    ),
  ];
  if (options.start)
    conditions.push(gte(quizAttempts.attemptedAt, options.start));
  if (options.end) conditions.push(lt(quizAttempts.attemptedAt, options.end));
  const rows = tx
    .select({ score: sql<number>`max(${quizAttempts.score})` })
    .from(quizAttempts)
    .where(and(...conditions))
    .groupBy(quizAttempts.quizId)
    .all();
  if (rows.length === 0) return { state: "empty", reason: "no_attempts" };
  return {
    state: "value",
    value: rows.reduce((sum, row) => sum + row.score, 0) / rows.length,
  };
}

export function getStudentQuizAverage(options: {
  userId: number;
  courseId: number;
  studentId: number;
  start?: string;
  end?: string;
}): StudentQuizAverageResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    if (!scope.courses.some((course) => course.id === options.courseId))
      return { ok: false, error: "forbidden" };
    return {
      ok: true,
      result: readStudentQuizAverage(tx, {
        courseId: options.courseId,
        studentId: options.studentId,
        start: options.start,
        end: options.end,
      }),
    };
  });
}

export function getAnalyticsMetric(options: {
  userId: number;
  metric: AnalyticsMetricName;
  instructorId?: number;
  courseId?: number;
  start?: string;
  end?: string;
}): AnalyticsMetricResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    const asOf = new Date().toISOString();

    if (options.metric === "retentionRate" || options.metric === "netRevenue") {
      return {
        ok: true,
        asOf,
        metric: options.metric,
        result: { state: "unavailable", reason: "missing_source_data" },
      };
    }

    if (scope.courses.length === 0) {
      return {
        ok: true,
        asOf,
        metric: options.metric,
        result: { state: "empty", reason: "no_authorized_courses" },
      };
    }

    if (
      options.metric === "averageBestAttemptQuizScore" ||
      options.metric === "participatingStudents" ||
      options.metric === "quizCount"
    ) {
      try {
        const quiz = readQuizAnalytics(tx, {
          courseIds: scope.courses.map((course) => course.id),
          start: options.start,
          end: options.end,
        });
        const result =
          options.metric === "averageBestAttemptQuizScore"
            ? quiz.averageBestAttemptQuizScore
            : options.metric === "participatingStudents"
              ? quiz.participatingStudents
              : quiz.quizCount;
        return { ok: true, asOf, metric: options.metric, result };
      } catch {
        return {
          ok: true,
          asOf,
          metric: options.metric,
          result: { state: "error", reason: "read_failed" },
        };
      }
    }

    try {
      const courseIds = scope.courses.map((course) => course.id);
      if (options.metric === "purchaseTotal") {
        const cents = readPurchaseCents(tx, {
          courseIds,
          start: options.start,
          end: options.end,
        });
        return {
          ok: true,
          asOf,
          metric: options.metric,
          result:
            cents === null || cents === undefined
              ? { state: "empty", reason: "no_records" }
              : { state: "value", value: cents },
        };
      }

      if (options.metric === "studentProgress") {
        return {
          ok: true,
          asOf,
          metric: options.metric,
          result: readStudentProgress(tx, {
            courseIds,
            start: options.start,
            end: options.end,
          }),
        };
      }

      const count = readEnrollmentCount(tx, {
        courseIds,
        start: options.start,
        end: options.end,
      });
      return {
        ok: true,
        asOf,
        metric: options.metric,
        result:
          count === 0
            ? { state: "empty", reason: "no_records" }
            : { state: "value", value: count },
      };
    } catch {
      return {
        ok: true,
        asOf,
        metric: options.metric,
        result: { state: "error", reason: "read_failed" },
      };
    }
  });
}

function readAnalyticsOverview(
  tx: AnalyticsTransaction,
  scope: Extract<AuthorizedAnalyticsScope, { ok: true }>,
  options: AnalyticsOverviewOptions
): AnalyticsOverviewSuccess {
  const asOf = new Date().toISOString();
  const filters = {
    instructorId:
      scope.role === UserRole.Admin ? (options.instructorId ?? null) : null,
    courseId: options.courseId ?? null,
  };
  const unavailable = {
    state: "unavailable",
    reason: "missing_source_data",
  } as const;

  if (scope.courses.length === 0) {
    return {
      ok: true,
      asOf,
      timezone: "UTC",
      currency: "USD",
      locale: "en-US",
      filters,
      purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
      enrollmentCount: { state: "empty", reason: "no_authorized_courses" },
      studentProgress: {
        state: "empty",
        reason: "no_authorized_courses",
      },
      retentionRate: unavailable,
      netRevenue: unavailable,
    };
  }

  const authorizedCourseIds = scope.courses.map((course) => course.id);

  let purchaseMetric: AnalyticsMetric<number>;
  try {
    const purchaseCents = readPurchaseCents(tx, {
      courseIds: authorizedCourseIds,
      start: options.start,
      end: options.end,
    });
    purchaseMetric =
      purchaseCents === null || purchaseCents === undefined
        ? { state: "empty", reason: "no_records" }
        : { state: "value", value: purchaseCents };
  } catch {
    purchaseMetric = { state: "error", reason: "read_failed" };
  }

  let enrollmentMetric: AnalyticsMetric<number>;
  try {
    const count = readEnrollmentCount(tx, {
      courseIds: authorizedCourseIds,
      start: options.start,
      end: options.end,
    });
    enrollmentMetric =
      count === 0
        ? { state: "empty", reason: "no_records" }
        : { state: "value", value: count };
  } catch {
    enrollmentMetric = { state: "error", reason: "read_failed" };
  }

  let studentProgressMetric: AnalyticsMetric<number>;
  try {
    studentProgressMetric = readStudentProgress(tx, {
      courseIds: authorizedCourseIds,
      start: options.start,
      end: options.end,
    });
  } catch {
    studentProgressMetric = { state: "error", reason: "read_failed" };
  }

  return {
    ok: true,
    asOf,
    timezone: "UTC",
    currency: "USD",
    locale: "en-US",
    filters,
    purchaseTotal: purchaseMetric,
    enrollmentCount: enrollmentMetric,
    studentProgress: studentProgressMetric,
    retentionRate: unavailable,
    netRevenue: unavailable,
  };
}

function readCourseSummaries(
  tx: AnalyticsTransaction,
  scope: Extract<AuthorizedAnalyticsScope, { ok: true }>,
  options: AnalyticsOverviewOptions
): CourseSummaries {
  const page = options.coursePage ?? 1;
  const pageSize = 20;
  const totalCount = scope.courses.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  if (totalCount === 0) {
    return { rows: [], page, pageSize, totalCount, totalPages };
  }

  const pageConditions = [];
  if (scope.role === UserRole.Instructor)
    pageConditions.push(eq(courses.instructorId, options.userId));
  if (scope.role === UserRole.Admin && options.instructorId !== undefined)
    pageConditions.push(eq(courses.instructorId, options.instructorId));
  if (options.courseId !== undefined)
    pageConditions.push(eq(courses.id, options.courseId));
  const pageCourses = tx
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(pageConditions.length ? and(...pageConditions) : undefined)
    .orderBy(asc(courses.title), asc(courses.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  if (pageCourses.length === 0) {
    return { rows: [], page, pageSize, totalCount, totalPages };
  }
  const courseIds = pageCourses.map((course) => course.id);
  const purchaseConditions = [inArray(purchases.courseId, courseIds)];
  if (options.start)
    purchaseConditions.push(gte(purchases.createdAt, options.start));
  if (options.end)
    purchaseConditions.push(lt(purchases.createdAt, options.end));
  const enrollmentConditions = [inArray(enrollments.courseId, courseIds)];
  if (options.start)
    enrollmentConditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end)
    enrollmentConditions.push(lt(enrollments.enrolledAt, options.end));
  const failed: AnalyticsMetric<number> = {
    state: "error",
    reason: "read_failed",
  };
  const empty: AnalyticsMetric<number> = {
    state: "empty",
    reason: "no_records",
  };

  let purchaseTotals: Map<number, number> | null = null;
  try {
    purchaseTotals = new Map(
      tx
        .select({
          courseId: purchases.courseId,
          cents: sql<number>`sum(${purchases.pricePaid})`,
        })
        .from(purchases)
        .where(and(...purchaseConditions))
        .groupBy(purchases.courseId)
        .all()
        .map((row) => [row.courseId, row.cents])
    );
  } catch {
    // Preserve other summaries when one metric cannot be read.
  }

  let enrollmentCounts: Map<number, number> | null = null;
  let eligibleEnrollments: { courseId: number; userId: number }[] | null = null;
  try {
    eligibleEnrollments = tx
      .select({ courseId: enrollments.courseId, userId: enrollments.userId })
      .from(enrollments)
      .where(and(...enrollmentConditions))
      .groupBy(enrollments.courseId, enrollments.userId)
      .all();
    enrollmentCounts = new Map();
    for (const row of eligibleEnrollments) {
      enrollmentCounts.set(
        row.courseId,
        (enrollmentCounts.get(row.courseId) ?? 0) + 1
      );
    }
  } catch {
    // Progress can still report its own read failure independently.
  }

  let progressByCourse: Map<number, AnalyticsMetric<number>> | null = null;
  if (eligibleEnrollments !== null) {
    try {
      const lessonCounts = new Map(
        tx
          .select({
            courseId: modules.courseId,
            count: sql<number>`count(${lessons.id})`,
          })
          .from(lessons)
          .innerJoin(modules, eq(lessons.moduleId, modules.id))
          .where(inArray(modules.courseId, courseIds))
          .groupBy(modules.courseId)
          .all()
          .map((row) => [row.courseId, row.count])
      );
      const completionConditions = [
        inArray(modules.courseId, courseIds),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
      ];
      if (options.start)
        completionConditions.push(gte(enrollments.enrolledAt, options.start));
      if (options.end)
        completionConditions.push(lt(enrollments.enrolledAt, options.end));
      const completions = tx
        .select({
          courseId: modules.courseId,
          userId: lessonProgress.userId,
          lessonId: lessonProgress.lessonId,
        })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .innerJoin(
          enrollments,
          and(
            eq(enrollments.userId, lessonProgress.userId),
            eq(enrollments.courseId, modules.courseId)
          )
        )
        .where(and(...completionConditions))
        .groupBy(
          modules.courseId,
          lessonProgress.userId,
          lessonProgress.lessonId
        )
        .all();
      const completedCounts = new Map<number, number>();
      for (const row of completions) {
        completedCounts.set(
          row.courseId,
          (completedCounts.get(row.courseId) ?? 0) + 1
        );
      }
      const possibleCounts = new Map<number, number>();
      for (const row of eligibleEnrollments) {
        possibleCounts.set(
          row.courseId,
          (possibleCounts.get(row.courseId) ?? 0) +
            (lessonCounts.get(row.courseId) ?? 0)
        );
      }
      progressByCourse = new Map();
      for (const course of pageCourses) {
        const enrolled = enrollmentCounts?.get(course.id) ?? 0;
        const possible = possibleCounts.get(course.id) ?? 0;
        progressByCourse.set(
          course.id,
          enrolled === 0
            ? empty
            : possible === 0
              ? { state: "unavailable", reason: "no_lessons" }
              : {
                  state: "value",
                  value:
                    ((completedCounts.get(course.id) ?? 0) / possible) * 100,
                }
        );
      }
    } catch {
      // A failed progress read does not hide purchases or enrollment counts.
    }
  }

  return {
    rows: pageCourses.map((course) => ({
      ...course,
      purchaseTotal:
        purchaseTotals === null
          ? failed
          : purchaseTotals.has(course.id)
            ? { state: "value", value: purchaseTotals.get(course.id) ?? 0 }
            : empty,
      enrollmentCount:
        enrollmentCounts === null
          ? failed
          : enrollmentCounts.has(course.id)
            ? { state: "value", value: enrollmentCounts.get(course.id) ?? 0 }
            : empty,
      studentProgress: progressByCourse?.get(course.id) ?? failed,
    })),
    page,
    pageSize,
    totalCount,
    totalPages,
  };
}

function readStudentSnapshots(
  tx: AnalyticsTransaction,
  course: StudentSnapshots["course"],
  options: AnalyticsOverviewOptions
): StudentSnapshots {
  const page = options.studentPage ?? 1;
  const conditions = [eq(enrollments.courseId, course.id)];
  if (options.start)
    conditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end) conditions.push(lt(enrollments.enrolledAt, options.end));
  const totalCount =
    tx
      .select({ count: sql<number>`count(distinct ${enrollments.userId})` })
      .from(enrollments)
      .where(and(...conditions))
      .get()?.count ?? 0;
  const enrolledAt = sql<string>`min(${enrollments.enrolledAt})`;
  const students = tx
    .select({ id: users.id, name: users.name, email: users.email, enrolledAt })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.userId, users.id))
    .where(and(...conditions))
    .groupBy(enrollments.userId, enrollments.courseId)
    .orderBy(desc(enrolledAt), asc(users.name), asc(users.id))
    .limit(20)
    .offset((page - 1) * 20)
    .all();
  const studentIds = students.map((student) => student.id);
  const progress = new Map<number, AnalyticsMetric<number>>();
  const quizAverages = new Map<number, AnalyticsMetric<number>>();
  const failed: AnalyticsMetric<number> = {
    state: "error",
    reason: "read_failed",
  };
  if (studentIds.length > 0) {
    try {
      const lessonCount =
        tx
          .select({ count: sql<number>`count(${lessons.id})` })
          .from(lessons)
          .innerJoin(modules, eq(lessons.moduleId, modules.id))
          .where(eq(modules.courseId, course.id))
          .get()?.count ?? 0;
      const completed = new Map(
        tx
          .select({
            userId: lessonProgress.userId,
            count: sql<number>`count(distinct ${lessonProgress.lessonId})`,
          })
          .from(lessonProgress)
          .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
          .innerJoin(modules, eq(lessons.moduleId, modules.id))
          .where(
            and(
              eq(modules.courseId, course.id),
              inArray(lessonProgress.userId, studentIds),
              eq(lessonProgress.status, LessonProgressStatus.Completed)
            )
          )
          .groupBy(lessonProgress.userId)
          .all()
          .map((row) => [row.userId, row.count])
      );
      for (const id of studentIds) {
        progress.set(
          id,
          lessonCount === 0
            ? { state: "unavailable", reason: "no_lessons" }
            : {
                state: "value",
                value: ((completed.get(id) ?? 0) / lessonCount) * 100,
              }
        );
      }
    } catch {
      // A failed progress read must not hide identities or quiz scores.
    }
    try {
      const courseQuizzes = tx
        .select({ id: quizzes.id })
        .from(quizzes)
        .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
        .innerJoin(modules, eq(lessons.moduleId, modules.id))
        .where(eq(modules.courseId, course.id))
        .all();
      if (courseQuizzes.length === 0) {
        for (const id of studentIds)
          quizAverages.set(id, { state: "unavailable", reason: "no_quizzes" });
      } else {
        const attemptConditions = [
          inArray(
            quizAttempts.quizId,
            courseQuizzes.map((quiz) => quiz.id)
          ),
          inArray(quizAttempts.userId, studentIds),
        ];
        if (options.start)
          attemptConditions.push(gte(quizAttempts.attemptedAt, options.start));
        if (options.end)
          attemptConditions.push(lt(quizAttempts.attemptedAt, options.end));
        const bestAttempts = tx
          .select({
            userId: quizAttempts.userId,
            score: sql<number>`max(${quizAttempts.score})`,
          })
          .from(quizAttempts)
          .where(and(...attemptConditions))
          .groupBy(quizAttempts.userId, quizAttempts.quizId)
          .all();
        const scores = new Map<number, { total: number; count: number }>();
        for (const attempt of bestAttempts) {
          const score = scores.get(attempt.userId) ?? { total: 0, count: 0 };
          score.total += attempt.score;
          score.count += 1;
          scores.set(attempt.userId, score);
        }
        for (const id of studentIds) {
          const score = scores.get(id);
          quizAverages.set(
            id,
            score
              ? { state: "value", value: score.total / score.count }
              : { state: "empty", reason: "no_attempts" }
          );
        }
      }
    } catch {
      // Preserve independent progress values when quiz reads fail.
    }
  }
  return {
    course,
    rows: students.map((student) => ({
      ...student,
      studentProgress: progress.get(student.id) ?? failed,
      quizAverage: quizAverages.get(student.id) ?? failed,
    })),
    page,
    pageSize: 20,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / 20)),
  };
}

export function getAnalyticsOverview(
  options: AnalyticsOverviewOptions
): AnalyticsOverviewResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    const page = options.coursePage ?? 1;
    const studentPage = options.studentPage ?? 1;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger((page - 1) * 20) ||
      !Number.isSafeInteger(studentPage) ||
      studentPage < 1 ||
      !Number.isSafeInteger((studentPage - 1) * 20)
    ) {
      return { ok: false, error: "invalid_page" };
    }
    return {
      ...readAnalyticsOverview(tx, scope, options),
      courseSummaries: readCourseSummaries(tx, scope, options),
      ...(options.courseId !== undefined && scope.courses[0]
        ? {
            studentSnapshots: readStudentSnapshots(
              tx,
              scope.courses[0],
              options
            ),
          }
        : {}),
    };
  });
}

export function getCourseAnalytics(
  options: AnalyticsOverviewOptions & { courseId: number }
): CourseAnalyticsResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    const course = scope.courses[0];
    if (!course) return { ok: false, error: "not_found" };
    const studentPage = options.studentPage ?? 1;
    if (
      !Number.isSafeInteger(studentPage) ||
      studentPage < 1 ||
      !Number.isSafeInteger((studentPage - 1) * 20)
    )
      return { ok: false, error: "invalid_page" };

    let quiz: QuizAnalytics;
    try {
      quiz = readQuizAnalytics(tx, {
        courseIds: [course.id],
        start: options.start,
        end: options.end,
      });
    } catch {
      const failed: AnalyticsMetric<number> = {
        state: "error",
        reason: "read_failed",
      };
      quiz = {
        averageBestAttemptQuizScore: failed,
        participatingStudents: failed,
        quizCount: failed,
      };
    }
    return {
      ...readAnalyticsOverview(tx, scope, options),
      course,
      ...quiz,
      studentSnapshots: readStudentSnapshots(tx, course, options),
    };
  });
}

export function getPurchaseTotal(
  options: PurchaseTotalOptions
): PurchaseTotalResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    const asOf = new Date().toISOString();

    if (scope.courses.length === 0) {
      return {
        ok: true,
        asOf,
        timezone: "UTC",
        currency: "USD",
        locale: "en-US",
        filters: {
          instructorId:
            scope.role === UserRole.Admin
              ? (options.instructorId ?? null)
              : null,
          courseId: options.courseId ?? null,
        },
        purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
      };
    }

    const total = readPurchaseCents(tx, {
      courseIds: scope.courses.map((course) => course.id),
      start: options.start,
      end: options.end,
    });

    return {
      ok: true,
      asOf,
      timezone: "UTC",
      currency: "USD",
      locale: "en-US",
      filters: {
        instructorId:
          scope.role === UserRole.Admin ? (options.instructorId ?? null) : null,
        courseId: options.courseId ?? null,
      },
      purchaseTotal:
        total === null || total === undefined
          ? { state: "empty", reason: "no_purchases" }
          : { state: "value", cents: total },
    };
  });
}
