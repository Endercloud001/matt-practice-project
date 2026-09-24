import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, enrollments, purchases, users, UserRole } from "~/db/schema";

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

export type AnalyticsOverviewOptions = PurchaseTotalOptions;

export type AnalyticsMetric<T> =
  | { state: "value"; value: T }
  | { state: "empty"; reason: "no_records" | "no_authorized_courses" }
  | { state: "unavailable"; reason: "missing_source_data" }
  | { state: "error"; reason: "read_failed" };

export const analyticsMetricNames = [
  "purchaseTotal",
  "enrollmentCount",
  "retentionRate",
  "netRevenue",
] as const;
export type AnalyticsMetricName = (typeof analyticsMetricNames)[number];

export type AnalyticsOverviewResult =
  | {
      ok: true;
      asOf: string;
      timezone: "UTC";
      currency: "USD";
      locale: "en-US";
      filters: { instructorId: number | null; courseId: number | null };
      purchaseTotal: AnalyticsMetric<number>;
      enrollmentCount: AnalyticsMetric<number>;
      retentionRate: AnalyticsMetric<number>;
      netRevenue: AnalyticsMetric<number>;
    }
  | { ok: false; error: "forbidden" | "not_found" };

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
      courses: { id: number }[];
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
      .select({ id: courses.id })
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

export function getAnalyticsOverview(
  options: AnalyticsOverviewOptions
): AnalyticsOverviewResult {
  return db.transaction((tx) => {
    const scope = getAuthorizedScope(tx, options);
    if (!scope.ok) return scope;
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

    return {
      ok: true,
      asOf,
      timezone: "UTC",
      currency: "USD",
      locale: "en-US",
      filters,
      purchaseTotal: purchaseMetric,
      enrollmentCount: enrollmentMetric,
      retentionRate: unavailable,
      netRevenue: unavailable,
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
