import { useEffect, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { isMetricResult } from "~/lib/analytics-page-data";
import type {
  AnalyticsMetric,
  AnalyticsMetricName,
  CourseSummary,
  StudentSnapshotMetricName,
  StudentSnapshots,
} from "~/services/analyticsService";

type SummaryMetric = keyof Omit<CourseSummary, "id" | "title">;
type OverviewMetric =
  | SummaryMetric
  | Extract<AnalyticsMetricName, "retentionRate" | "netRevenue">;
export type CourseMetric = Exclude<
  AnalyticsMetricName,
  "retentionRate" | "netRevenue"
>;
export type RecoveryReason =
  | "forbidden"
  | "not_found"
  | "invalid_page"
  | "membership_changed";
export type RetryEvent =
  | { kind: "notice"; generation: string; message: string }
  | {
      kind: "recovery";
      generation: string;
      reason: RecoveryReason;
      message: string;
    };
export type RetryContext = {
  generation: string;
  navigationPending: boolean;
  retryPending: boolean;
  report: (event: RetryEvent) => void;
};
export type PageMetricTarget = { kind: "page"; label: string } & (
  | { scope: { kind: "overview" }; metric: OverviewMetric }
  | { scope: { kind: "course"; courseId: number }; metric: CourseMetric }
);
export type MetricTarget =
  | PageMetricTarget
  | {
      kind: "summary";
      course: Pick<CourseSummary, "id" | "title">;
      metric: SummaryMetric;
      label: string;
    };
type ObservedMetric = { metric: AnalyticsMetric<number>; asOf: string };
type RecoveryView = {
  state: "reload-required";
  reason: RecoveryReason;
  message: string;
};
type RetryView<T> = { state: "ready"; value: T } | RecoveryView;
export type MetricRetryOptions = {
  target: MetricTarget;
  initial: ObservedMetric;
  context: RetryContext;
};
type MetricRetry = {
  view: RetryView<ObservedMetric>;
  busy: boolean;
  disabled: boolean;
  retry: () => void;
};
export type StudentRetryOptions = {
  target: { kind: "student-columns" };
  initial: { snapshots: StudentSnapshots; asOf: string };
  context: RetryContext;
};
type StudentMetric = StudentSnapshotMetricName;
type ColumnResult = {
  asOf: string;
  rows: { id: number; result: AnalyticsMetric<number> }[];
};
type StudentValue = {
  snapshots: StudentSnapshots;
  columns: Record<StudentMetric, { asOf: string; refreshed: boolean }>;
};
type StudentRetry = {
  view: RetryView<StudentValue>;
  busy: boolean;
  disabled: boolean;
  activeMetric: StudentMetric | null;
  retry: (options: { metric: StudentMetric }) => void;
};
type RetryOptions = MetricRetryOptions | StudentRetryOptions;
type Accepted = {
  identity: Identity;
  metric?: ObservedMetric;
  columns?: Partial<Record<StudentMetric, ColumnResult>>;
  recovery?: RecoveryView;
};
const columnTitles: Record<StudentMetric, string> = {
  studentProgress: "Average Progress",
  quizAverage: "Best-Attempt Quiz Average",
};
type Identity = (string | number)[];
type Attempt = {
  id: string;
  generation: string;
  identity: Identity;
  previousData: unknown;
  settled: boolean;
  handled: boolean;
  metric: AnalyticsMetricName | StudentMetric;
};

function sameIdentity({ left, right }: { left: Identity; right: Identity }) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function recoveryMessage(reason: RecoveryReason) {
  if (reason === "forbidden")
    return "Your analytics access changed. Reload the analytics scope.";
  if (reason === "not_found")
    return "The selected course no longer exists. Reload the analytics scope.";
  return "Student membership changed. Reload analytics before viewing the roster.";
}
function isStudentOptions(
  options: RetryOptions
): options is StudentRetryOptions {
  return options.target.kind === "student-columns";
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

export function useAnalyticsRetry(options: MetricRetryOptions): MetricRetry;
export function useAnalyticsRetry(options: StudentRetryOptions): StudentRetry;
export function useAnalyticsRetry(
  options: RetryOptions
): MetricRetry | StudentRetry {
  const location = useLocation();
  const fetcher = useFetcher<unknown>();
  const student = isStudentOptions(options) ? options : null;
  const scalar = isStudentOptions(options) ? null : options;
  const params = new URLSearchParams();
  if (scalar?.target.kind === "summary") {
    const search = new URLSearchParams(location.search);
    for (const name of ["range", "start", "end", "instructorId", "courseId"]) {
      const value = search.get(name);
      if (value) params.set(name, value);
    }
    params.set("courseId", String(scalar.target.course.id));
  } else {
    for (const [name, value] of new URLSearchParams(location.search))
      params.append(name, value);
    if (scalar?.target.kind === "page" && scalar.target.scope.kind === "course")
      params.set("courseId", String(scalar.target.scope.courseId));
    if (student) {
      params.set("courseId", String(student.initial.snapshots.course.id));
      params.set("studentPage", String(student.initial.snapshots.page));
    }
  }
  const scopeKey = student
    ? `${location.pathname}${location.search}`
    : params.toString();
  const identity: Identity = [
    options.context.generation,
    options.initial.asOf,
    options.target.kind,
    scopeKey,
  ];
  if (scalar) {
    identity.push(
      scalar.target.metric,
      scalar.target.kind === "page" ? scalar.target.scope.kind : "summary"
    );
  }
  if (student) {
    const snapshots = student.initial.snapshots;
    identity.push(
      snapshots.course.id,
      snapshots.page,
      snapshots.pageSize,
      snapshots.totalCount,
      snapshots.totalPages,
      ...snapshots.rows.map((row) => row.id)
    );
  }
  const request = useRef<Attempt | null>(null);
  const mounted = useRef(false);
  const [, updateCompletion] = useState(0);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current =
    accepted && sameIdentity({ left: accepted.identity, right: identity })
      ? accepted
      : null;
  const busy =
    fetcher.state !== "idle" ||
    Boolean(request.current && !request.current.settled);
  const disabled =
    busy ||
    options.context.navigationPending ||
    Boolean(current?.recovery) ||
    Boolean(student && options.context.retryPending);
  useEffect(() => {
    const attempt = request.current;
    if (
      !attempt ||
      !attempt.settled ||
      attempt.handled ||
      fetcher.state !== "idle" ||
      options.context.navigationPending ||
      !sameIdentity({ left: attempt.identity, right: identity })
    )
      return;
    // A completed load must publish new data; idle alone can still retain an old response.
    if (fetcher.data === attempt.previousData) return;
    const response = fetcher.data;
    if (
      isRecord(response) &&
      ((response.requestId !== undefined &&
        response.requestId !== attempt.id) ||
        (response.scopeKey !== undefined && response.scopeKey !== scopeKey))
    ) {
      attempt.handled = true;
      return;
    }
    attempt.handled = true;
    const report = (
      event:
        | Omit<Extract<RetryEvent, { kind: "notice" }>, "generation">
        | Omit<Extract<RetryEvent, { kind: "recovery" }>, "generation">
    ) => options.context.report({ ...event, generation: attempt.generation });
    const correlated =
      isRecord(response) &&
      response.requestId === attempt.id &&
      response.scopeKey === scopeKey;
    const recover = (reason: RecoveryReason) => {
      const message = recoveryMessage(reason);
      setAccepted({
        identity,
        recovery: { state: "reload-required", reason, message },
      });
      report({ kind: "recovery", reason, message });
    };
    if (
      correlated &&
      response.ok === false &&
      (response.error === "forbidden" ||
        response.error === "not_found" ||
        (student && response.error === "invalid_page"))
    ) {
      const reason = response.error;
      if (
        reason === "forbidden" ||
        reason === "not_found" ||
        reason === "invalid_page"
      )
        recover(reason);
      return;
    }
    const studentMetric =
      attempt.metric === "studentProgress" || attempt.metric === "quizAverage"
        ? attempt.metric
        : null;
    const label =
      student && studentMetric
        ? columnTitles[studentMetric]
        : (scalar?.target.label ?? "Student metrics");
    if (
      !correlated ||
      response.ok !== true ||
      response.metric !== attempt.metric ||
      typeof response.asOf !== "string" ||
      !Number.isFinite(Date.parse(response.asOf)) ||
      (student ? !isColumnResult(response) : !isMetricResult(response.result))
    ) {
      report({
        kind: "notice",
        message: `${label}: Unable to refresh ${student ? "student metrics" : "this metric"}. Please try again.`,
      });
      return;
    }
    let failed = false;
    if (student && studentMetric && isColumnResult(response)) {
      const snapshots = student.initial.snapshots;
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
        recover("membership_changed");
        return;
      }
      const column: ColumnResult = { asOf: response.asOf, rows: response.rows };
      setAccepted((previous) => ({
        identity,
        columns: {
          ...(previous &&
          sameIdentity({ left: previous.identity, right: identity })
            ? previous.columns
            : {}),
          [studentMetric]: column,
        },
      }));
      failed = response.rows.some((row) => row.result.state === "error");
    } else if (scalar && isMetricResult(response.result)) {
      setAccepted({
        identity,
        metric: { metric: response.result, asOf: response.asOf },
      });
      failed = response.result.state === "error";
    }
    const prefix =
      scalar?.target.kind === "summary"
        ? `${scalar.target.course.title}: `
        : "";
    const time = new Date(response.asOf).toLocaleString("en-US", {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    });
    report({
      kind: "notice",
      message: failed
        ? `${prefix}${label}: Unable to load ${student ? "student metrics" : "this metric"}.`
        : `${prefix}${label} refreshed at ${time} UTC. Other ${student ? "student " : ""}metrics keep their earlier observation times.`,
    });
  });

  const start = (metric: AnalyticsMetricName | StudentMetric) => {
    if (disabled || (request.current && !request.current.settled)) return;
    const attempt: Attempt = {
      id: `${options.context.generation}:${crypto.randomUUID()}`,
      generation: options.context.generation,
      identity,
      previousData: fetcher.data,
      settled: false,
      handled: false,
      metric,
    };
    request.current = attempt;
    params.set("metric", metric);
    params.set("requestId", attempt.id);
    options.context.report({
      kind: "notice",
      generation: attempt.generation,
      message: "Updating analytics",
    });
    if (student) params.set("scopeKey", scopeKey);
    void fetcher
      .load(`/api/analytics/${student ? "students/retry" : "retry"}?${params}`)
      .then(() => {
        if (mounted.current && request.current === attempt) {
          attempt.settled = true;
          updateCompletion((value) => value + 1);
        }
      });
  };
  if (student) {
    const snapshots = student.initial.snapshots;
    const columns = current?.columns;
    const value: StudentValue = {
      snapshots: {
        ...snapshots,
        rows: snapshots.rows.map((row, index) => ({
          ...row,
          studentProgress:
            columns?.studentProgress?.rows[index].result ?? row.studentProgress,
          quizAverage:
            columns?.quizAverage?.rows[index].result ?? row.quizAverage,
        })),
      },
      columns: {
        studentProgress: {
          asOf: columns?.studentProgress?.asOf ?? student.initial.asOf,
          refreshed: Boolean(columns?.studentProgress),
        },
        quizAverage: {
          asOf: columns?.quizAverage?.asOf ?? student.initial.asOf,
          refreshed: Boolean(columns?.quizAverage),
        },
      },
    };
    const activeMetric =
      busy &&
      request.current &&
      sameIdentity({ left: request.current.identity, right: identity }) &&
      (request.current.metric === "studentProgress" ||
        request.current.metric === "quizAverage")
        ? request.current.metric
        : null;
    return {
      view: current?.recovery ?? { state: "ready", value },
      busy,
      disabled,
      activeMetric,
      retry: ({ metric }) => start(metric),
    };
  }
  if (scalar) {
    return {
      view: current?.recovery ?? {
        state: "ready",
        value: current?.metric ?? scalar.initial,
      },
      busy,
      disabled,
      retry: () => start(scalar.target.metric),
    };
  }
  throw new Error("Unsupported analytics retry target");
}
