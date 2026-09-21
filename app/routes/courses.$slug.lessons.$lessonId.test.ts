import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: { id: number };
const getCurrentUserId = vi.hoisted(() => vi.fn());

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("~/lib/session", () => ({ getCurrentUserId }));
vi.mock("~/lib/country.server", () => ({ resolveCountry: vi.fn().mockResolvedValue("US") }));

import { action, clientAction, shouldRevalidate } from "./courses.$slug.lessons.$lessonId";

function routeArgs(request: Request) {
  return {
    params: { slug: base.course.slug, lessonId: String(lesson.id) },
    request,
    context: undefined,
  } as never;
}

describe("lesson bookmark route", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    const module = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Module", position: 1 })
      .returning()
      .get();
    lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: module.id, title: "Lesson", position: 1 })
      .returning()
      .get();
    testDb.insert(schema.enrollments).values({ userId: base.user.id, courseId: base.course.id }).run();
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.user.id);
  });

  it("uses the session identity and returns an explicit bookmark success", async () => {
    const otherStudent = testDb
      .insert(schema.users)
      .values({ name: "Other", email: "other@example.com", role: schema.UserRole.Student })
      .returning()
      .get();
    const formData = new FormData();
    formData.set("intent", "bookmark");
    formData.set("bookmarked", "true");
    formData.set("userId", String(otherStudent.id));

    await expect(action(routeArgs(new Request("http://example.com", { method: "POST", body: formData })))).resolves.toEqual({
      success: true,
      bookmark: { lessonId: lesson.id, bookmarked: true },
    });
    expect(testDb.select().from(schema.lessonBookmarks).all()).toEqual([
      expect.objectContaining({ userId: base.user.id, lessonId: lesson.id }),
    ]);
  });

  it("turns a lost bookmark response into an unconfirmed local result", async () => {
    const formData = new FormData();
    formData.set("intent", "bookmark");
    const result = await clientAction({
      request: new Request("http://example.com", { method: "POST", body: formData }),
      serverAction: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    } as never);

    expect(result).toMatchObject({
      data: { success: false, error: "Bookmark save outcome is unconfirmed. Refresh to reconcile with the server." },
      init: { status: 503 },
    });
  });

  it("does not revalidate the page after a confirmed bookmark save", () => {
    expect(
      shouldRevalidate({
        formData: new FormData(),
        actionResult: { success: true, bookmark: { lessonId: lesson.id, bookmarked: true } },
        defaultShouldRevalidate: true,
      } as never)
    ).toBe(true);

    const formData = new FormData();
    formData.set("intent", "bookmark");
    expect(
      shouldRevalidate({
        formData,
        actionResult: { success: true, bookmark: { lessonId: lesson.id, bookmarked: true } },
        defaultShouldRevalidate: true,
      } as never)
    ).toBe(false);

    expect(
      shouldRevalidate({
        formData,
        actionResult: { success: false, error: "Only enrolled Students can manage bookmarks." },
        defaultShouldRevalidate: true,
      } as never)
    ).toBe(true);
  });
});
