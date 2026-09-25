import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLocation } from "react-router";
import { cn } from "~/lib/utils";
import { isMetricResult } from "~/lib/analytics-page-data";
import type {
  AnalyticsMetric,
  StudentSnapshots,
} from "~/services/analyticsService";

type StudentMetricName = "studentProgress" | "quizAverage";
type ColumnResult = {
  asOf: string;
  rows: { id: number; result: AnalyticsMetric<number> }[];
};
const columnTitles: Record<StudentMetricName, string> = {
  studentProgress: "Average Progress",
  quizAverage: "Best-Attempt Quiz Average",
};
const ignoreNotice = (_message: string) => {};
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isColumnResult(
  value: Record<string, unknown>
): value is Record<string, unknown> & ColumnResult {
  return (
    typeof value.asOf === "string" &&
    Number.isFinite(Date.parse(value.asOf)) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === "number" &&
        isMetricResult(row.result)
    )
  );
}

function StudentMetric({
  metric,
  quiz = false,
}: {
  metric: AnalyticsMetric<number>;
  quiz?: boolean;
}) {
  if (metric.state === "value")
    return (
      <>
        {new Intl.NumberFormat("en-US", {
          minimumFractionDigits: quiz ? 1 : 0,
          maximumFractionDigits: quiz ? 1 : 0,
        }).format(metric.value * (quiz ? 100 : 1))}
        %
      </>
    );
  const explanation =
    metric.state === "error"
      ? "Unable to load this metric"
      : metric.state === "empty"
        ? quiz
          ? "No quiz attempts in the selected period"
          : "No progress data"
        : metric.reason === "no_lessons"
          ? "No lessons in this course"
          : metric.reason === "no_quizzes"
            ? "No quizzes in this course"
            : "Source data unavailable";
  return (
    <>
      <span aria-hidden="true">/ </span>
      <span className="text-sm text-muted-foreground">{explanation}</span>
    </>
  );
}

