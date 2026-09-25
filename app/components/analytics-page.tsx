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
import type { AnalyticsPageData } from "~/lib/analytics-page-data";
import type { AnalyticsMetricName as MetricName } from "~/services/analyticsService";
import { formatPrice } from "~/lib/utils";
import type { AnalyticsMetric } from "~/services/analyticsService";

function SummaryMetric({
  metric,
  kind,
}: {
  metric: AnalyticsMetric<number>;
  kind: "price" | "number" | "percent";
}) {
  if (metric.state !== "value")
    return (
      <span
        title={
          metric.state === "empty"
            ? "No records"
            : metric.state === "unavailable"
              ? "Unavailable"
              : "Unable to load"
        }
      >
        /
      </span>
    );
  if (kind === "price") return <span>{formatPrice(metric.value)}</span>;
  if (kind === "percent") return <span>{Math.round(metric.value)}%</span>;
  return <span>{metric.value}</span>;
}

function CourseSummaries({ data }: { data: AnalyticsPageData }) {
  const summaries = data.courseSummaries;
  const location = useLocation();
  if (!summaries) return null;
  const currentParams = new URLSearchParams(location.search);
  const scopeParams = new URLSearchParams();
  for (const name of ["range", "start", "end", "instructorId", "courseId"]) {
    const value = currentParams.get(name);
    if (value) scopeParams.set(name, value);
  }
  const pageHref = (page: number) => {
    const params = new URLSearchParams(scopeParams);
    if (page > 1) params.set("coursePage", String(page));
    return `/instructor/analytics?${params}`;
  };
  return (
    <section aria-labelledby="course-summaries-title" className="space-y-3">
      <h2 id="course-summaries-title" className="text-xl font-semibold">
        Course summaries
      </h2>
      {summaries.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No courses available to compare.
        </p>
      ) : (
        <div className="space-y-3">
          {summaries.rows.map((row) => (
            <article
              key={row.id}
              className="grid gap-2 rounded-xl border p-4 sm:grid-cols-4 sm:items-center"
            >
              <h3 className="font-medium">
                <a
                  className="underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  href={`/instructor/analytics/${row.id}?${new URLSearchParams([...scopeParams].filter(([key]) => key !== "courseId"))}`}
                >
                  {row.title}
                </a>
              </h3>
              <p>
                <span className="block text-xs text-muted-foreground">
                  Purchase Total
                </span>
                <SummaryMetric metric={row.purchaseTotal} kind="price" />
              </p>
              <p>
                <span className="block text-xs text-muted-foreground">
                  Enrollment Count
                </span>
                <SummaryMetric metric={row.enrollmentCount} kind="number" />
              </p>
              <p>
                <span className="block text-xs text-muted-foreground">
                  Average Student Learning Progress
                </span>
                <SummaryMetric metric={row.studentProgress} kind="percent" />
              </p>
            </article>
          ))}
        </div>
      )}
      {summaries.totalPages > 1 && (
        <nav
          aria-label="Course summaries pagination"
          className="flex items-center justify-between gap-3 text-sm"
        >
          {summaries.page > 1 ? (
            <a
              aria-label={`Go to page ${summaries.page - 1}`}
              className="rounded-md border px-3 py-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              href={pageHref(summaries.page - 1)}
            >
              Previous
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-md border px-3 py-2 text-muted-foreground"
            >
              Previous
            </span>
          )}
          <span aria-live="polite">
            Page {summaries.page} of {summaries.totalPages}
          </span>
          {summaries.page < summaries.totalPages ? (
            <a
              aria-label={`Go to page ${summaries.page + 1}`}
              className="rounded-md border px-3 py-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              href={pageHref(summaries.page + 1)}
            >
              Next
            </a>
          ) : (
            <span
              aria-disabled="true"
              className="rounded-md border px-3 py-2 text-muted-foreground"
            >
              Next
            </span>
          )}
        </nav>
      )}
    </section>
  );
}

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

  const renderMetric = (name: MetricName, title: string) =>
    data[name] ? (
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
    ) : null;

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
          <p className="font-medium">No courses available to view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Metrics will appear here when you have access to courses.
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
      {!course && <CourseSummaries data={data} />}
      {course && (
        <div className="space-y-3" aria-labelledby="learning-outcomes-title">
          <h2 id="learning-outcomes-title" className="text-xl font-semibold">
            Course learning outcomes
          </h2>
          {renderMetric(
            "studentProgress",
            "Course Average Student Learning Progress"
          )}
          <div className="grid min-w-0 gap-4 sm:grid-cols-3">
            {renderMetric(
              "averageBestAttemptQuizScore",
              "Average Best-Attempt Quiz Score"
            )}
            {renderMetric("participatingStudents", "Participating Students")}
            {renderMetric("quizCount", "Quizzes in Course")}
          </div>
          {data.studentProgress.state === "empty" && (
            <p className="text-sm text-muted-foreground">
              No eligible students in this course. Change the date range or
              return to the overview.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
