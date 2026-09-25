import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { AnalyticsStudentTable } from "~/components/analytics-student-table";
import type { StudentSnapshots } from "~/services/analyticsService";

const snapshot: StudentSnapshots = {
  course: { id: 7, title: "Learning TypeScript" },
  rows: [
    {
      id: 3,
      name: "Student Full Name",
      email: "full@example.com",
      enrolledAt: "2026-09-02T12:00:00.000Z",
      studentProgress: { state: "value", value: 0 },
      quizAverage: { state: "value", value: 0.875 },
    },
  ],
  page: 2,
  pageSize: 20,
  totalCount: 41,
  totalPages: 3,
};

function renderTable(snapshots = snapshot, disabled = false) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <AnalyticsStudentTable
            snapshots={snapshots}
            asOf="2026-09-25T00:00:00.000Z"
            disabled={disabled}
          />
        ),
      },
    ],
    {
      initialEntries: [
        "/instructor/analytics?range=custom&start=2026-09-01&end=2026-10-01&courseId=7&coursePage=3&studentPage=2",
      ],
    }
  );
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe("student snapshot presentation", () => {
  it("provides one retry per failed column with safe explanations and preserves successful values", () => {
    const snapshots: StudentSnapshots = {
      ...snapshot,
      rows: [
        {
          ...snapshot.rows[0],
          studentProgress: { state: "error", reason: "read_failed" },
        },
        {
          ...snapshot.rows[0],
          id: 4,
          studentProgress: { state: "error", reason: "read_failed" },
        },
      ],
    };
    const markup = renderTable(snapshots);
    expect(markup.match(/Retry Average Progress/g)).toHaveLength(1);
    expect(markup).not.toContain("Retry Best-Attempt Quiz Average");
    expect(markup).toContain("Unable to load student metrics");
    expect(markup).toContain("87.5%");
    expect(markup).not.toContain("aria-live=");
    const disabledMarkup = renderTable(snapshots, true);
    expect(disabledMarkup).toContain('disabled=""');
  });
  it("renders full identities, all five ordered columns and genuine zero", () => {
    const markup = renderTable();
    const columns = [
      "Name",
      "Email",
      "Enrollment Date",
      "Average Progress",
      "Best-Attempt Quiz Average",
    ];
    for (let index = 1; index < columns.length; index++)
      expect(markup.indexOf(columns[index - 1])).toBeLessThan(
        markup.indexOf(columns[index])
      );
    expect(markup).toContain("Student Full Name");
    expect(markup).toContain("full@example.com");
    expect(markup).toContain("Sep 2, 2026");
    expect(markup).toContain("0%");
    expect(markup).toContain("87.5%");
    expect(markup).toContain("Current student progress snapshot");
    expect(markup).toContain('tabindex="0"');
    expect(markup).not.toContain("aria-live=");
    expect(markup).not.toContain("Scroll horizontally");
  });

  it("preserves scope and summary page while navigating student pages", () => {
    const markup = renderTable();
    expect(markup).toContain('aria-label="Student snapshots pagination"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Page 2 of 3");
    expect(markup).toContain('aria-label="Go to student page 3"');
    expect(markup).toContain("coursePage=3&amp;studentPage=3");
    expect(markup).toContain('courseId=7&amp;coursePage=3"');
    expect(renderTable(snapshot, true)).not.toContain("href=");
  });

  it("rounds progress to whole percentages and quiz scores to one decimal", () => {
    const markup = renderTable({
      ...snapshot,
      rows: [
        {
          ...snapshot.rows[0],
          studentProgress: { state: "value", value: 100 / 3 },
          quizAverage: { state: "value", value: 0.8 },
        },
      ],
    });
    expect(markup).toContain("33%");
    expect(markup).toContain("80.0%");
  });

  it("explains unavailable progress and missing attempts without fake zero", () => {
    const markup = renderTable({
      ...snapshot,
      rows: [
        {
          ...snapshot.rows[0],
          studentProgress: { state: "unavailable", reason: "no_lessons" },
          quizAverage: { state: "empty", reason: "no_attempts" },
        },
      ],
    });
    expect(markup).toContain("No lessons in this course");
    expect(markup).toContain("No quiz attempts in the selected period");
    expect(markup).not.toContain("0%");
  });

  it("distinguishes no eligible students from an out-of-range page with recovery", () => {
    const empty = renderTable({
      ...snapshot,
      rows: [],
      page: 1,
      totalCount: 0,
      totalPages: 0,
    });
    expect(empty).toContain("No eligible students in this course");
    expect(empty).toContain("Change the date range");
    const outOfRange = renderTable({ ...snapshot, rows: [], page: 9 });
    expect(outOfRange).toContain("No students on this page");
    expect(outOfRange).toContain('aria-label="Go to student page 1"');
    expect(outOfRange).not.toContain("No eligible students in this course");
  });
});
