import { redirect } from "react-router";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { UserRole } from "~/db/schema";
import {
  getAnalyticsFilterOptions,
  getAnalyticsOverview,
  getCourseAnalytics,
} from "~/services/analyticsService";
import { parseAnalyticsFilters } from "~/lib/analytics-filters.server";

export async function loadAnalyticsPage({
  request,
  courseId,
}: {
  request: Request;
  courseId?: number;
}) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");
  const user = getUserById(userId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  // The route identity always determines course scope, never a query override.
  if (courseId !== undefined) params.set("courseId", String(courseId));
  const { query, fields } = parseAnalyticsFilters(params);
  if (!query) {
    const courseResult =
      courseId === undefined
        ? undefined
        : getCourseAnalytics({ userId, courseId });
    if (courseResult && !courseResult.ok) {
      return Response.json(courseResult, {
        status: courseResult.error === "not_found" ? 404 : 403,
      });
    }
    const options = getAnalyticsFilterOptions({ userId });
    if (!options.ok) return Response.json(options, { status: 403 });
    return Response.json(
      {
        ok: false,
        error: "invalid_query",
        fields,
        ...(courseResult?.ok ? { course: courseResult.course } : {}),
        courses: options.courses,
        instructors: options.instructors,
        viewer: { name: user.name, role: user.role },
      },
      { status: 400 }
    );
  }
  const instructorId =
    user.role === UserRole.Admin ? query.instructorId : undefined;
  const serviceOptions = {
    userId,
    ...(instructorId !== undefined ? { instructorId } : {}),
    ...(query.courseId !== undefined ? { courseId: query.courseId } : {}),
    ...(query.start ? { start: query.start } : {}),
    ...(query.end ? { end: query.end } : {}),
    ...(query.coursePage !== undefined ? { coursePage: query.coursePage } : {}),
    ...(query.studentPage !== undefined
      ? { studentPage: query.studentPage }
      : {}),
  };
  const result =
    courseId === undefined
      ? getAnalyticsOverview(serviceOptions)
      : getCourseAnalytics({ ...serviceOptions, courseId });
  if (!result.ok) {
    return Response.json(result, {
      status:
        result.error === "not_found"
          ? 404
          : result.error === "invalid_page"
            ? 400
            : 403,
    });
  }
  const selectedInstructorId =
    instructorId ?? (user.role === UserRole.Instructor ? userId : undefined);
  const options = getAnalyticsFilterOptions({
    userId,
    ...(selectedInstructorId !== undefined
      ? { instructorId: selectedInstructorId }
      : {}),
  });
  if (!options.ok) return Response.json(options, { status: 403 });
  return Response.json(
    {
      ...result,
      range: query.range,
      dates: {
        start:
          query.range === "custom" ? (query.start?.slice(0, 10) ?? "") : "",
        end: query.range === "custom" ? (query.end?.slice(0, 10) ?? "") : "",
      },
      courses: options.courses,
      instructors: options.instructors,
      viewer: { name: user.name, role: user.role },
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
