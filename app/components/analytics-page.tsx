import { useCallback, useEffect, useState } from "react";
import { useFetchers, useLocation, useNavigation } from "react-router";
import { cn } from "~/lib/utils";
import {
  AnalyticsFilters,
  AnalyticsFilterRecovery,
} from "~/components/analytics-filters";
import { RetryMetricCard } from "~/components/analytics-retry-card";
import {
  isAnalyticsPageData,
  isAnalyticsPageError,
} from "~/lib/analytics-page-data";
import type { AnalyticsMetricName as MetricName } from "~/services/analyticsService";

function SkeletonCards() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {[0, 1, 2, 3, 4].map((item) => (
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

export function CourseAnalyticsFallback() {
  return (
    <div className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        Loading analytics
      </p>
      <div aria-hidden="true" className="space-y-6 animate-pulse">
        <div className="h-10 w-60 rounded bg-muted" />
        <div className="h-36 rounded-xl border bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-40 rounded-xl border bg-muted" />
          <div className="h-40 rounded-xl border bg-muted" />
        </div>
        <div className="h-52 rounded-xl border bg-muted" />
      </div>
    </div>
  );
}

export function AnalyticsPage({ loaderData }: { loaderData: unknown }) {
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
  const course = data?.course ?? errorData?.course;
  const retryScope = new URLSearchParams(location.search);
  if (course) retryScope.set("courseId", String(course.id));
  const scopeKey = retryScope.toString();
  const snapshotGeneration = `${location.pathname}:${location.key}:${data?.asOf ?? "error"}`;
  const dateParams = new URLSearchParams();
  for (const name of ["range", "start", "end"]) {
    const value = new URLSearchParams(location.search).get(name);
    if (value) dateParams.set(name, value);
  }
  const overviewHref = `/instructor/analytics?${dateParams}`;
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
  useEffect(() => setNotice(""), [data?.asOf, location.key]);
  if (!data && errorData?.error === "forbidden") {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Analytics access denied</h1>
        <p className="mt-2">You are not authorized to view analytics.</p>
        <a
          href={overviewHref}
          className="mt-4 inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Back to authorized analytics
        </a>
      </div>
    );
  }
  if (!data && errorData?.error === "not_found") {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-2">The selected course no longer exists.</p>
        <a
          href={overviewHref}
          className="mt-4 inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Back to authorized analytics
        </a>
      </div>
    );
  }
  if (!data) return <AnalyticsFilterRecovery errorData={errorData} />;
  const scopeChanged = Boolean(
    navigation.location &&
    (navigation.location.search !== location.search ||
      navigation.location.pathname !== location.pathname)
  );
  if (scopeFailure?.snapshot === snapshotGeneration) {
    return (
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h1 className="text-xl font-semibold">Analytics access changed</h1>
        <p className="mt-2">{scopeFailure.message}</p>
        <a
          className="mt-4 inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={overviewHref}
        >
          Reload authorized analytics
        </a>
      </div>
    );
  }

  const renderMetric = (name: MetricName, title: string) => (
    <RetryMetricCard
      title={title}
      name={name}
      metric={data[name]}
      asOf={data.asOf}
      scopeKey={scopeKey}
      stale={stale}
      scopeGeneration={snapshotGeneration}
      onNotice={reportNotice}
      onScopeFailure={reportScopeFailure}
      courseScoped={Boolean(course)}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{data.viewer?.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {course ? course.title : "Instructor Analytics"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">All dates use UTC · USD</p>
      </div>
      {course && (
        <a
          href={overviewHref}
          className="inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Back to analytics overview
        </a>
      )}
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
      <AnalyticsFilters data={data} disabled={stale || retryPending} />
      {data.courses?.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">暂无可查看的课程</p>
          <p className="mt-1 text-sm text-muted-foreground">
            获批课程后，相关指标会显示在此处。
          </p>
        </div>
      )}
      {!course && data.filters.courseId !== null && (
        <a
          className="inline-block underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={`/instructor/analytics/${data.filters.courseId}?${new URLSearchParams({ range: data.range, ...(data.range === "custom" ? data.dates : {}) })}`}
        >
          View Analytics:{" "}
          {
            data.courses.find((course) => course.id === data.filters.courseId)
              ?.title
          }
        </a>
      )}
      <div
        className={cn(
          "grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2",
          !course && "xl:grid-cols-5"
        )}
      >
        {renderMetric("purchaseTotal", "Purchase Total")}
        {renderMetric("enrollmentCount", "Enrollment Count")}
        {!course && (
          <>
            {renderMetric(
              "studentProgress",
              "Average Student Learning Progress"
            )}
            {renderMetric("retentionRate", "Retention Rate")}
            {renderMetric("netRevenue", "Net Revenue")}
          </>
        )}
      </div>
      {course && (
        <div className="space-y-3" aria-labelledby="learning-outcomes-title">
          <h2 id="learning-outcomes-title" className="text-xl font-semibold">
            Course learning outcomes
          </h2>
          {renderMetric(
            "studentProgress",
            "Course Average Student Learning Progress"
          )}
          {data.studentProgress.state === "empty" && (
            <p className="text-sm text-muted-foreground">
              该课程暂无符合条件的学生。Change the date range or return to the
              overview.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
