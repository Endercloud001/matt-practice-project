import { UserRole } from "~/db/schema";
import type { AnalyticsMetric } from "~/services/analyticsService";

type Range = "all" | "last7days" | "last30days" | "lastYear" | "custom";
type MetricResult = AnalyticsMetric<number>;
export type AnalyticsPageData = {
  ok: true;
  asOf: string;
  purchaseTotal: MetricResult;
  enrollmentCount: MetricResult;
  studentProgress: MetricResult;
  course?: { id: number; title: string };
  retentionRate: MetricResult;
  netRevenue: MetricResult;
  range: Range;
  dates: { start: string; end: string };
  courses: { id: number; title: string }[];
  instructors: { id: number; name: string }[];
  viewer: { name: string; role: UserRole };
  filters: { instructorId: number | null; courseId: number | null };
};
export type AnalyticsPageError = {
  course?: { id: number; title: string };
  ok: false;
  error: string;
  fields?: Record<string, string[]>;
  courses?: { id: number; title: string }[];
  instructors?: { id: number; name: string }[];
  viewer?: { name: string; role: UserRole };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMetricResult(value: unknown): value is MetricResult {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "value") return typeof value.value === "number";
  if (value.state === "empty")
    return (
      value.reason === "no_records" || value.reason === "no_authorized_courses"
    );
  if (value.state === "unavailable")
    return (
      value.reason === "missing_source_data" || value.reason === "no_lessons"
    );
  return value.state === "error" && value.reason === "read_failed";
}

export function isAnalyticsPageData(
  value: unknown
): value is AnalyticsPageData {
  return (
    isRecord(value) &&
    value.ok === true &&
    (value.course === undefined ||
      (isRecord(value.course) &&
        typeof value.course.id === "number" &&
        typeof value.course.title === "string")) &&
    typeof value.asOf === "string" &&
    isMetricResult(value.purchaseTotal) &&
    isMetricResult(value.enrollmentCount) &&
    isMetricResult(value.studentProgress) &&
    isMetricResult(value.retentionRate) &&
    isMetricResult(value.netRevenue) &&
    ["all", "last7days", "last30days", "lastYear", "custom"].includes(
      String(value.range)
    ) &&
    isRecord(value.dates) &&
    typeof value.dates.start === "string" &&
    typeof value.dates.end === "string" &&
    Array.isArray(value.courses) &&
    value.courses.every(
      (course) =>
        isRecord(course) &&
        typeof course.id === "number" &&
        typeof course.title === "string"
    ) &&
    Array.isArray(value.instructors) &&
    value.instructors.every(
      (instructor) =>
        isRecord(instructor) &&
        typeof instructor.id === "number" &&
        typeof instructor.name === "string"
    ) &&
    isRecord(value.viewer) &&
    typeof value.viewer.name === "string" &&
    (value.viewer.role === UserRole.Admin ||
      value.viewer.role === UserRole.Instructor) &&
    isRecord(value.filters) &&
    (typeof value.filters.instructorId === "number" ||
      value.filters.instructorId === null) &&
    (typeof value.filters.courseId === "number" ||
      value.filters.courseId === null)
  );
}

export function isAnalyticsPageError(
  value: unknown
): value is AnalyticsPageError {
  return (
    isRecord(value) && value.ok === false && typeof value.error === "string"
  );
}
