import { useCallback, useEffect, useState } from "react";
import {
  Form,
  redirect,
  useFetcher,
  useFetchers,
  useLocation,
  useNavigation,
} from "react-router";
import type { Route } from "./+types/instructor.analytics";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { cn } from "~/lib/utils";
import { AnalyticsMetricCard } from "~/components/analytics-metric-card";
import { UserRole } from "~/db/schema";
import {
  getAnalyticsFilterOptions,
  getAnalyticsOverview,
} from "~/services/analyticsService";
import type {
  AnalyticsMetric,
  AnalyticsMetricName,
} from "~/services/analyticsService";
import type { loader as retryLoader } from "~/routes/api.analytics.retry";
import { parseAnalyticsFilters } from "~/lib/analytics-filters.server";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await getCurrentUserId(request);
  if (userId === null) return redirect("/login");
  const user = getUserById(userId);
  if (
    !user ||
    (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)
  ) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { query, fields } = parseAnalyticsFilters(
    new URL(request.url).searchParams
  );
  if (!query) {
    const options = getAnalyticsFilterOptions({ userId });
    if (!options.ok) return Response.json(options, { status: 403 });
    return Response.json(
      {
        ok: false,
        error: "invalid_query",
        fields,
        courses: options.courses,
        instructors: options.instructors,
        viewer: { name: user.name, role: user.role },
      },
      { status: 400 }
    );
  }
  const instructorId =
    user.role === UserRole.Admin ? query.instructorId : undefined;
  const result = getAnalyticsOverview({
    userId,
    ...(instructorId !== undefined ? { instructorId } : {}),
    ...(query.courseId !== undefined ? { courseId: query.courseId } : {}),
    ...(query.start ? { start: query.start } : {}),
    ...(query.end ? { end: query.end } : {}),
  });
  if (!result.ok) {
    return Response.json(result, {
      status: result.error === "not_found" ? 404 : 403,
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

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return serverLoader();
}
clientLoader.hydrate = true;

type Range = "all" | "last7days" | "last30days" | "lastYear" | "custom";
type MetricName = AnalyticsMetricName;
type MetricResult = AnalyticsMetric<number>;
type AnalyticsPageData = {
  ok: true;
  asOf: string;
  purchaseTotal: MetricResult;
  enrollmentCount: MetricResult;
  retentionRate: MetricResult;
  netRevenue: MetricResult;
  range: Range;
  dates: { start: string; end: string };
  courses: { id: number; title: string }[];
  instructors: { id: number; name: string }[];
  viewer: { name: string; role: UserRole };
  filters: { instructorId: number | null; courseId: number | null };
};
type AnalyticsPageError = {
  ok: false;
  error: string;
  fields?: Record<string, string[]>;
  courses?: { id: number; title: string }[];
  instructors?: { id: number; name: string }[];
  viewer?: { name: string; role: UserRole };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMetricResult(value: unknown): value is MetricResult {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "value") return typeof value.value === "number";
  if (value.state === "empty")
    return (
      value.reason === "no_records" || value.reason === "no_authorized_courses"
    );
  if (value.state === "unavailable")
    return value.reason === "missing_source_data";
  return value.state === "error" && value.reason === "read_failed";
}

function isAnalyticsPageData(value: unknown): value is AnalyticsPageData {
  return (
    isRecord(value) &&
    value.ok === true &&
    typeof value.asOf === "string" &&
    isMetricResult(value.purchaseTotal) &&
    isMetricResult(value.enrollmentCount) &&
    isMetricResult(value.retentionRate) &&
    isMetricResult(value.netRevenue) &&
    ["all", "last7days", "last30days", "lastYear", "custom"].includes(
      String(value.range)
    ) &&
    isRecord(value.dates) &&
    typeof value.dates.start === "string" &&
    typeof value.dates.end === "string" &&
    Array.isArray(value.courses) &&
    value.courses.every(
      (course) =>
        isRecord(course) &&
        typeof course.id === "number" &&
        typeof course.title === "string"
    ) &&
    Array.isArray(value.instructors) &&
    value.instructors.every(
      (instructor) =>
        isRecord(instructor) &&
        typeof instructor.id === "number" &&
        typeof instructor.name === "string"
    ) &&
    isRecord(value.viewer) &&
    typeof value.viewer.name === "string" &&
    (value.viewer.role === UserRole.Admin ||
      value.viewer.role === UserRole.Instructor) &&
    isRecord(value.filters) &&
    (typeof value.filters.instructorId === "number" ||
      value.filters.instructorId === null) &&
    (typeof value.filters.courseId === "number" ||
      value.filters.courseId === null)
  );
}

function isAnalyticsPageError(value: unknown): value is AnalyticsPageError {
  return (
    isRecord(value) && value.ok === false && typeof value.error === "string"
  );
}

type RetryData = {
  ok: boolean;
  asOf?: string;
  metric?: MetricName;
  result?: MetricResult;
  scopeKey?: string;
  requestId?: string;
  error?: "forbidden" | "not_found";
};

function MetricCard({
  title,
  name,
  metric,
  asOf,
  scopeKey,
  stale,
  scopeGeneration,
  onNotice,
  onScopeFailure,
}: {
  title: string;
  name: MetricName;
  metric: MetricResult;
  asOf: string;
  scopeKey: string;
  stale: boolean;
  scopeGeneration: string;
  onNotice: (message: string) => void;
  onScopeFailure: (message: string) => void;
}) {
  const fetcher = useFetcher<typeof retryLoader>();
  const [override, setOverride] = useState<{
    scopeKey: string;
    snapshot: string;
    result: MetricResult;
    asOf: string;
  } | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const data = fetcher.data as RetryData | undefined;
  useEffect(() => {
    if (
      !requestId?.startsWith(`${scopeGeneration}:`) ||
      data?.requestId !== requestId ||
      data.scopeKey !== scopeKey
    )
      return;
    if (data.error === "forbidden" || data.error === "not_found") {
      onScopeFailure(
        data.error === "not_found"
          ? "The selected course no longer exists. Reload the analytics scope."
          : "Your analytics access changed. Reload the analytics scope."
      );
      return;
    }
    if (data.ok && data.metric === name && data.result && data.asOf) {
      setOverride({
        scopeKey,
        snapshot: scopeGeneration,
        result: data.result,
        asOf: data.asOf,
      });
      const refreshedAt = new Date(data.asOf).toLocaleString("en-US", {
        timeZone: "UTC",
        dateStyle: "medium",
        timeStyle: "short",
      });
      onNotice(
        data.result.state === "error"
          ? `${title}: Unable to load this metric.`
          : `${title} refreshed at ${refreshedAt} UTC. Other metrics keep their earlier observation times.`
      );
    }
  }, [
    data,
    name,
    onNotice,
    onScopeFailure,
    requestId,
    scopeGeneration,
    scopeKey,
    title,
  ]);

  const isUpdating = fetcher.state !== "idle";
  const current =
    override?.scopeKey === scopeKey && override.snapshot === scopeGeneration
      ? override
      : { scopeKey, result: metric, asOf };
  const retry = () => {
    const params = new URLSearchParams(scopeKey);
    const nextRequestId = `${scopeGeneration}:${crypto.randomUUID()}`;
    setRequestId(nextRequestId);
    params.set("metric", name);
    params.set("requestId", nextRequestId);
    onNotice("Updating analytics");
    fetcher.load(`/api/analytics/retry?${params.toString()}`);
  };

  return (
    <AnalyticsMetricCard
      title={title}
      name={name}
      metric={current.result}
      asOf={current.asOf}
      stale={stale}
      updating={isUpdating}
      retryDisabled={isUpdating || stale}
      onRetry={retry}
    />
  );
}

function SkeletonCards() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-40 rounded-xl border bg-muted" />
      ))}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        Loading analytics
      </p>
      <div aria-hidden="true" className="space-y-6">
        <div className="h-10 w-72 animate-pulse rounded bg-muted" />
        <div className="h-36 animate-pulse rounded-xl border bg-muted" />
        <SkeletonCards />
      </div>
    </div>
  );
}

