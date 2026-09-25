import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";
import { createElement } from "react";

const getCurrentUserId = vi.hoisted(() => vi.fn());
let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("~/lib/session", () => ({ getCurrentUserId }));

import { loader } from "~/routes/instructor.analytics";
import { HydrateFallback } from "~/routes/instructor.analytics";
import { renderToStaticMarkup } from "react-dom/server";

function callLoader(query = "") {
  return loader({
    request: new Request(`http://localhost/instructor/analytics${query}`),
    params: {},
    context: {},
  } as never);
}

describe("Instructor Analytics page loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.instructor.id);
  });

  it("returns all-history aggregates without student PII", async () => {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 2400,
        createdAt: "2025-03-01T00:00:00.000Z",
      })
      .run();
    testDb
      .insert(schema.enrollments)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2025-03-01T00:00:00.000Z",
      })
      .run();

    const response = await callLoader();
    const payload = await (response as Response).json();

    expect(response).toMatchObject({ status: 200 });
    expect(payload).toMatchObject({
      ok: true,
      range: "all",
      purchaseTotal: { state: "value", value: 2400 },
      enrollmentCount: { state: "value", value: 1 },
      retentionRate: { state: "unavailable", reason: "missing_source_data" },
      netRevenue: { state: "unavailable", reason: "missing_source_data" },
    });
    expect(JSON.stringify(payload)).not.toContain(base.user.name);
    expect(JSON.stringify(payload)).not.toContain(base.user.email);
  });

  it("pages only an explicitly selected course roster independently of summaries", async () => {
    const students = testDb
      .insert(schema.users)
      .values(
        Array.from({ length: 21 }, (_, index) => ({
          name: `Roster ${String(index).padStart(2, "0")}`,
          email: `roster-${index}@example.test`,
          role: schema.UserRole.Student,
        }))
      )
      .returning()
      .all();
    testDb
      .insert(schema.enrollments)
      .values(
        students.map((student) => ({
          userId: student.id,
          courseId: base.course.id,
          enrolledAt: "2026-09-02T00:00:00.000Z",
        }))
      )
      .run();
    const query = `?courseId=${base.course.id}&studentPage=2&range=custom&start=2026-09-01&end=2026-10-01`;
    const response = await callLoader(query);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      studentSnapshots: {
        page: 2,
        pageSize: 20,
        totalCount: 21,
        rows: [{ name: "Roster 20", email: "roster-20@example.test" }],
      },
      courseSummaries: { page: 1 },
    });
    expect(payload.studentSnapshots.rows).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const implicit = await (await callLoader("?studentPage=2")).json();
    expect(implicit).not.toHaveProperty("studentSnapshots");
    expect(JSON.stringify(implicit)).not.toContain("roster-20@example.test");
    const reset = await (
      await callLoader(`?courseId=${base.course.id}&range=all`)
    ).json();
    expect(reset.studentSnapshots.page).toBe(1);
  });

  it("renders one loading announcement and hides decorative fallback skeletons", () => {
    const markup = renderToStaticMarkup(createElement(HydrateFallback));
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("rejects Students and invalid custom date boundaries", async () => {
    getCurrentUserId.mockResolvedValueOnce(base.user.id);
    expect((await callLoader()) as Response).toMatchObject({ status: 403 });
    const invalid = await callLoader(
      "?range=custom&start=2025-03-02&end=2025-03-02"
    );
    expect(invalid).toMatchObject({ status: 400 });
    expect(await (invalid as Response).json()).toMatchObject({
      error: "invalid_query",
      fields: { end: expect.any(Array) },
    });
  });

  it("allows Admins to narrow to an instructor and preserves empty valid scopes", async () => {
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Analytics Admin",
        email: "analytics-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    getCurrentUserId.mockResolvedValueOnce(admin.id);

    const response = await callLoader(
      `?instructorId=${base.instructor.id}&range=last7days`
    );
    expect(await (response as Response).json()).toMatchObject({
      ok: true,
      filters: { instructorId: base.instructor.id, courseId: null },
      purchaseTotal: { state: "empty", reason: "no_records" },
    });
  });

  it("redirects anonymous sessions to login", async () => {
    getCurrentUserId.mockResolvedValueOnce(null);
    const response = await callLoader();
    expect(response).toMatchObject({ status: 302 });
    expect((response as Response).headers.get("Location")).toBe("/login");
  });

  it("accepts native empty IDs and preserves the exact custom end date", async () => {
    const response = await callLoader(
      "?range=custom&start=2025-03-01&end=2025-03-02&courseId=&instructorId="
    );
    const payload = await (response as Response).json();
    expect(response).toMatchObject({ status: 200 });
    expect(payload).toMatchObject({
      ok: true,
      range: "custom",
      dates: { start: "2025-03-01", end: "2025-03-02" },
      filters: { instructorId: null, courseId: null },
    });
  });

  it("blocks foreign and deleted courses without returning metric data", async () => {
    const foreignInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other Instructor",
        email: "other-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const foreignCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Foreign Analytics Course",
        slug: "foreign-analytics-course",
        description: "",
        categoryId: base.course.categoryId,
        status: schema.CourseStatus.Draft,
        instructorId: foreignInstructor.id,
      })
      .returning()
      .get();

    const forbidden = await callLoader(`?courseId=${foreignCourse.id}`);
    expect(forbidden).toMatchObject({ status: 403 });
    expect(await (forbidden as Response).json()).toEqual({
      ok: false,
      error: "forbidden",
    });

    testDb
      .delete(schema.courses)
      .where(eq(schema.courses.id, foreignCourse.id))
      .run();
    const deleted = await callLoader(`?courseId=${foreignCourse.id}`);
    expect(deleted).toMatchObject({ status: 404 });
    expect(await (deleted as Response).json()).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("does not silently clear an Admin course that conflicts with the selected instructor", async () => {
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Analytics Admin",
        email: "mismatch-admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Second Instructor",
        email: "second-instructor@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Second Course",
        slug: "second-course",
        description: "",
        categoryId: base.course.categoryId,
        status: schema.CourseStatus.Draft,
        instructorId: otherInstructor.id,
      })
      .returning()
      .get();
    getCurrentUserId.mockResolvedValueOnce(admin.id);

    const response = await callLoader(
      `?instructorId=${base.instructor.id}&courseId=${otherCourse.id}`
    );
    expect(response).toMatchObject({ status: 403 });
    expect(await (response as Response).json()).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
