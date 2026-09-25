import { redirect } from "react-router";
import type { Route } from "./+types/api.analytics.retry";
import { parseAnalyticsFilters } from "~/lib/analytics-filters.server";
import { getCurrentUserId } from "~/lib/session";
import {
  analyticsMetricNames,
  getAnalyticsMetric,
  type AnalyticsMetricName,
} from "~/services/analyticsService";

function isAnalyticsMetricName(
  value: string | null
): value is AnalyticsMetricName {
  return analyticsMetricNames.some((metricName) => metricName === value);
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");

  const params = new URL(request.url).searchParams;
  const metric = params.get("metric");
  const requestId = params.get("requestId");
  if (!requestId) {
    return Response.json(
      { ok: false, error: "invalid_query" },
      { status: 400 }
    );
  }
  if (!isAnalyticsMetricName(metric)) {
    return Response.json(
      { ok: false, error: "invalid_query" },
      { status: 400 }
    );
  }
  params.delete("metric");
  params.delete("requestId");
  const { query, fields } = parseAnalyticsFilters(params);
  if (!query) {
    return Response.json(
      { ok: false, error: "invalid_query", fields },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }
  const result = getAnalyticsMetric({
    userId,
    metric,
    ...query,
  });
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ok) {
    return Response.json(
      { ...result, requestId, scopeKey: params.toString() },
      {
        status: result.error === "not_found" ? 404 : 403,
        headers,
      }
    );
  }
  return Response.json(
    { ...result, scopeKey: params.toString(), requestId },
    { headers }
  );
}
