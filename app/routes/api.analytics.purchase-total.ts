import { redirect } from "react-router";
import type { Route } from "./+types/api.analytics.purchase-total";
import { getCurrentUserId } from "~/lib/session";
import { getPurchaseTotal } from "~/services/analyticsService";

const positiveInteger = /^[1-9]\d*$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const ranges = [
  "all",
  "last7days",
  "last30days",
  "lastYear",
  "custom",
] as const;
type Range = (typeof ranges)[number];

type ParsedQuery = {
  instructorId?: number;
  courseId?: number;
  start?: string;
  end?: string;
};

function parseDate(
  value: string | null,
  field: "start" | "end",
  fields: Record<string, string[]>
) {
  if (!value || !isoDate.test(value)) {
    fields[field] = ["Enter a valid ISO calendar date."];
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    fields[field] = ["Enter a valid ISO calendar date."];
    return undefined;
  }
  return date.toISOString();
}

function parseQuery(searchParams: URLSearchParams): {
  query?: ParsedQuery;
  fields: Record<string, string[]>;
} {
  const fields: Record<string, string[]> = {};
  const rangeValue = searchParams.get("range") ?? "all";
  if (!ranges.includes(rangeValue as Range))
    fields.range = ["Choose a supported date range."];
  const range: Range = ranges.includes(rangeValue as Range)
    ? (rangeValue as Range)
    : "all";
  const instructorRaw = searchParams.get("instructorId");
  const courseRaw = searchParams.get("courseId");
  const instructorId =
    instructorRaw &&
    positiveInteger.test(instructorRaw) &&
    Number.isSafeInteger(Number(instructorRaw))
      ? Number(instructorRaw)
      : undefined;
  const courseId =
    courseRaw &&
    positiveInteger.test(courseRaw) &&
    Number.isSafeInteger(Number(courseRaw))
      ? Number(courseRaw)
      : undefined;
  if (instructorRaw && instructorId === undefined)
    fields.instructorId = ["Enter a positive instructor ID."];
  if (courseRaw && courseId === undefined)
    fields.courseId = ["Enter a positive course ID."];

  let start: string | undefined;
  let end: string | undefined;
  const startRaw = searchParams.get("start");
  const endRaw = searchParams.get("end");
  if (range === "custom") {
    start = parseDate(startRaw, "start", fields);
    end = parseDate(endRaw, "end", fields);
    if (start && end && start >= end)
      fields.end = ["End date must be after start date."];
  } else if (startRaw || endRaw) {
    fields.range = ["Custom dates require range=custom."];
  } else if (range !== "all") {
    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const startDate = new Date(endDate);
    const days = range === "last7days" ? 7 : range === "last30days" ? 30 : 365;
    startDate.setUTCDate(startDate.getUTCDate() - days);
    start = startDate.toISOString();
    end = endDate.toISOString();
  }

  return Object.keys(fields).length
    ? { fields }
    : { query: { instructorId, courseId, start, end }, fields };
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");

  const { query, fields } = parseQuery(new URL(request.url).searchParams);
  if (!query)
    return Response.json(
      { ok: false, error: "invalid_query", fields },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    );

  const result = getPurchaseTotal({ userId, ...query });
  const headers = { "Cache-Control": "private, no-store" };
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 403;
    return Response.json(result, { status, headers });
  }
  return Response.json(
    {
      ...result,
      filters: {
        range: new URL(request.url).searchParams.get("range") ?? "all",
        ...result.filters,
        start: query.start ?? null,
        end: query.end ?? null,
      },
    },
    { headers }
  );
}
