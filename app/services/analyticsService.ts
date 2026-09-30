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

export type StudentSnapshotMetricName = "studentProgress" | "quizAverage";

export type StudentSnapshotMetricResult =
  | (Omit<StudentSnapshots, "rows"> & {
      ok: true;
      asOf: string;
      metric: StudentSnapshotMetricName;
      rows: { id: number; result: AnalyticsMetric<number> }[];
    })
  | { ok: false; error: "forbidden" | "not_found" | "invalid_page" };

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
  return readEligibleEnrollments(tx, options).length;
}

type ProgressScope = { courseIds: number[]; start?: string; end?: string };
type EligibleEnrollment = { userId: number; courseId: number };

function readEligibleEnrollments(
  tx: AnalyticsTransaction,
  options: ProgressScope
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
    .all();
}

function readProgressLessonCounts(
  tx: AnalyticsTransaction,
  courseIds: number[]
) {
  return new Map(
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
}

// The roster scope already selected eligible students; aggregate scopes select
// Enrollment relationships in their date range without filtering completion dates.
function readProgressCompletions(
  tx: AnalyticsTransaction,
  options: ProgressScope | { courseIds: number[]; studentIds: number[] }
) {
  const conditions = [
    inArray(modules.courseId, options.courseIds),
    eq(lessonProgress.status, LessonProgressStatus.Completed),
  ];
  const query = tx
    .select({
      userId: lessonProgress.userId,
      courseId: modules.courseId,
      count: sql<number>`count(distinct ${lessonProgress.lessonId})`,
    })
    .from(lessonProgress)
    .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id));
  if ("studentIds" in options) {
    conditions.push(inArray(lessonProgress.userId, options.studentIds));
    return query
      .where(and(...conditions))
      .groupBy(lessonProgress.userId, modules.courseId)
      .all();
  }
  if (options.start)
    conditions.push(gte(enrollments.enrolledAt, options.start));
  if (options.end) conditions.push(lt(enrollments.enrolledAt, options.end));
  return query
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, lessonProgress.userId),
        eq(enrollments.courseId, modules.courseId)
      )
    )
    .where(and(...conditions))
    .groupBy(lessonProgress.userId, modules.courseId)
    .all();
}

function progressMetric(options: {
  hasEnrollments: boolean;
  possible: number;
  completed: number;
}): AnalyticsMetric<number> {
  if (!options.hasEnrollments) return { state: "empty", reason: "no_records" };
  if (options.possible === 0)
    return { state: "unavailable", reason: "no_lessons" };
  return {
    state: "value",
    value: (options.completed / options.possible) * 100,
  };
}

function possibleProgressLessons(options: {
  eligibleEnrollments: EligibleEnrollment[];
  lessonCounts: Map<number, number>;
}) {
  const counts = new Map<number, number>();
  for (const enrollment of options.eligibleEnrollments) {
    counts.set(
      enrollment.courseId,
      (counts.get(enrollment.courseId) ?? 0) +
        (options.lessonCounts.get(enrollment.courseId) ?? 0)
    );
  }
  return counts;
}

function readOverviewProgress(
  tx: AnalyticsTransaction,
  options: ProgressScope
): AnalyticsMetric<number> {
  const eligibleEnrollments = readEligibleEnrollments(tx, options);
  if (eligibleEnrollments.length === 0)
    return { state: "empty", reason: "no_records" };
  const possibleCounts = possibleProgressLessons({
    eligibleEnrollments,
    lessonCounts: readProgressLessonCounts(tx, options.courseIds),
  });
  const possible = [...possibleCounts.values()].reduce(
    (sum, count) => sum + count,
    0
  );
  // Overview has always resolved missing denominators before reading completions.
  if (possible === 0) return { state: "unavailable", reason: "no_lessons" };
  const completed = readProgressCompletions(tx, options).reduce(
    (sum, row) => sum + row.count,
    0
  );
  return progressMetric({
    hasEnrollments: true,
    possible,
    completed,
  });
}

function readCourseProgress(
  tx: AnalyticsTransaction,
  options: ProgressScope & {
    eligibleEnrollments: EligibleEnrollment[];
  }
) {
  const lessonCounts = readProgressLessonCounts(tx, options.courseIds);
  // Course and Student preserve read failures even for a missing denominator.
  const completions = readProgressCompletions(tx, options);
  const completedCounts = new Map<number, number>();
  for (const row of completions) {
    completedCounts.set(
      row.courseId,
      (completedCounts.get(row.courseId) ?? 0) + row.count
    );
  }
  const possibleCounts = possibleProgressLessons({
    eligibleEnrollments: options.eligibleEnrollments,
    lessonCounts,
  });
  return new Map(
    options.courseIds.map((id) => [
      id,
      progressMetric({
        hasEnrollments: possibleCounts.has(id),
        possible: possibleCounts.get(id) ?? 0,
        completed: completedCounts.get(id) ?? 0,
      }),
    ])
  );
}

