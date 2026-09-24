import { formatPrice } from "~/lib/utils";
import type {
  AnalyticsMetric,
  AnalyticsMetricName,
} from "~/services/analyticsService";

export function AnalyticsMetricCard({
  title,
  name,
  metric,
  updating = false,
  stale = false,
  retryDisabled = false,
  onRetry,
  courseScoped = false,
}: {
  title: string;
  name: AnalyticsMetricName;
  metric: AnalyticsMetric<number>;
  asOf: string;
  updating?: boolean;
  stale?: boolean;
  retryDisabled?: boolean;
  onRetry?: () => void;
  courseScoped?: boolean;
}) {
  const display =
    metric.state === "value"
      ? name === "purchaseTotal"
        ? metric.value === 0
          ? "$0.00"
          : formatPrice(metric.value)
        : name === "studentProgress"
          ? `${Math.round(metric.value)}%`
          : new Intl.NumberFormat("en-US").format(metric.value)
      : metric.state === "error"
        ? "Unable to load this metric"
        : "/";
  const explanation =
    metric.state === "empty"
      ? metric.reason === "no_authorized_courses"
        ? "No courses available to view"
        : name === "studentProgress" && courseScoped
          ? "No eligible students in this course"
          : "No data for the selected period"
      : metric.state === "unavailable"
        ? metric.reason === "no_lessons"
          ? "No calculable lessons for eligible enrollments."
          : name === "retentionRate"
            ? "Retention rate is unavailable without activity records."
            : "Net revenue is unavailable without refund records."
        : metric.state === "error"
          ? "The source data could not be read. Try again."
          : null;

  return (
    <section
      className="flex min-h-40 flex-col rounded-xl border bg-card p-5 shadow-sm"
      aria-labelledby={`${name}-title`}
    >
      <h2
        id={`${name}-title`}
        className="text-sm font-medium text-muted-foreground"
      >
        {title}
      </h2>
      <p className="mt-4 text-2xl font-semibold tracking-tight">{display}</p>
      {metric.state === "error" && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-auto self-start rounded-md px-2 py-1 text-sm font-medium text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          Retry
        </button>
      )}
      <div className="mt-auto space-y-2 pt-3 text-xs text-muted-foreground">
        {name === "studentProgress" && (
          <p>
            Current learning snapshot of eligible enrollments, not a historical
            trend or instructor teaching progress.
          </p>
        )}
        {explanation && <p>{explanation}</p>}
        {updating ? (
          <p>Updating this metric</p>
        ) : stale ? (
          <p>Updating · previous filter result</p>
        ) : null}
      </div>
    </section>
  );
}
