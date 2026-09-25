import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  AnalyticsPage,
  CourseAnalyticsFallback,
} from "~/components/analytics-page";
import { UserRole } from "~/db/schema";

const data = {
  ok: true,
  asOf: "2026-09-24T00:00:00.000Z",
  purchaseTotal: { state: "value", value: 0 },
  enrollmentCount: { state: "value", value: 1 },
  studentProgress: { state: "value", value: 100 / 6 },
  averageBestAttemptQuizScore: { state: "value", value: 0.875 },
  participatingStudents: { state: "value", value: 3 },
  quizCount: { state: "value", value: 2 },
  retentionRate: { state: "unavailable", reason: "missing_source_data" },
  netRevenue: { state: "unavailable", reason: "missing_source_data" },
  range: "custom",
  dates: { start: "2026-09-01", end: "2026-10-01" },
  courses: [{ id: 7, title: "Learning TypeScript" }],
  instructors: [],
  viewer: { name: "Instructor", role: UserRole.Instructor },
  filters: { instructorId: null, courseId: 7 },
  courseSummaries: {
    rows: [
      {
        id: 7,
        title: "Learning TypeScript",
        purchaseTotal: { state: "value", value: 0 },
        enrollmentCount: { state: "value", value: 1 },
        studentProgress: { state: "value", value: 16.7 },
      },
    ],
    page: 1,
    pageSize: 20,
    totalCount: 1,
    totalPages: 1,
  },
};

