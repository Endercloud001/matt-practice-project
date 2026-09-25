import { UserRole } from "~/db/schema";
import type {
  AnalyticsMetric,
  CourseSummaries,
  StudentSnapshots,
} from "~/services/analyticsService";

type Range = "all" | "last7days" | "last30days" | "lastYear" | "custom";
type MetricResult = AnalyticsMetric<number>;
export type AnalyticsPageData = {
  ok: true;
  asOf: string;
  purchaseTotal: MetricResult;
  enrollmentCount: MetricResult;
  studentProgress: MetricResult;
  averageBestAttemptQuizScore: MetricResult;
  participatingStudents: MetricResult;
  quizCount: MetricResult;
  course?: { id: number; title: string };
  retentionRate: MetricResult;
  netRevenue: MetricResult;
  range: Range;
  dates: { start: string; end: string };
  courses: { id: number; title: string }[];
  instructors: { id: number; name: string }[];
  viewer: { name: string; role: UserRole };
  filters: { instructorId: number | null; courseId: number | null };
  courseSummaries?: CourseSummaries;
  studentSnapshots?: StudentSnapshots;
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

export function isMetricResult(value: unknown): value is MetricResult {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (value.state === "value") return typeof value.value === "number";
  if (value.state === "empty")
    return (
      value.reason === "no_records" ||
      value.reason === "no_authorized_courses" ||
      value.reason === "no_attempts"
    );
  if (value.state === "unavailable")
    return (
      value.reason === "missing_source_data" ||
      value.reason === "no_lessons" ||
      value.reason === "no_quizzes"
    );
  return value.state === "error" && value.reason === "read_failed";
}

function isCourseSummaries(value: unknown): value is CourseSummaries {
  if (!isRecord(value) || !Array.isArray(value.rows)) return false;
  if (
    !["page", "pageSize", "totalCount", "totalPages"].every(
      (key) => typeof value[key] === "number"
    )
  )
    return false;
  return (
    value.pageSize === 20 &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === "number" &&
        typeof row.title === "string" &&
        isMetricResult(row.purchaseTotal) &&
        isMetricResult(row.enrollmentCount) &&
        isMetricResult(row.studentProgress)
    )
  );
}

function isStudentSnapshots(value: unknown): value is StudentSnapshots {
  return (
    isRecord(value) &&
    isRecord(value.course) &&
    typeof value.course.id === "number" &&
    typeof value.course.title === "string" &&
    value.pageSize === 20 &&
    ["page", "totalCount", "totalPages"].every(
      (key) => typeof value[key] === "number"
    ) &&
    Array.isArray(value.rows) &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        typeof row.id === "number" &&
        typeof row.name === "string" &&
        typeof row.email === "string" &&
        typeof row.enrolledAt === "string" &&
        isMetricResult(row.studentProgress) &&
        isMetricResult(row.quizAverage)
    )
  );
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
      value.filters.courseId === null) &&
    (value.studentSnapshots === undefined ||
      (isStudentSnapshots(value.studentSnapshots) &&
        value.studentSnapshots.course.id ===
          (isRecord(value.course)
            ? value.course.id
            : value.filters.courseId))) &&
    (value.course !== undefined
      ? isMetricResult(value.averageBestAttemptQuizScore) &&
        isMetricResult(value.participatingStudents) &&
        isMetricResult(value.quizCount)
      : isCourseSummaries(value.courseSummaries))
  );
}

export function isAnalyticsPageError(
  value: unknown
): value is AnalyticsPageError {
  return (
    isRecord(value) && value.ok === false && typeof value.error === "string"
  );
}
