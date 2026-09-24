import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

const getCurrentUserId = vi.hoisted(() => vi.fn());
let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("~/lib/session", () => ({ getCurrentUserId }));

import { loader } from "~/routes/api.analytics.retry";

function callLoader(query: string) {
  return loader({
    request: new Request(`http://localhost/api/analytics/retry${query}`),
    params: {},
    context: {},
  } as never);
}

describe("analytics metric retry resource", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.instructor.id);
  });

  it("retries only course student progress with the exact date scope", async () => {
    const response = await callLoader(
      `?metric=studentProgress&courseId=${base.course.id}&range=custom&start=2026-09-01&end=2026-10-01&requestId=course-observation`
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      metric: "studentProgress",
      result: { state: "empty", reason: "no_records" },
      requestId: "course-observation",
      scopeKey: `courseId=${base.course.id}&range=custom&start=2026-09-01&end=2026-10-01`,
    });
    expect(payload).not.toHaveProperty("enrollmentCount");
    expect(payload).not.toHaveProperty("purchaseTotal");
  });

  it("returns only the requested metric with its matching scope and request ID", async () => {
    testDb
      .insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    const response = await callLoader(
      `?metric=enrollmentCount&courseId=${base.course.id}&range=all&requestId=entry-a%3A1`
    );
    const payload = await (response as Response).json();

    expect(response).toMatchObject({ status: 200 });
    expect(payload).toMatchObject({
      ok: true,
      metric: "enrollmentCount",
      result: { state: "value", value: 1 },
      requestId: "entry-a:1",
      scopeKey: `courseId=${base.course.id}&range=all`,
    });
    expect(payload).not.toHaveProperty("purchaseTotal");
    expect((response as Response).headers.get("Cache-Control")).toBe(
      "private, no-store"
    );
  });

  it("rejects metric names outside the shared analytics metric list", async () => {
    const response = await callLoader(
      "?metric=studentNames&range=all&requestId=entry-invalid"
    );
    expect(response).toMatchObject({ status: 400 });
    expect(await (response as Response).json()).toEqual({
      ok: false,
      error: "invalid_query",
    });
  });

  it("returns authorization errors for the requested scope and redirects without a session", async () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const course = testDb
      .insert(schema.courses)
      .values({
        title: "Other Course",
        slug: "other-course",
        description: "Course",
        instructorId: other.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const forbidden = await callLoader(
      `?metric=enrollmentCount&courseId=${course.id}&range=all&requestId=entry-b%3A2`
    );
    expect(forbidden).toMatchObject({ status: 403 });
    expect(await (forbidden as Response).json()).toMatchObject({
      error: "forbidden",
      requestId: "entry-b:2",
    });

    getCurrentUserId.mockResolvedValueOnce(null);
    expect(
      (await callLoader(
        "?metric=enrollmentCount&range=all&requestId=entry-c%3A3"
      )) as Response
    ).toMatchObject({ status: 302 });
  });
});