function renderPage(loaderData: unknown, path = "/instructor/analytics") {
  const router = createMemoryRouter(
    [{ path: "*", element: <AnalyticsPage loaderData={loaderData} /> }],
    {
      initialEntries: [
        `${path}?range=custom&start=2026-09-01&end=2026-10-01&courseId=7`,
      ],
    }
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("analytics page presentation", () => {
  it("distinguishes overview period-empty progress from course enrollment-empty progress", () => {
    const emptyData = {
      ...data,
      studentProgress: { state: "empty", reason: "no_records" },
    };
    const overview = renderPage(emptyData);
    expect(overview).toContain("No data for the selected period");
    expect(overview).not.toContain("No eligible students");
    const course = renderPage(
      { ...emptyData, course: { id: 7, title: "Learning TypeScript" } },
      "/instructor/analytics/7"
    );
    expect(course).toContain("No eligible students in this course");
  });
  it("keeps course identity and submitted dates when correcting invalid filters", () => {
    const markup = renderPage(
      {
        ok: false,
        error: "invalid_query",
        fields: { end: ["End date must be after start date."] },
        course: { id: 7, title: "Learning TypeScript" },
        viewer: data.viewer,
      },
      "/instructor/analytics/7"
    );
    expect(markup).toContain("Learning TypeScript");
    expect(markup).toContain('value="2026-09-01"');
    expect(markup).toContain('value="2026-10-01"');
    expect(markup).toContain('href="/instructor/analytics/7"');
    expect(markup).not.toContain('name="courseId"');
  });

  it("announces course loading once and hides decorative skeletons", () => {
    const markup = renderToStaticMarkup(<CourseAnalyticsFallback />);
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain("Loading analytics");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("offers date-preserving recovery for a deleted course bookmark", () => {
    const markup = renderPage(
      { ok: false, error: "not_found" },
      "/instructor/analytics/7"
    );
    expect(markup).toContain("Course not found");
    expect(markup).toContain(
      'href="/instructor/analytics?range=custom&amp;start=2026-09-01&amp;end=2026-10-01"'
    );
    expect(markup).not.toContain("17%");
  });
  it("orders course identity, dates, totals and course learning outcomes", () => {
    const markup = renderPage(
      { ...data, course: { id: 7, title: "Learning TypeScript" } },
      "/instructor/analytics/7"
    );
    expect(markup).toContain("Course Average Student Learning Progress");
    expect(markup).toContain("Average Best-Attempt Quiz Score");
    expect(markup).toContain("Participating Students");
    expect(markup).toContain("Quizzes in Course");
    expect(markup).toContain("87.5%");
    expect(markup).toContain("Course learning outcomes");
    expect(markup.indexOf("Learning TypeScript")).toBeLessThan(
      markup.indexOf("Start date")
    );
    expect(markup.indexOf("Start date")).toBeLessThan(
      markup.indexOf("Purchase Total")
    );
    expect(markup.indexOf("Enrollment Count")).toBeLessThan(
      markup.indexOf("Course learning outcomes")
    );
    expect(markup).not.toContain("Retention Rate");
    expect(markup).not.toContain("Net Revenue");
    expect(markup).not.toContain('name="courseId"');
    expect(markup).toContain(
      'href="/instructor/analytics?range=custom&amp;start=2026-09-01&amp;end=2026-10-01"'
    );
  });

  it("preserves four-state quiz outcome semantics", () => {
    const markup = renderPage(
      {
        ...data,
        course: { id: 7, title: "Learning TypeScript" },
        averageBestAttemptQuizScore: { state: "empty", reason: "no_attempts" },
        participatingStudents: { state: "empty", reason: "no_records" },
        quizCount: { state: "unavailable", reason: "no_quizzes" },
      },
      "/instructor/analytics/7"
    );
    expect(markup).toContain("No quiz attempts in the selected period");
    expect(markup).toContain("No quizzes in this course.");
  });

  it("presents five named overview cards and a date-preserving course link", () => {
    const markup = renderPage(data);
    for (const name of [
      "Purchase Total",
      "Enrollment Count",
      "Average Student Learning Progress",
      "Retention Rate",
      "Net Revenue",
    ]) {
      expect(markup).toContain(name);
    }
    expect(markup.match(/<section/g)).toHaveLength(6);
    expect(markup).toContain("17%");
    expect(markup).toContain("$0.00");
    expect(markup).not.toContain("Free");
    expect(markup).toContain(
      "/instructor/analytics/7?range=custom&amp;start=2026-09-01&amp;end=2026-10-01"
    );
    expect(markup.match(/role="status"/g)).toHaveLength(1);
  });

  it("renders accessible course-summary pagination and preserves dates", () => {
    const markup = renderPage({
      ...data,
      courseSummaries: {
        ...data.courseSummaries,
        page: 2,
        totalCount: 21,
        totalPages: 2,
      },
    });
    expect(markup).toContain('aria-label="Course summaries pagination"');
    expect(markup).toContain("Page 2 of 2");
    expect(markup).toContain(
      'href="/instructor/analytics?range=custom&amp;start=2026-09-01&amp;end=2026-10-01&amp;courseId=7"'
    );
    expect(markup).toContain('aria-disabled="true"');
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
  });

  it("explains summary states and offers recovery from an empty out-of-range page", () => {
    const markup = renderPage({
      ...data,
      courseSummaries: {
        ...data.courseSummaries,
        rows: [],
        page: 2,
        totalCount: 1,
        totalPages: 1,
      },
    });
    expect(markup).toContain("No courses available to compare.");
    expect(markup).toContain('aria-label="Go to page 1"');
    expect(markup).toContain(
      'href="/instructor/analytics?range=custom&amp;start=2026-09-01&amp;end=2026-10-01&amp;courseId=7"'
    );

    const states = renderPage({
      ...data,
      courseSummaries: {
        ...data.courseSummaries,
        rows: [
          {
            ...data.courseSummaries.rows[0],
            purchaseTotal: { state: "empty", reason: "no_records" },
            enrollmentCount: { state: "unavailable", reason: "no_lessons" },
            studentProgress: { state: "error", reason: "read_failed" },
          },
        ],
      },
    });
    expect(states).toContain("No records for the selected period");
    expect(states).toContain("Unavailable for the selected data");
    expect(states).toContain("Unable to load this metric");
  });
});
