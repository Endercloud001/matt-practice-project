import { AnalyticsMetricCard } from "~/components/analytics-metric-card";
import {
  useAnalyticsRetry,
  type MetricRetryOptions,
} from "~/lib/use-analytics-retry";

export function RetryMetricCard(options: MetricRetryOptions) {
  const retry = useAnalyticsRetry(options);
  if (retry.view.state === "reload-required") return null;
  const { target, context } = options;
  const summaryCourse = target.kind === "summary" ? target.course : undefined;
  return (
    <AnalyticsMetricCard
      title={target.label}
      name={target.metric}
      metric={retry.view.value.metric}
      asOf={retry.view.value.asOf}
      stale={context.navigationPending}
      updating={retry.busy}
      retryDisabled={retry.disabled}
      onRetry={retry.retry}
      courseScoped={target.kind === "summary" || target.scope.kind === "course"}
      compact={Boolean(summaryCourse)}
      idPrefix={summaryCourse ? `summary-${summaryCourse.id}-` : ""}
      retryLabel={
        summaryCourse
          ? `Retry ${summaryCourse.title}: ${target.label}`
          : undefined
      }
    />
  );
}
