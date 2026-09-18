import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courseRatings,
  courses,
  enrollments,
  UserRole,
  users,
} from "~/db/schema";

export class RatingError extends Error {}

export function getRatingSummary(courseId: number) {
  const result = db
    .select({
      average: sql<number | null>`avg(${courseRatings.ratingUnits}) / 2.0`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  return {
    average: result?.average ?? null,
    count: result?.count ?? 0,
  };
}

export type CourseRatingState = {
  personalRating: number | null;
  canRate: boolean;
  reason: string | null;
};

function getRatingEligibilityReason(courseId: number, userId: number) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId))
    )
    .get();

  if (!user || user.role !== UserRole.Student) {
    return "Only Students can rate courses.";
  }
  if (!course) {
    return "Course not found.";
  }
  if (course.instructorId === userId) {
    return "Course authors cannot rate their own course.";
  }
  if (!enrollment) {
    return "You must be enrolled to rate this course.";
  }
  if (course.status !== CourseStatus.Published) {
    return "Only Published courses can be rated.";
  }
  return null;
}

export function getCourseRatingState(
  courseId: number,
  userId: number | null
): CourseRatingState {
  if (userId === null) {
    return { personalRating: null, canRate: false, reason: null };
  }

  const personalRating = db
    .select({ ratingUnits: courseRatings.ratingUnits })
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.courseId, courseId),
        eq(courseRatings.userId, userId)
      )
    )
    .get();
  const reason = getRatingEligibilityReason(courseId, userId);

  return {
    personalRating: personalRating ? personalRating.ratingUnits / 2 : null,
    canRate: reason === null,
    reason,
  };
}

export function submitCourseRating(
  courseId: number,
  userId: number,
  rating: number
) {
  const ratingUnits = rating * 2;
  const eligibilityReason = getRatingEligibilityReason(courseId, userId);

  if (eligibilityReason) {
    throw new RatingError(eligibilityReason);
  }
  if (!Number.isInteger(ratingUnits) || ratingUnits < 2 || ratingUnits > 10) {
    throw new RatingError("Rating must be between 1 and 5 in half-star steps.");
  }

  const now = new Date().toISOString();
  const saved = db
    .insert(courseRatings)
    .values({ courseId, userId, ratingUnits, updatedAt: now })
    .onConflictDoUpdate({
      target: [courseRatings.courseId, courseRatings.userId],
      set: { ratingUnits, updatedAt: now },
    })
    .returning()
    .get();

  return { ...saved, rating: saved.ratingUnits / 2 };
}
