import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsMetricCard } from "~/components/analytics-metric-card";

describe("analytics metric card presentation", () => {
  it("rounds student progress only for display and explains its current snapshot", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Average Student Learning Progress"
        name="studentProgress"
        metric={{ state: "value", value: 100 / 6 }}
        asOf="2026-09-24T00:00:00.000Z"
      />
    );
    expect(markup).toContain("17%");
    expect(markup).toContain("Current learning snapshot");
    expect(markup).toContain("not a historical trend");
  });

  it("formats a genuine zero Purchase Total as currency zero", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Purchase Total"
        name="purchaseTotal"
        metric={{ state: "value", value: 0 }}
        asOf="2026-09-23T00:00:00.000Z"
      />
    );
    expect(markup).toContain("$0.00");
    expect(markup).not.toContain("Free");
  });

  it("distinguishes real zero progress, no eligible students and no lessons", () => {
    const renderProgress = (
      metric: Parameters<typeof AnalyticsMetricCard>[0]["metric"]
    ) =>
      renderToStaticMarkup(
        <AnalyticsMetricCard
          title="Course Average Student Learning Progress"
          name="studentProgress"
          courseScoped
          metric={metric}
          asOf="2026-09-24T00:00:00.000Z"
        />
      );
    expect(renderProgress({ state: "value", value: 0 })).toContain("0%");
    const empty = renderProgress({ state: "empty", reason: "no_records" });
    const unavailable = renderProgress({
      state: "unavailable",
      reason: "no_lessons",
    });
    expect(empty).toContain("暂无符合条件的学生");
    expect(unavailable).toContain("/ — No calculable lessons");
    for (const markup of [empty, unavailable]) {
      expect(markup).not.toContain("0%");
      expect(markup).not.toContain('role="progressbar"');
    }
  });

  it("shows distinct empty, unavailable and retryable error explanations", () => {
    const noRecords = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Enrollment Count"
        name="enrollmentCount"
        metric={{ state: "empty", reason: "no_records" }}
        asOf="2026-09-23T00:00:00.000Z"
      />
    );
    const unavailable = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Retention Rate"
        name="retentionRate"
        metric={{ state: "unavailable", reason: "missing_source_data" }}
        asOf="2026-09-23T00:00:00.000Z"
      />
    );
    const error = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Net Revenue"
        name="netRevenue"
        metric={{ state: "error", reason: "read_failed" }}
        asOf="2026-09-23T00:00:00.000Z"
        onRetry={() => undefined}
      />
    );

    expect(noRecords).toContain("所选期间暂无数据");
    expect(unavailable).toContain("缺少活动记录，无法计算留存率");
    expect(error).toContain("Unable to load this metric");
    expect(error).toContain("The source data could not be read. Try again.");
    expect(error).toContain("Retry</button>");
  });

  it("keeps the card named and prevents retry while its old scope is updating", () => {
    const markup = renderToStaticMarkup(
      <AnalyticsMetricCard
        title="Enrollment Count"
        name="enrollmentCount"
        metric={{ state: "error", reason: "read_failed" }}
        asOf="2026-09-23T00:00:00.000Z"
        stale
        retryDisabled
        onRetry={() => undefined}
      />
    );
    expect(markup).toContain('aria-labelledby="enrollmentCount-title"');
    expect(markup).toContain('id="enrollmentCount-title"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Retry<\/button>/);
    expect(markup).toContain("Updating · previous filter result");
  });
});
