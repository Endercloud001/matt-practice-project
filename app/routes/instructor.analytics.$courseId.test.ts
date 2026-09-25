import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { eq } from "drizzle-orm";

const getCurrentUserId = vi.hoisted(() => vi.fn());
let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
vi.mock("~/lib/session", () => ({ getCurrentUserId }));
import { loader } from "~/routes/instructor.analytics.$courseId";

function callLoader(options: { courseId?: string; query?: string } = {}) {
  const courseId = options.courseId ?? String(base.course.id);
  return loader({
    request: new Request(
      `http://localhost/instructor/analytics/${courseId}${options.query ?? ""}`
    ),
    params: { courseId },
    context: {},
  } as never);
}

describe("course analytics loader", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
    getCurrentUserId.mockReset();
    getCurrentUserId.mockResolvedValue(base.instructor.id);
  });

  it("loads the path course identity, exact custom dates and a PII-free current snapshot", async () => {
    const response = await callLoader({
      query: "?range=custom&start=2026-09-01&end=2026-10-01",
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      course: { id: base.course.id, title: base.course.title },
      filters: { courseId: base.course.id },
      range: "custom",
      dates: { start: "2026-09-01", end: "2026-10-01" },
      studentProgress: { state: "empty", reason: "no_records" },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(payload)).not.toContain(base.user.email);
    expect(JSON.stringify(payload)).not.toContain(base.user.name);
  });

  it("exposes quiz outcome metrics through the course loader", async () => {
    const courseModule = testDb
      .insert(schema.modules)
      .values({ courseId: base.course.id, title: "Quiz Module", position: 1 })
      .returning()
      .get();
    const lesson = testDb
      .insert(schema.lessons)
      .values({ moduleId: courseModule.id, title: "Quiz Lesson", position: 1 })
      .returning()
      .get();
    const quiz = testDb
      .insert(schema.quizzes)
      .values({ lessonId: lesson.id, title: "Outcome Quiz", passingScore: 0.7 })
      .returning()
      .get();
    testDb
      .insert(schema.quizAttempts)
      .values({
        userId: base.user.id,
        quizId: quiz.id,
        score: 0.6,
        passed: false,
        attemptedAt: "2026-09-10T00:00:00.000Z",
      })
      .run();

    const response = await callLoader({
      query: "?range=custom&start=2026-09-01&end=2026-10-01",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      course: { id: base.course.id },
      averageBestAttemptQuizScore: { state: "value", value: 0.6 },
      participatingStudents: { state: "value", value: 1 },
      quizCount: { state: "value", value: 1 },
    });
  });

  it("requires a session and Instructor or Admin access", async () => {
    getCurrentUserId.mockResolvedValueOnce(null);
    const anonymous = await callLoader();
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("Location")).toBe("/login");
    getCurrentUserId.mockResolvedValueOnce(base.user.id);
    const student = await callLoader();
    expect(student.status).toBe(403);
    expect(await student.json()).toEqual({ ok: false, error: "forbidden" });
  });

  it("reauthorizes a bookmark after ownership changes and distinguishes a deleted course", async () => {
    const other = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.test",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    expect((await callLoader()).status).toBe(200);
    testDb
      .update(schema.courses)
      .set({ instructorId: other.id })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    const forbidden = await callLoader();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ ok: false, error: "forbidden" });
    testDb
      .delete(schema.courses)
      .where(eq(schema.courses.id, base.course.id))
      .run();
    const deleted = await callLoader();
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toEqual({ ok: false, error: "not_found" });
  });

  it("allows Admin course access but rejects an explicit instructor mismatch", async () => {
    const admin = testDb
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.test",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    getCurrentUserId.mockResolvedValue(admin.id);
    expect((await callLoader()).status).toBe(200);
    const mismatch = await callLoader({ query: `?instructorId=${admin.id}` });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ ok: false, error: "forbidden" });
  });

  it("uses the path identity instead of allowing query parameters to switch courses", async () => {
    const response = await callLoader({ query: "?courseId=9999" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      course: { id: base.course.id },
      filters: { courseId: base.course.id },
    });
  });

  it("returns correctable date errors with the authorized course context and no metrics", async () => {
    const response = await callLoader({
      query: "?range=custom&start=2026-09-01&end=2026-09-01",
    });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: "invalid_query",
      course: { id: base.course.id },
      fields: { end: expect.any(Array) },
    });
    expect(payload).not.toHaveProperty("studentProgress");
    const missing = await callLoader({
      courseId: "9999",
      query: "?range=invalid",
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "not_found" });
  });

  it.each(["0", "-1", "1.5", "abc", "9007199254740992"])(
    "rejects malformed path course ID %s",
    async (courseId) => {
      await expect(callLoader({ courseId })).rejects.toMatchObject({
        init: { status: 400 },
      });
    }
  );
});