export function AnalyticsStudentTable({
  snapshots,
  asOf,
  disabled = false,
  updating = false,
  scopeGeneration,
  onNotice = ignoreNotice,
  onScopeFailure = ignoreNotice,
}: {
  snapshots: StudentSnapshots;
  asOf: string;
  disabled?: boolean;
  updating?: boolean;
  scopeGeneration?: string;
  onNotice?: (message: string) => void;
  onScopeFailure?: (message: string) => void;
}) {
  const location = useLocation();
  const fetcher = useFetcher<unknown>();
  const generation =
    scopeGeneration ?? `${location.pathname}:${location.key}:${asOf}`;
  const scopeKey = `${location.pathname}${location.search}`;
  const [request, setRequest] = useState<{
    id: string;
    generation: string;
    metric: StudentMetricName;
  } | null>(null);
  const handledRequest = useRef<string | null>(null);
  const [columns, setColumns] = useState<{
    generation: string;
    values: Partial<Record<StudentMetricName, ColumnResult>>;
  }>({ generation, values: {} });
  const [reloadRequired, setReloadRequired] = useState(false);
  const currentColumns =
    columns.generation === generation ? columns.values : {};
  const busy = disabled || updating || fetcher.state !== "idle";
  useEffect(() => {
    const response = fetcher.data;
    if (
      updating ||
      fetcher.state !== "idle" ||
      !request ||
      request.generation !== generation ||
      handledRequest.current === request.id
    )
      return;
    if (
      !isRecord(response) ||
      response.requestId !== request.id ||
      response.scopeKey !== scopeKey
    )
      return;
    handledRequest.current = request.id;
    if (
      response.ok === false &&
      (response.error === "forbidden" ||
        response.error === "not_found" ||
        response.error === "invalid_page")
    ) {
      setReloadRequired(true);
      onScopeFailure(
        response.error === "forbidden"
          ? "Your analytics access changed. Reload the analytics scope."
          : response.error === "not_found"
            ? "The selected course no longer exists. Reload the analytics scope."
            : "Student membership changed. Reload analytics before viewing the roster."
      );
      return;
    }
    if (
      response.ok !== true ||
      response.metric !== request.metric ||
      !isColumnResult(response)
    ) {
      onNotice(
        `${columnTitles[request.metric]}: Unable to refresh student metrics. Please try again.`
      );
      return;
    }
    if (
      !isRecord(response.course) ||
      response.course.id !== snapshots.course.id ||
      response.page !== snapshots.page ||
      response.pageSize !== snapshots.pageSize ||
      response.totalCount !== snapshots.totalCount ||
      response.totalPages !== snapshots.totalPages ||
      response.rows.length !== snapshots.rows.length ||
      response.rows.some((row, index) => row.id !== snapshots.rows[index].id)
    ) {
      setReloadRequired(true);
      onScopeFailure(
        "Student membership changed. Reload analytics before viewing the roster."
      );
      return;
    }
    const result = { asOf: response.asOf, rows: response.rows };
    setColumns((previous) => ({
      generation,
      values: {
        ...(previous.generation === generation ? previous.values : {}),
        [request.metric]: result,
      },
    }));
    onNotice(
      response.rows.some((row) => row.result.state === "error")
        ? `${columnTitles[request.metric]}: Unable to load student metrics. Please retry.`
        : `${columnTitles[request.metric]} refreshed at ${new Date(response.asOf).toLocaleString("en-US", { timeZone: "UTC" })} UTC. Other student metrics keep their earlier observation times.`
    );
  }, [
    fetcher.data,
    fetcher.state,
    generation,
    onNotice,
    onScopeFailure,
    request,
    scopeKey,
    snapshots,
    updating,
  ]);
  const retryColumn = (metric: StudentMetricName) => {
    const params = new URLSearchParams(location.search);
    const id = `${generation}:${crypto.randomUUID()}`;
    params.set("courseId", String(snapshots.course.id));
    params.set("studentPage", String(snapshots.page));
    params.set("metric", metric);
    params.set("requestId", id);
    params.set("scopeKey", scopeKey);
    setRequest({ id, generation, metric });
    onNotice("Updating analytics");
    void fetcher.load(`/api/analytics/students/retry?${params}`);
  };
  const rowMetric = ({
    row,
    metric,
  }: {
    row: StudentSnapshots["rows"][number];
    metric: StudentMetricName;
  }) =>
    currentColumns[metric]?.rows.find((result) => result.id === row.id)
      ?.result ?? row[metric];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [hasScrolled, setHasScrolled] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () =>
      setEdges({
        left: element.scrollLeft > 1,
        right:
          element.scrollWidth - element.clientWidth - element.scrollLeft > 1,
      });
    const onScroll = () => {
      measure();
      if (element.scrollLeft > 0) setHasScrolled(true);
    };
    const intersection = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting)
    );
    const resize = new ResizeObserver(measure);
    intersection.observe(element);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    element.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => {
      intersection.disconnect();
      resize.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [snapshots]);
  const pageHref = (page: number) => {
    const params = new URLSearchParams(location.search);
    if (page === 1) params.delete("studentPage");
    else params.set("studentPage", String(page));
    return `${location.pathname}?${params}`;
  };
  const paginationLink = ({
    page,
    label,
    enabled,
  }: {
    page: number;
    label: string;
    enabled: boolean;
  }) =>
    enabled && !busy ? (
      <Link
        to={pageHref(page)}
        aria-label={`Go to student page ${page}`}
        className="rounded-md border px-3 py-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {label}
      </Link>
    ) : (
      <span
        aria-disabled="true"
        className="rounded-md border bg-muted px-3 py-2 text-muted-foreground"
      >
        {label}
      </span>
    );
  const overflow = edges.left || edges.right;
  const showHint = inView && overflow && !hasScrolled;
  if (reloadRequired)
    return (
      <section>
        <p>
          Student access or membership changed. Reload analytics before viewing
          the roster.
        </p>
        <a
          href={`${location.pathname}${location.search}`}
          className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Reload analytics
        </a>
      </section>
    );
  return (
    <section
      aria-labelledby="student-snapshots-title"
      aria-busy={updating || fetcher.state !== "idle"}
      className="min-w-0 space-y-3"
    >
      <h2 id="student-snapshots-title" className="text-xl font-semibold">
        Student snapshots · {snapshots.course.title}
      </h2>
      <p className="text-sm text-muted-foreground">
        {updating && "Updating · Showing previous results. "}Current student
        progress snapshot as of{" "}
        <time dateTime={asOf}>
          {new Date(asOf).toLocaleString("en-US", {
            timeZone: "UTC",
            dateStyle: "medium",
            timeStyle: "medium",
          })}{" "}
          UTC
        </time>
        . Quiz averages use each student’s best attempt per quiz in the selected
        period.
      </p>
      {(["studentProgress", "quizAverage"] satisfies StudentMetricName[]).map(
        (metric) => {
          const refreshed = currentColumns[metric];
          const hasError = snapshots.rows.some(
            (row) => rowMetric({ row, metric }).state === "error"
          );
          return (
            (hasError || refreshed) && (
              <div
                key={metric}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                {hasError && (
                  <>
                    <span>
                      {columnTitles[metric]}: Unable to load student metrics.
                      {metric === "studentProgress"
                        ? " Student progress could not be read. Other metrics retain their existing results."
                        : " Quiz results could not be read. Other metrics retain their existing results."}
                    </span>
                    {fetcher.state !== "idle" && request?.metric === metric && (
                      <span>
                        Updating this column · Other values remain unchanged.
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => retryColumn(metric)}
                      disabled={busy}
                      className="rounded-md border px-3 py-2 underline disabled:cursor-not-allowed disabled:bg-muted disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Retry {columnTitles[metric]}
                    </button>
                  </>
                )}
                {refreshed && (
                  <p>
                    {columnTitles[metric]} column refreshed at{" "}
                    <time dateTime={refreshed.asOf}>
                      {new Date(refreshed.asOf).toLocaleString("en-US", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </time>
                    . Other columns retain their previous observation times.
                  </p>
                )}
              </div>
            )
          );
        }
      )}
      {snapshots.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6">
          <p>
            {snapshots.totalCount === 0
              ? "No eligible students in this course."
              : "No students on this page."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Change the date range using the filters above, or return to the
            analytics overview.
          </p>
        </div>
      ) : (
        <>
          {showHint && (
            <p
              id="student-scroll-hint"
              className="text-sm text-muted-foreground"
            >
              Scroll horizontally to see all columns. Focus the table and use
              the left and right arrow keys.
            </p>
          )}
          <div className="relative min-w-0">
            <div
              ref={scrollRef}
              role="region"
              aria-label={`Student snapshots for ${snapshots.course.title}`}
              aria-describedby={showHint ? "student-scroll-hint" : undefined}
              tabIndex={0}
              className="overflow-x-auto rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <table className="w-full min-w-[850px] border-collapse text-left text-sm">
                <thead>
                  <tr>
                    {[
                      "Name",
                      "Email",
                      "Enrollment Date",
                      "Average Progress",
                      "Best-Attempt Quiz Average",
                    ].map((name, index) => (
                      <th
                        key={name}
                        scope="col"
                        className={cn(
                          "border-b bg-muted px-4 py-4 font-semibold",
                          index === 0 &&
                            "sticky left-0 z-10 w-48 min-w-40 border-r-2 border-r-border"
                        )}
                      >
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshots.rows.map((row) => (
                    <tr key={row.id}>
                      <th
                        scope="row"
                        className="sticky left-0 z-10 w-48 min-w-40 border-b border-r-2 border-r-border bg-background px-4 py-4 font-medium [overflow-wrap:anywhere]"
                      >
                        {row.name}
                      </th>
                      <td className="border-b px-4 py-4 [overflow-wrap:anywhere]">
                        {row.email}
                      </td>
                      <td className="whitespace-nowrap border-b px-4 py-4">
                        <time dateTime={row.enrolledAt}>
                          {new Date(row.enrolledAt).toLocaleDateString(
                            "en-US",
                            { timeZone: "UTC", dateStyle: "medium" }
                          )}
                        </time>
                      </td>
                      <td className="border-b px-4 py-4">
                        <StudentMetric
                          metric={rowMetric({ row, metric: "studentProgress" })}
                        />
                      </td>
                      <td className="border-b px-4 py-4">
                        <StudentMetric
                          metric={rowMetric({ row, metric: "quizAverage" })}
                          quiz
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inView && edges.left && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 w-3 rounded-l-lg bg-gradient-to-r from-foreground/20 to-transparent"
              />
            )}
            {inView && edges.right && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-3 rounded-r-lg bg-gradient-to-l from-foreground/20 to-transparent"
              />
            )}
          </div>
        </>
      )}
      <nav
        aria-label="Student snapshots pagination"
        className="flex flex-wrap items-center justify-between gap-3 text-sm"
      >
        {paginationLink({
          page: Math.max(1, snapshots.page - 1),
          label: "Previous",
          enabled: snapshots.page > 1,
        })}
        <span aria-current="page">
          Page {snapshots.page} of {Math.max(1, snapshots.totalPages)}
        </span>
        {paginationLink({
          page: snapshots.page + 1,
          label: "Next",
          enabled: snapshots.page < snapshots.totalPages,
        })}
        {snapshots.page > Math.max(1, snapshots.totalPages) &&
          paginationLink({
            page: 1,
            label: "Return to first page",
            enabled: true,
          })}
      </nav>
    </section>
  );
}