function readStudentProgress(
  tx: AnalyticsTransaction,
  options: {
    courseId: number;
    studentIds: number[];
  }
) {
  const courseIds = [options.courseId];
  const lessonCount =
    readProgressLessonCounts(tx, courseIds).get(options.courseId) ?? 0;
  const completions = readProgressCompletions(tx, {
    courseIds,
    studentIds: options.studentIds,
  });
  const completedCounts = new Map(
    completions.map((row) => [row.userId, row.count])
  );
  return new Map(
    options.studentIds.map((id) => [
      id,
      progressMetric({
        hasEnrollments: true,
        possible: lessonCount,
        completed: completedCounts.get(id) ?? 0,
      }),
    ])
  );
}

type QuizAnalytics = {
  averageBestAttemptQuizScore: AnalyticsMetric<number>;
  participatingStudents: AnalyticsMetric<number>;
  quizCount: AnalyticsMetric<number>;
};

export type StudentQuizAverageResult =
  | { ok: true; result: AnalyticsMetric<number> }
  | { ok: false; error: "forbidden" | "not_found" };

function readCourseQuizzes(tx: AnalyticsTransaction, courseIds: number[]) {
  return tx
    .select({ quizId: quizzes.id })
    .from(quizzes)
    .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(inArray(modules.courseId, courseIds))
    .all();
}

function readQuizAnalytics(
  tx: AnalyticsTransaction,
  options: { courseIds: number[]; start?: string; end?: string }
): QuizAnalytics {
  const quizRows = readCourseQuizzes(tx, options.courseIds);
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
        const courseIds = scope.courses.map((course) => course.id);
        if (options.metric === "quizCount") {
          return {
            ok: true,
            asOf,
            metric: options.metric,
            result: {
              state: "value",
              value: readCourseQuizzes(tx, courseIds).length,
            },
          };
        }
        if (options.metric === "participatingStudents") {
          const conditions = [inArray(modules.courseId, courseIds)];
          if (options.start)
            conditions.push(gte(quizAttempts.attemptedAt, options.start));
          if (options.end)
            conditions.push(lt(quizAttempts.attemptedAt, options.end));
          const students = tx
            .selectDistinct({ userId: quizAttempts.userId })
            .from(quizAttempts)
            .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
            .innerJoin(lessons, eq(quizzes.lessonId, lessons.id))
            .innerJoin(modules, eq(lessons.moduleId, modules.id))
            .where(and(...conditions))
            .all();
          return {
            ok: true,
            asOf,
            metric: options.metric,
            result:
              students.length > 0
                ? { state: "value", value: students.length }
                : { state: "empty", reason: "no_records" },
          };
        }
        const quiz = readQuizAnalytics(tx, {
          courseIds,
          start: options.start,
          end: options.end,
        });
        const result = quiz.averageBestAttemptQuizScore;
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
          result: readOverviewProgress(tx, {
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
    studentProgressMetric = readOverviewProgress(tx, {
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
    eligibleEnrollments = readEligibleEnrollments(tx, {
      courseIds,
      start: options.start,
      end: options.end,
    });
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
      progressByCourse = readCourseProgress(tx, {
        courseIds,
        eligibleEnrollments,
        start: options.start,
        end: options.end,
      });
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
  options: AnalyticsOverviewOptions & { metric?: StudentSnapshotMetricName }
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
  let progress = new Map<number, AnalyticsMetric<number>>();
  const quizAverages = new Map<number, AnalyticsMetric<number>>();
  const failed: AnalyticsMetric<number> = {
    state: "error",
    reason: "read_failed",
  };
  if (studentIds.length > 0 && options.metric !== "quizAverage") {
    try {
      progress = readStudentProgress(tx, { courseId: course.id, studentIds });
    } catch {
      // A failed progress read must not hide identities or quiz scores.
    }
  }
  if (studentIds.length > 0 && options.metric !== "studentProgress") {
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

export function getStudentSnapshotMetric(
  options: PurchaseTotalOptions & {
    courseId: number;
    studentPage?: number;
    metric: StudentSnapshotMetricName;
  }
): StudentSnapshotMetricResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
    const course = scope.courses[0];
    if (!course) return { ok: false, error: "not_found" };
    const page = options.studentPage ?? 1;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger((page - 1) * 20)
    )
      return { ok: false, error: "invalid_page" };
    const asOf = new Date().toISOString();
    const { rows, ...pagination } = readStudentSnapshots(tx, course, options);
    return {
      ok: true,
      asOf,
      metric: options.metric,
      ...pagination,
      rows: rows.map((row) => ({ id: row.id, result: row[options.metric] })),
    };
  });
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