export default function InstructorAnalytics({
  loaderData,
}: Route.ComponentProps) {
  const rawLoaderData: unknown = loaderData;
  const data = isAnalyticsPageData(rawLoaderData) ? rawLoaderData : undefined;
  const errorData = isAnalyticsPageError(rawLoaderData)
    ? rawLoaderData
    : undefined;
  const location = useLocation();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  const retryPending = fetchers.some((fetcher) => fetcher.state !== "idle");
  const stale = navigation.state !== "idle";
  const scopeKey = location.search.replace(/^\?/, "");
  const snapshotGeneration = `${location.key}:${data?.asOf ?? "error"}`;
  const currentScope = new URLSearchParams(location.search);
  const currentRange = data?.range ?? "all";
  const currentInstructor = currentScope.get("instructorId") ?? "";
  const [notice, setNotice] = useState("");
  const [scopeFailure, setScopeFailure] = useState<{
    snapshot: string;
    message: string;
  } | null>(null);
  const reportNotice = useCallback((message: string) => setNotice(message), []);
  const reportScopeFailure = useCallback(
    (message: string) =>
      setScopeFailure({ snapshot: snapshotGeneration, message }),
    [snapshotGeneration]
  );
  const clearCustomDates = () => {
    const startInput = document.querySelector<HTMLInputElement>(
      'input[name="start"]'
    );
    const endInput =
      document.querySelector<HTMLInputElement>('input[name="end"]');
    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";
  };
  useEffect(() => setNotice(""), [data?.asOf, location.key]);
  if (!data && errorData?.error === "forbidden") {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Analytics access denied</h1>
        <p className="mt-2">You are not authorized to view analytics.</p>
      </div>
    );
  }
  if (!data && errorData?.error === "not_found") {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-2">The selected course no longer exists.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">
          Correct the analytics filters
        </h1>
        <Form
          key={location.key}
          method="get"
          className="space-y-3 rounded-xl border bg-card p-4"
        >
          <fieldset className="grid gap-3 sm:max-w-xl">
            <legend className="font-medium">Filters</legend>
            {errorData?.fields &&
              Object.entries(errorData.fields).map(([field, errors]) => (
                <p
                  key={field}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {field}: {errors.join(" ")}
                </p>
              ))}
            <label className="grid gap-1 text-sm">
              Date range
              <select
                name="range"
                defaultValue={currentScope.get("range") ?? "all"}
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="all">All history</option>
                <option value="last7days">Last 7 days</option>
                <option value="last30days">Last 30 days</option>
                <option value="lastYear">Last year</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            {errorData?.viewer?.role === UserRole.Admin && (
              <label className="grid gap-1 text-sm">
                Instructor
                <select
                  name="instructorId"
                  defaultValue={currentScope.get("instructorId") ?? ""}
                  className="h-10 rounded-md border bg-background px-3"
                >
                  <option value="">All instructors</option>
                  {errorData.instructors?.map((instructor) => (
                    <option key={instructor.id} value={instructor.id}>
                      {instructor.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm">
              Course
              <select
                name="courseId"
                defaultValue={currentScope.get("courseId") ?? ""}
                className="h-10 rounded-md border bg-background px-3"
              >
                <option value="">All authorized courses</option>
                {errorData?.courses?.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Start date
              <input
                type="date"
                name="start"
                defaultValue={currentScope.get("start") ?? ""}
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-sm">
              End date
              <input
                type="date"
                name="end"
                defaultValue={currentScope.get("end") ?? ""}
                className="h-10 rounded-md border bg-background px-3"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Apply corrected filters
            </button>
          </fieldset>
        </Form>
        <a href="/instructor/analytics" className="underline">
          Reset filters
        </a>
      </div>
    );
  }
  const scopeChanged = Boolean(
    navigation.location && navigation.location.search !== location.search
  );
  if (scopeFailure?.snapshot === snapshotGeneration) {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Analytics access changed</h1>
        <p className="mt-2">{scopeFailure.message}</p>
        <a
          className="mt-4 inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href="/instructor/analytics"
        >
          Reload authorized analytics
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{data.viewer?.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Instructor Analytics
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">All dates use UTC · USD</p>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {scopeChanged || retryPending
          ? "Updating analytics"
          : stale
            ? "Loading analytics"
            : notice ||
              `As of ${new Date(data.asOf).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "medium" })} UTC`}
      </p>
      <Form
        key={location.key}
        method="get"
        className="space-y-3 rounded-xl border bg-card p-4"
      >
        <fieldset disabled={stale || retryPending} className="space-y-3">
          <legend className="text-sm font-semibold">Filters</legend>
          {data.viewer?.role === UserRole.Admin && (
            <label className="grid gap-1 text-sm sm:max-w-xs">
              Instructor
              <select
                name="instructorId"
                defaultValue={currentInstructor}
                onChange={() => {
                  const course = document.querySelector<HTMLSelectElement>(
                    'select[name="courseId"]'
                  );
                  if (course) course.value = "";
                }}
                className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <option value="">All instructors</option>
                {data.instructors?.map((instructor) => (
                  <option key={instructor.id} value={instructor.id}>
                    {instructor.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2" aria-label="Date range presets">
            {(
              [
                ["all", "All history"],
                ["last7days", "Last 7 days"],
                ["last30days", "Last 30 days"],
                ["lastYear", "Last year"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="submit"
                name="range"
                value={value}
                onClick={clearCustomDates}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                  currentRange === value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <details open={currentRange === "custom"}>
            <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              Custom date range
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Start date
                <input
                  type="date"
                  name="start"
                  defaultValue={
                    currentRange === "custom" ? data.dates?.start : ""
                  }
                  className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
              <label className="grid gap-1 text-sm">
                End date
                <input
                  type="date"
                  name="end"
                  defaultValue={
                    currentRange === "custom" ? data.dates?.end : ""
                  }
                  className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                />
              </label>
            </div>
            <button
              type="submit"
              name="range"
              value="custom"
              className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Apply custom dates
            </button>
          </details>
          <label className="grid gap-1 text-sm sm:max-w-xs">
            Course
            <select
              name="courseId"
              defaultValue={data.filters?.courseId ?? ""}
              className="h-10 rounded-md border bg-background px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">All authorized courses</option>
              {data.courses?.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            name="range"
            value={currentRange}
            onClick={() => {
              if (currentRange !== "custom") clearCustomDates();
            }}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Apply filters
          </button>
        </fieldset>
      </Form>
      {data.courses?.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">暂无可查看的课程</p>
          <p className="mt-1 text-sm text-muted-foreground">
            获批课程后，相关指标会显示在此处。
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Purchase Total"
          name="purchaseTotal"
          metric={data.purchaseTotal}
          asOf={data.asOf}
          scopeKey={scopeKey}
          stale={stale}
          scopeGeneration={snapshotGeneration}
          onNotice={reportNotice}
          onScopeFailure={reportScopeFailure}
        />
        <MetricCard
          title="Enrollment Count"
          name="enrollmentCount"
          metric={data.enrollmentCount}
          asOf={data.asOf}
          scopeKey={scopeKey}
          stale={stale}
          scopeGeneration={snapshotGeneration}
          onNotice={reportNotice}
          onScopeFailure={reportScopeFailure}
        />
        <MetricCard
          title="Retention Rate"
          name="retentionRate"
          metric={data.retentionRate}
          asOf={data.asOf}
          scopeKey={scopeKey}
          stale={stale}
          scopeGeneration={snapshotGeneration}
          onNotice={reportNotice}
          onScopeFailure={reportScopeFailure}
        />
        <MetricCard
          title="Net Revenue"
          name="netRevenue"
          metric={data.netRevenue}
          asOf={data.asOf}
          scopeKey={scopeKey}
          stale={stale}
          scopeGeneration={snapshotGeneration}
          onNotice={reportNotice}
          onScopeFailure={reportScopeFailure}
        />
      </div>
    </div>
  );
}
