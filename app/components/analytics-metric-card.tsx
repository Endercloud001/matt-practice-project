import { formatPrice } from "~/lib/utils";
import type {
  AnalyticsMetric,
  AnalyticsMetricName,
} from "~/services/analyticsService";

export function AnalyticsMetricCard({
  title,
  name,
  metric,
  asOf,
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
      : metric.state === "empty"
        ? metric.reason === "no_authorized_courses"
          ? "暂无可查看的课程"
          : name === "studentProgress" && courseScoped
            ? "该课程暂无符合条件的学生"
            : "所选期间暂无数据"
        : metric.state === "unavailable"
          ? metric.reason === "no_lessons"
            ? "/ — No calculable lessons for eligible enrollments."
            : name === "retentionRate"
              ? "/ — 缺少活动记录，无法计算留存率"
              : "/ — 缺少退款记录，无法计算净收入"
          : "Unable to load this metric";

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
      {name === "studentProgress" && (
        <p className="mt-2 text-sm text-muted-foreground">
          Current learning snapshot of eligible enrollments, not a historical
          trend or instructor teaching progress.
        </p>
      )}
      {metric.state === "error" && (
        <p className="mt-2 text-sm text-muted-foreground">
          The source data could not be read. Try again.
        </p>
      )}
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
      <p className="mt-auto pt-3 text-xs text-muted-foreground">
        {updating ? (
          "Updating this metric"
        ) : stale ? (
          "Updating · previous filter result"
        ) : (
          <time dateTime={asOf} title={asOf}>
            As of{" "}
            {new Date(asOf).toLocaleString("en-US", {
              timeZone: "UTC",
              dateStyle: "medium",
              timeStyle: "medium",
            })}{" "}
            UTC
          </time>
        )}
      </p>
    </section>
  );
}
