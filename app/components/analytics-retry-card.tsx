import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { AnalyticsMetricCard } from "~/components/analytics-metric-card";
import type {
  AnalyticsMetric,
  AnalyticsMetricName as MetricName,
} from "~/services/analyticsService";
import type { loader as retryLoader } from "~/routes/api.analytics.retry";
type MetricResult = AnalyticsMetric<number>;

type RetryData = {
  ok: boolean;
  asOf?: string;
  metric?: MetricName;
  result?: MetricResult;
  scopeKey?: string;
  requestId?: string;
  error?: "forbidden" | "not_found";
};

export function RetryMetricCard({
  title,
  name,
  metric,
  asOf,
  scopeKey,
  stale,
  scopeGeneration,
  onNotice,
  onScopeFailure,
  courseScoped,
  summaryCourse,
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
  courseScoped: boolean;
  summaryCourse?: { id: number; title: string };
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
          ? `${summaryCourse ? `${summaryCourse.title}: ` : ""}${title}: Unable to load this metric.`
          : `${summaryCourse ? `${summaryCourse.title}: ` : ""}${title} refreshed at ${refreshedAt} UTC. Other metrics keep their earlier observation times.`
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
    summaryCourse?.title,
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
      courseScoped={courseScoped}
      compact={Boolean(summaryCourse)}
      idPrefix={summaryCourse ? `summary-${summaryCourse.id}-` : ""}
      retryLabel={
        summaryCourse ? `Retry ${summaryCourse.title}: ${title}` : undefined
      }
    />
  );
}
