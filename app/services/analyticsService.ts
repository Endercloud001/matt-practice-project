import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, purchases, users, UserRole } from "~/db/schema";

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

export function getPurchaseTotal(
  options: PurchaseTotalOptions
): PurchaseTotalResult {
  return db.transaction((tx) => {
    const viewer = tx
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, options.userId))
      .get();
    if (
      !viewer ||
      (viewer.role !== UserRole.Instructor && viewer.role !== UserRole.Admin)
    ) {
      return { ok: false, error: "forbidden" };
    }

    if (options.courseId !== undefined) {
      const requestedCourse = tx
        .select({ id: courses.id, instructorId: courses.instructorId })
        .from(courses)
        .where(eq(courses.id, options.courseId))
        .get();
      if (!requestedCourse) return { ok: false, error: "not_found" };
      if (
        viewer.role === UserRole.Instructor &&
        requestedCourse.instructorId !== options.userId
      ) {
        return { ok: false, error: "forbidden" };
      }
      if (
        viewer.role === UserRole.Admin &&
        options.instructorId !== undefined &&
        requestedCourse.instructorId !== options.instructorId
      ) {
        return { ok: false, error: "forbidden" };
      }
    }

    const courseConditions = [];
    if (viewer.role === UserRole.Instructor)
      courseConditions.push(eq(courses.instructorId, options.userId));
    if (viewer.role === UserRole.Admin && options.instructorId !== undefined)
      courseConditions.push(eq(courses.instructorId, options.instructorId));
    if (options.courseId !== undefined)
      courseConditions.push(eq(courses.id, options.courseId));
    const authorizedCourses = tx
      .select({ id: courses.id })
      .from(courses)
      .where(courseConditions.length ? and(...courseConditions) : undefined)
      .all();
    const asOf = new Date().toISOString();

    if (authorizedCourses.length === 0) {
      return {
        ok: true,
        asOf,
        timezone: "UTC",
        currency: "USD",
        locale: "en-US",
        filters: {
          instructorId:
            viewer.role === UserRole.Admin
              ? (options.instructorId ?? null)
              : null,
          courseId: options.courseId ?? null,
        },
        purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
      };
    }

    const purchaseConditions = [
      inArray(
        purchases.courseId,
        authorizedCourses.map((course) => course.id)
      ),
    ];
    if (options.start)
      purchaseConditions.push(gte(purchases.createdAt, options.start));
    if (options.end)
      purchaseConditions.push(lt(purchases.createdAt, options.end));
    const total = tx
      .select({ cents: sql<number>`sum(${purchases.pricePaid})` })
      .from(purchases)
      .where(and(...purchaseConditions))
      .get()?.cents;

    return {
      ok: true,
      asOf,
      timezone: "UTC",
      currency: "USD",
      locale: "en-US",
      filters: {
        instructorId:
          viewer.role === UserRole.Admin
            ? (options.instructorId ?? null)
            : null,
        courseId: options.courseId ?? null,
      },
      purchaseTotal:
        total === null || total === undefined
          ? { state: "empty", reason: "no_purchases" }
          : { state: "value", cents: total },
    };
  });
}
