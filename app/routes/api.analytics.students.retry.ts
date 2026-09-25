import { redirect } from "react-router";
import type { Route } from "./+types/api.analytics.students.retry";
import { getCurrentUserId } from "~/lib/session";
import { parseAnalyticsFilters } from "~/lib/analytics-filters.server";
import { getStudentSnapshotMetric } from "~/services/analyticsService";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");
  const params = new URL(request.url).searchParams;
  const requestId = params.get("requestId");
  const scopeKey = params.get("scopeKey");
  const metric = params.get("metric");
  const { query, fields } = parseAnalyticsFilters(params);
  const headers = { "Cache-Control": "private, no-store" };
  if (
    !requestId ||
    !scopeKey ||
    !query ||
    query.courseId === undefined ||
    (metric !== "studentProgress" && metric !== "quizAverage")
  ) {
    return Response.json(
      { ok: false, error: "invalid_query", fields, requestId, scopeKey },
      { status: 400, headers }
    );
  }
  const result = getStudentSnapshotMetric({
    ...query,
    userId,
    courseId: query.courseId,
    metric,
  });
  return Response.json(
    { ...result, requestId, scopeKey },
    {
      status: result.ok
        ? 200
        : result.error === "not_found"
          ? 404
          : result.error === "invalid_page"
            ? 400
            : 403,
      headers,
    }
  );
}
