import { and, desc, eq } from "drizzle-orm";
import { db } from "~/db";
import {
  CourseStatus,
  courseComments,
  courses,
  enrollments,
  UserRole,
  users,
} from "~/db/schema";

export class CourseCommentError extends Error {}

function getPublishingEligibilityReason(courseId: number, userId: number) {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const course = db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();

  if (!user) return "User not found.";
  if (!course) return "Course not found.";
  if (course.status !== CourseStatus.Published) {
    return "Only Published courses accept comments.";
  }
  if (user.role === UserRole.Admin || course.instructorId === userId) {
    return null;
  }
  if (user.role !== UserRole.Student) {
    return "Only enrolled Students can comment on this course.";
  }

  const enrollment = db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.courseId, courseId), eq(enrollments.userId, userId))
    )
    .get();

  return enrollment ? null : "You must be enrolled to comment on this course.";
}

export function getCourseCommentState(courseId: number, userId: number | null) {
  return {
    canComment:
      userId !== null &&
      getPublishingEligibilityReason(courseId, userId) === null,
  };
}

export function getCourseComments(courseId: number) {
  return db
    .select({
      id: courseComments.id,
      userId: courseComments.userId,
      authorName: users.name,
      content: courseComments.content,
      createdAt: courseComments.createdAt,
    })
    .from(courseComments)
    .innerJoin(users, eq(courseComments.userId, users.id))
    .where(eq(courseComments.courseId, courseId))
    .orderBy(desc(courseComments.createdAt), desc(courseComments.id))
    .all();
}

export function publishCourseComment(
  courseId: number,
  userId: number,
  content: string
) {
  const eligibilityReason = getPublishingEligibilityReason(courseId, userId);
  if (eligibilityReason) throw new CourseCommentError(eligibilityReason);

  const trimmedContent = content.trim();
  if (trimmedContent.length < 10 || trimmedContent.length > 500) {
    throw new CourseCommentError(
      "Comments must be between 10 and 500 characters."
    );
  }

  return db
    .insert(courseComments)
    .values({ courseId, userId, content: trimmedContent })
    .returning()
    .get();
}

export function deleteCourseComment(commentId: number, userId: number) {
  const comment = db
    .select({ userId: courseComments.userId })
    .from(courseComments)
    .where(eq(courseComments.id, commentId))
    .get();
  const user = db.select().from(users).where(eq(users.id, userId)).get();

  if (!comment) throw new CourseCommentError("Comment not found.");
  if (!user || (comment.userId !== userId && user.role !== UserRole.Admin)) {
    throw new CourseCommentError("You cannot delete this comment.");
  }

  db.delete(courseComments).where(eq(courseComments.id, commentId)).run();
  return true;
}
