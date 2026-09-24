import { redirect } from "react-router";
import type { Route } from "./+types/api.analytics.purchase-total";
import { parseAnalyticsFilters } from "~/lib/analytics-filters.server";
import { getCurrentUserId } from "~/lib/session";
import { getPurchaseTotal } from "~/services/analyticsService";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");

  const searchParams = new URL(request.url).searchParams;
  const { query, fields } = parseAnalyticsFilters(searchParams);
  if (!query) {
    return Response.json(
      { ok: false, error: "invalid_query", fields },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const result = getPurchaseTotal({ userId, ...query });
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ok) {
    return Response.json(result, {
      status: result.error === "not_found" ? 404 : 403,
      headers,
    });
  }
  return Response.json(
    {
      ...result,
      filters: {
        range: query.range,
        ...result.filters,
        start: query.start ?? null,
        end: query.end ?? null,
      },
    },
    { headers }
  );
}
