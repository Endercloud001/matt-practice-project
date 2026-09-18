import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
const getCurrentUserId = vi.hoisted(() => vi.fn());

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId,
  getSession: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

import { action, clientAction, loader } from "./courses.$slug";

function routeArgs(request: Request) {
  return {
    params: { slug: base.course.slug },
    request,
    context: undefined,
  } as never;
}

describe("course detail rating route", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
  });

  it("turns a failed rating request into a structured client error", async () => {
    const result = await clientAction({
      serverAction: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    } as never);

    if (!("data" in result)) {
      throw new Error("Expected a response with status metadata");
    }
    expect(result.data).toEqual({
      success: false,
      error: "Could not save your rating. Please try again.",
    });
    expect(result.init?.status).toBe(503);
  });

  it("uses the session identity rather than submitted identity", async () => {
    const otherStudent = testDb
      .insert(schema.users)
      .values({
        name: "Other Student",
        email: "other@example.com",
        role: schema.UserRole.Student,
      })
      .returning()
      .get();
    testDb
      .insert(schema.enrollments)
      .values([
        { userId: base.user.id, courseId: base.course.id },
        { userId: otherStudent.id, courseId: base.course.id },
      ])
      .run();
    getCurrentUserId.mockResolvedValue(base.user.id);
    const formData = new FormData();
    formData.set("rating", "4.5");
    formData.set("userId", String(otherStudent.id));

    const result = await action(
      routeArgs(
        new Request(`http://example.com/courses/${base.course.slug}`, {
          method: "POST",
          body: formData,
        })
      )
    );

    expect(result).toEqual({ success: true, rating: 4.5 });
    expect(testDb.select().from(schema.courseRatings).all()).toEqual([
      expect.objectContaining({
        userId: base.user.id,
        courseId: base.course.id,
        ratingUnits: 9,
      }),
    ]);
  });

  it("hides a public summary while Draft and restores it after republishing", async () => {
    testDb
      .insert(schema.courseRatings)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        ratingUnits: 8,
      })
      .run();
    getCurrentUserId.mockResolvedValue(null);

    const published = await loader(
      routeArgs(new Request(`http://example.com/courses/${base.course.slug}`))
    );
    expect(published.ratingSummary).toEqual({ average: 4, count: 1 });

    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Draft })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    const draft = await loader(
      routeArgs(new Request(`http://example.com/courses/${base.course.slug}`))
    );
    expect(draft.ratingSummary).toBeNull();

    testDb
      .update(schema.courses)
      .set({ status: schema.CourseStatus.Published })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    const republished = await loader(
      routeArgs(new Request(`http://example.com/courses/${base.course.slug}`))
    );
    expect(republished.ratingSummary).toEqual({ average: 4, count: 1 });
  });
});
