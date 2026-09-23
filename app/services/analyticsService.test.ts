import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import { getPurchaseTotal } from "~/services/analyticsService";

function createAdmin() {
  return testDb
    .insert(schema.users)
    .values({
      name: "Admin",
      email: "admin@example.com",
      role: schema.UserRole.Admin,
    })
    .returning()
    .get();
}

function createCourse(instructorId: number, title: string) {
  return testDb
    .insert(schema.courses)
    .values({
      title,
      slug: title.toLowerCase().replaceAll(" ", "-"),
      description: "Course",
      instructorId,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

function purchase(courseId: number, pricePaid: number, createdAt: string) {
  testDb
    .insert(schema.purchases)
    .values({ userId: base.user.id, courseId, pricePaid, createdAt })
    .run();
}

describe("analyticsService Purchase Total", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("sums each purchase row once within an inclusive-start exclusive-end UTC period", () => {
    purchase(base.course.id, 1250, "2025-03-01T00:00:00.000Z");
    purchase(base.course.id, 1250, "2025-03-15T23:59:59.999Z");
    purchase(base.course.id, 9999, "2025-03-16T00:00:00.000Z");

    expect(
      getPurchaseTotal({
        userId: base.instructor.id,
        start: "2025-03-01T00:00:00.000Z",
        end: "2025-03-16T00:00:00.000Z",
      })
    ).toMatchObject({
      ok: true,
      currency: "USD",
      purchaseTotal: { state: "value", cents: 2500 },
    });
  });

  it("counts separate identical purchases and distinguishes recorded zero from no purchases", () => {
    purchase(base.course.id, 800, "2025-03-01T12:00:00.000Z");
    purchase(base.course.id, 800, "2025-03-01T12:00:00.000Z");
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "value", cents: 1600 },
    });

    testDb.delete(schema.purchases).run();
    purchase(base.course.id, 0, "2025-03-01T12:00:00.000Z");
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "value", cents: 0 },
    });

    testDb.delete(schema.purchases).run();
    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { state: "empty", reason: "no_purchases" },
    });
  });

  it("limits Instructors to current ownership and lets Admins narrow global scope", () => {
    const secondInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Second",
        email: "second@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(secondInstructor.id, "Other Course");
    purchase(base.course.id, 100, "2025-03-01T12:00:00.000Z");
    purchase(otherCourse.id, 300, "2025-03-01T12:00:00.000Z");

    expect(getPurchaseTotal({ userId: base.instructor.id })).toMatchObject({
      purchaseTotal: { cents: 100 },
    });
    const admin = createAdmin();
    expect(
      getPurchaseTotal({ userId: admin.id, instructorId: secondInstructor.id })
    ).toMatchObject({ purchaseTotal: { cents: 300 } });
    expect(
      getPurchaseTotal({ userId: admin.id, courseId: otherCourse.id })
    ).toMatchObject({ purchaseTotal: { cents: 300 } });
  });

  it("keeps an Instructor's purchase total scoped to their courses when an instructor filter is supplied", () => {
    const secondInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Second",
        email: "second@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(secondInstructor.id, "Other Course");
    purchase(base.course.id, 100, "2025-03-01T12:00:00.000Z");
    purchase(otherCourse.id, 900, "2025-03-01T12:00:00.000Z");

    expect(
      getPurchaseTotal({
        userId: base.instructor.id,
        instructorId: secondInstructor.id,
      })
    ).toMatchObject({
      purchaseTotal: { state: "value", cents: 100 },
      filters: { instructorId: null },
    });
  });

  it("rejects Students, distinguishes forbidden and deleted courses, and rechecks ownership", () => {
    expect(getPurchaseTotal({ userId: base.user.id })).toEqual({
      ok: false,
      error: "forbidden",
    });
    const anotherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const otherCourse = createCourse(anotherInstructor.id, "Other Course");
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: otherCourse.id })
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: 99999 })
    ).toEqual({ ok: false, error: "not_found" });

    testDb
      .update(schema.courses)
      .set({ instructorId: anotherInstructor.id })
      .where(eq(schema.courses.id, base.course.id))
      .run();
    expect(
      getPurchaseTotal({ userId: base.instructor.id, courseId: base.course.id })
    ).toEqual({ ok: false, error: "forbidden" });
  });

  it("returns a successful empty result for an Instructor with no courses", () => {
    const otherInstructor = testDb
      .insert(schema.users)
      .values({
        name: "Other",
        email: "other@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    testDb
      .delete(schema.courses)
      .where(eq(schema.courses.id, base.course.id))
      .run();
    expect(getPurchaseTotal({ userId: otherInstructor.id })).toMatchObject({
      ok: true,
      purchaseTotal: { state: "empty", reason: "no_authorized_courses" },
    });
  });
});
