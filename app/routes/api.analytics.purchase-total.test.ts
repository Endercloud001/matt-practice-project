import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { loader } from "~/routes/api.analytics.purchase-total";

function callLoader(query = "") {
  return loader({
    request: new Request(
      `http://localhost/api/analytics/purchase-total${query}`
    ),
    params: {},
    context: {},
  } as never);
}

describe("Purchase Total HTTP resource", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.instructor.id);
  });

  it("returns a real authenticated JSON result with default all-history scope and no PII", async () => {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 2468,
        createdAt: "2025-03-01T12:00:00.000Z",
      })
      .run();
    const response = await callLoader();
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      timezone: "UTC",
      currency: "USD",
      locale: "en-US",
      purchaseTotal: { state: "value", cents: 2468 },
      filters: {
        range: "all",
        instructorId: null,
        courseId: null,
        start: null,
        end: null,
      },
    });
    expect((response as Response).headers.get("Cache-Control")).toBe(
      "private, no-store"
    );
    expect(JSON.stringify(payload)).not.toContain("test@example.com");
  });

  it("redirects without a session and rejects Student accounts", async () => {
    getCurrentUserId.mockResolvedValueOnce(null);
    expect((await callLoader()) as Response).toMatchObject({ status: 302 });
    getCurrentUserId.mockResolvedValueOnce(base.user.id);
    expect((await callLoader()) as Response).toMatchObject({ status: 403 });
  });

  it.each([
    ["?range=bad", "range"],
    ["?range=custom&start=2025-02-30&end=2025-03-01", "start"],
    ["?range=custom&start=2025-03-02&end=2025-03-02", "end"],
    ["?range=custom&start=2025-03-03&end=2025-03-02", "end"],
    ["?range=custom", "start"],
    ["?courseId=0", "courseId"],
    ["?courseId=9007199254740992", "courseId"],
  ])("returns field errors for URL filters %s", async (query, field) => {
    const response = await callLoader(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "invalid_query",
      fields: { [field]: expect.any(Array) },
    });
  });

  it("maps existing unauthorized and deleted course scopes to 403 and 404", async () => {
    const response = await callLoader(`?courseId=${base.course.id + 10}`);
    expect(response.status).toBe(404);
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "Other",
        instructorId: otherInstructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const forbidden = await callLoader(`?courseId=${otherCourse.id}`);
    expect(forbidden.status).toBe(403);
  });

  it("uses UTC calendar dates and accepts valid future periods as empty", async () => {
    testDb
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        pricePaid: 111,
        createdAt: "2025-03-02T00:00:00.000Z",
      })
      .run();
    const bounded = await callLoader(
      "?range=custom&start=2025-03-02&end=2025-03-03"
    );
    expect(await bounded.json()).toMatchObject({
      purchaseTotal: { state: "value", cents: 111 },
    });
    const future = await callLoader(
      "?range=custom&start=2099-01-01&end=2099-01-02"
    );
    expect(await future.json()).toMatchObject({
      purchaseTotal: { state: "empty", reason: "no_purchases" },
    });
  });

  it.each([
    ["last7days", "2026-09-17T00:00:00.000Z"],
    ["last30days", "2026-08-25T00:00:00.000Z"],
    ["lastYear", "2025-09-24T00:00:00.000Z"],
  ])(
    "normalizes the %s preset to UTC calendar bounds",
    async (range, start) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-23T15:45:00.000Z"));
      const response = await callLoader(`?range=${range}`);
      const payload = await response.json();

      expect(payload.filters).toMatchObject({
        range,
        start,
        end: "2026-09-24T00:00:00.000Z",
      });
    }
  );

  it("does not present an ignored Instructor filter as active", async () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "Other",
        instructorId: otherInstructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    testDb
      .insert(schema.purchases)
      .values([
        {
          userId: base.user.id,
          courseId: base.course.id,
          pricePaid: 100,
          createdAt: "2025-03-01T12:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: otherCourse.id,
          pricePaid: 900,
          createdAt: "2025-03-01T12:00:00.000Z",
        },
      ])
      .run();

    const response = await callLoader(`?instructorId=${otherInstructor.id}`);
    expect(await response.json()).toMatchObject({
      purchaseTotal: { state: "value", cents: 100 },
      filters: { instructorId: null },
    });
  });

  it("lets an Admin see purchases from all instructors by default", async () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = testDb
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "Other",
        instructorId: otherInstructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    testDb
      .insert(schema.purchases)
      .values([
        {
          userId: base.user.id,
          courseId: base.course.id,
          pricePaid: 100,
          createdAt: "2025-03-01T12:00:00.000Z",
        },
        {
          userId: base.user.id,
          courseId: otherCourse.id,
          pricePaid: 900,
          createdAt: "2025-03-01T12:00:00.000Z",
        },
      ])
      .run();
    getCurrentUserId.mockResolvedValueOnce(admin.id);

    const response = await callLoader();
    expect(await response.json()).toMatchObject({
      purchaseTotal: { state: "value", cents: 1000 },
      filters: { instructorId: null },
    });
  });
});
