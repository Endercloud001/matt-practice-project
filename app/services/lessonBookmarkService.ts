import { and, eq, inArray } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courses,
  enrollments,
  lessonBookmarks,
  lessons,
  modules,
  UserRole,
  users,
} from "~/db/schema";

export class BookmarkError extends Error {}

type BookmarkState = {
  canView: boolean;
  canEdit: boolean;
  lessonIds: number[];
};

function getEligibility(opts: { courseId: number; userId: number }) {
  const user = db.select().from(users).where(eq(users.id, opts.userId)).get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, opts.courseId))
    .get();
  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, opts.userId),
        eq(enrollments.courseId, opts.courseId)
      )
    )
    .get();

  if (!user || user.role !== UserRole.Student) {
    return { canView: false, canEdit: false, reason: "Only enrolled Students can manage bookmarks." };
  }
  if (!course || !enrollment) {
    return { canView: false, canEdit: false, reason: "You must be enrolled to manage bookmarks." };
  }
  if (course.status !== CourseStatus.Published) {
    return {
      canView: true,
      canEdit: false,
      reason: "Bookmarks cannot currently be edited for this course.",
    };
  }
  return { canView: true, canEdit: true, reason: null };
}

export function getCourseBookmarkState(opts: {
  courseId: number;
  userId: number | null;
}): BookmarkState {
  if (opts.userId === null) {
    return { canView: false, canEdit: false, lessonIds: [] };
  }

  const eligibility = getEligibility({
    courseId: opts.courseId,
    userId: opts.userId,
  });
  if (!eligibility.canView) {
    return { canView: false, canEdit: false, lessonIds: [] };
  }

  const bookmarks = db
    .select({ lessonId: lessonBookmarks.lessonId })
    .from(lessonBookmarks)
    .innerJoin(lessons, eq(lessonBookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(
      and(
        eq(lessonBookmarks.userId, opts.userId),
        eq(modules.courseId, opts.courseId)
      )
    )
    .all();

  return {
    canView: true,
    canEdit: eligibility.canEdit,
    lessonIds: bookmarks.map((bookmark) => bookmark.lessonId),
  };
}

export function saveLessonBookmark(opts: {
  lessonId: number;
  userId: number;
  bookmarked: boolean;
}) {
  return db.transaction((tx) => {
    const lesson = tx
      .select({ courseId: modules.courseId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(lessons.id, opts.lessonId))
      .get();
    if (!lesson) {
      throw new BookmarkError("Lesson not found.");
    }

    const user = tx.select().from(users).where(eq(users.id, opts.userId)).get();
    const course = tx
      .select()
      .from(courses)
      .where(eq(courses.id, lesson.courseId))
      .get();
    const enrollment = tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, opts.userId),
          eq(enrollments.courseId, lesson.courseId)
        )
      )
      .get();

    if (!user || user.role !== UserRole.Student || !enrollment) {
      throw new BookmarkError("Only enrolled Students can manage bookmarks.");
    }
    if (!course) {
      throw new BookmarkError("Course not found.");
    }
    if (course.status !== CourseStatus.Published) {
      throw new BookmarkError("Bookmarks cannot currently be edited for this course.");
    }

    if (opts.bookmarked) {
      tx.insert(lessonBookmarks)
        .values({ userId: opts.userId, lessonId: opts.lessonId })
        .onConflictDoNothing()
        .run();
    } else {
      tx.delete(lessonBookmarks)
        .where(
          and(
            eq(lessonBookmarks.userId, opts.userId),
            eq(lessonBookmarks.lessonId, opts.lessonId)
          )
        )
        .run();
    }

    return { lessonId: opts.lessonId, bookmarked: opts.bookmarked };
  });
}

export function removeCourseBookmarksWhenIneligible(opts: {
  userId: number;
  courseId: number;
}) {
  return db.transaction((tx) => {
    const enrollment = tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, opts.userId),
          eq(enrollments.courseId, opts.courseId)
        )
      )
      .get();
    if (enrollment) return;

    const courseLessons = tx
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, opts.courseId))
      .all();
    const lessonIds = courseLessons.map((lesson) => lesson.id);
    if (lessonIds.length > 0) {
      tx.delete(lessonBookmarks)
        .where(
          and(
            eq(lessonBookmarks.userId, opts.userId),
            inArray(lessonBookmarks.lessonId, lessonIds)
          )
        )
        .run();
    }
  });
}

export function removeAllUserBookmarks(opts: { userId: number }) {
  return db.delete(lessonBookmarks).where(eq(lessonBookmarks.userId, opts.userId)).run();
}
