import { cn, formatPrice } from "~/lib/utils";
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
  compact = false,
  idPrefix = "",
  retryLabel,
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
  compact?: boolean;
  idPrefix?: string;
  retryLabel?: string;
}) {
  const Container = compact ? "div" : "section";
  const Heading = compact ? "h4" : "h2";
  const display =
    metric.state === "value"
      ? name === "purchaseTotal"
        ? metric.value === 0
          ? "$0.00"
          : formatPrice(metric.value)
        : name === "studentProgress"
          ? `${Math.round(metric.value)}%`
          : name === "averageBestAttemptQuizScore"
            ? `${(metric.value * 100).toFixed(1)}%`
            : new Intl.NumberFormat("en-US").format(metric.value)
      : metric.state === "error"
        ? "Unable to load this metric"
        : "/";
  const explanation =
    metric.state === "empty"
      ? metric.reason === "no_authorized_courses"
        ? "No courses available to view"
        : metric.reason === "no_attempts"
          ? "No quiz attempts in the selected period"
          : name === "studentProgress" && courseScoped
            ? "No eligible students in this course"
            : "No data for the selected period"
      : metric.state === "unavailable"
        ? metric.reason === "no_lessons"
          ? "No calculable lessons for eligible enrollments."
          : metric.reason === "no_quizzes"
            ? "No quizzes in this course."
            : name === "retentionRate"
              ? "Retention rate is unavailable without activity records."
              : "Net revenue is unavailable without refund records."
        : metric.state === "error"
          ? "The source data could not be read. Try again."
          : null;

  return (
    <Container
      className={cn(
        "flex flex-col",
        !compact && "min-h-40 rounded-xl border bg-card p-5 shadow-sm"
      )}
      aria-labelledby={`${idPrefix}${name}-title`}
    >
      <Heading
        id={`${idPrefix}${name}-title`}
        className={cn(
          "text-muted-foreground",
          compact ? "text-xs" : "text-sm font-medium"
        )}
      >
        {title}
      </Heading>
      <p
        className={cn(!compact && "mt-4 text-2xl font-semibold tracking-tight")}
      >
        {display}
      </p>
      {metric.state === "error" && onRetry && (
        <button
          type="button"
          aria-label={retryLabel}
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-auto self-start rounded-md px-2 py-1 text-sm font-medium text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
        >
          Retry
        </button>
      )}
      <div
        className={cn(
          "space-y-2 text-xs text-muted-foreground",
          !compact && "mt-auto pt-3"
        )}
      >
        {name === "studentProgress" && !compact && (
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
    </Container>
  );
}
