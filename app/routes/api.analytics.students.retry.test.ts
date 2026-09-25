import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
import { loader } from "~/routes/api.analytics.students.retry";

function requestRetry(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    courseId: String(base.course.id),
    metric: "studentProgress",
    range: "custom",
    start: "2026-09-01",
    end: "2026-10-01",
    requestId: "retry-1",
    scopeKey: "course-current",
    ...overrides,
  });
  return loader({
    request: new Request(
      `http://localhost/api/analytics/students/retry?${params}`
    ),
    params: {},
    context: {},
  } as never);
}

describe("student snapshot metric retry loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.instructor.id);
    testDb
      .insert(schema.enrollments)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: "2026-09-02T00:00:00.000Z",
      })
      .run();
  });

  it("returns the requested column and request scope without student identity or sibling metrics", async () => {
    const response = await requestRetry();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      metric: "studentProgress",
      requestId: "retry-1",
      scopeKey: "course-current",
      page: 1,
      totalCount: 1,
      rows: [
        {
          id: base.user.id,
          result: { state: "unavailable", reason: "no_lessons" },
        },
      ],
    });
    expect(payload).not.toHaveProperty("quizAverage");
    expect(JSON.stringify(payload)).not.toContain(base.user.email);
    expect(JSON.stringify(payload)).not.toContain(base.user.name);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const empty = await (
      await requestRetry({ start: "2026-10-01", end: "2026-11-01" })
    ).json();
    expect(empty.rows).toEqual([]);
  });

  it("reauthorizes ownership on retry without leaking a stale roster", async () => {
    testDb
      .update(schema.courses)
      .set({ instructorId: base.user.id })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    const response = await requestRetry();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: "forbidden",
      requestId: "retry-1",
      scopeKey: "course-current",
    });
  });

  it("requires a session and rejects student viewers", async () => {
    getCurrentUserId.mockResolvedValueOnce(null);
    expect((await requestRetry()).headers.get("Location")).toBe("/login");
    getCurrentUserId.mockResolvedValueOnce(base.user.id);
    expect((await requestRetry()).status).toBe(403);
  });

  it.each<Record<string, string>>([
    { courseId: "" },
    { metric: "purchaseTotal" },
    { requestId: "" },
    { scopeKey: "" },
    { studentPage: "0" },
  ])("rejects invalid query %j", async (overrides) => {
    const response = await requestRetry(overrides);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "invalid_query",
    });
  });
});
