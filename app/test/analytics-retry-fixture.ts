import { UserRole } from "~/db/schema";
import type { AnalyticsPageData } from "~/lib/analytics-page-data";

export function analyticsRetryFixture(): AnalyticsPageData {
  const failed = { state: "error", reason: "read_failed" } as const;
  return {
    ok: true,
    asOf: "2026-09-30T00:00:00.000Z",
    purchaseTotal: failed,
    enrollmentCount: failed,
    studentProgress: failed,
    averageBestAttemptQuizScore: failed,
    participatingStudents: failed,
    quizCount: failed,
    retentionRate: { state: "unavailable", reason: "missing_source_data" },
    netRevenue: { state: "unavailable", reason: "missing_source_data" },
    range: "custom",
    dates: { start: "2026-09-01", end: "2026-10-01" },
    courses: [
      { id: 7, title: "Learning TypeScript" },
      { id: 8, title: "Other course" },
    ],
    instructors: [
      { id: 2, name: "Instructor" },
      { id: 9, name: "Other Instructor" },
    ],
    viewer: { name: "Admin", role: UserRole.Admin },
    filters: { instructorId: 2, courseId: 7 },
    courseSummaries: {
      page: 1,
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
      rows: [
        {
          id: 7,
          title: "Learning TypeScript",
          purchaseTotal: failed,
          enrollmentCount: failed,
          studentProgress: failed,
        },
      ],
    },
    studentSnapshots: {
      course: { id: 7, title: "Learning TypeScript" },
      page: 1,
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
      rows: [
        {
          id: 3,
          name: "Full Student Name",
          email: "student@example.com",
          enrolledAt: "2026-09-01T00:00:00Z",
          studentProgress: failed,
          quizAverage: failed,
        },
        {
          id: 4,
          name: "Second Student",
          email: "second@example.com",
          enrolledAt: "2026-09-01T00:00:00Z",
          studentProgress: failed,
          quizAverage: failed,
        },
      ],
    },
  };
}
