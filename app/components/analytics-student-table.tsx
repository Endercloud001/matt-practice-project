import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "~/lib/utils";
import type {
  AnalyticsMetric,
  StudentSnapshots,
} from "~/services/analyticsService";

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
}: {
  snapshots: StudentSnapshots;
  asOf: string;
  disabled?: boolean;
  updating?: boolean;
}) {
  const location = useLocation();
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
    enabled && !disabled ? (
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
  return (
    <section
      aria-labelledby="student-snapshots-title"
      aria-busy={updating}
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
                        <StudentMetric metric={row.studentProgress} />
                      </td>
                      <td className="border-b px-4 py-4">
                        <StudentMetric metric={row.quizAverage} quiz />
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
