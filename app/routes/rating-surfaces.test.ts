import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

vi.mock("~/lib/session", () => ({
  getCurrentUserId: vi.fn().mockResolvedValue(null),
  getDevCountry: vi.fn().mockResolvedValue(null),
  getSession: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

import { loader as homeLoader } from "./home";
import { loader as browseLoader } from "./courses";

describe("public rating surfaces", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  it("loads a Published course summary for Featured and Browse cards", async () => {
    testDb
      .insert(schema.courseRatings)
      .values({
        courseId: base.course.id,
        userId: base.user.id,
        ratingUnits: 9,
      })
      .run();

    const home = await homeLoader({
      request: new Request("http://example.com/"),
      params: {},
      context: undefined,
    } as never);
    const browse = await browseLoader({
      request: new Request("http://example.com/courses"),
      params: {},
      context: undefined,
    } as never);

    expect(home.featuredCourses[0]).toMatchObject({
      ratingAverage: 4.5,
      ratingCount: 1,
    });
    expect(browse.courses[0]).toMatchObject({
      ratingAverage: 4.5,
      ratingCount: 1,
    });
  });

  it("loads zero-count courses without a fabricated average", async () => {
    const home = await homeLoader({
      request: new Request("http://example.com/"),
      params: {},
      context: undefined,
    } as never);

    expect(home.featuredCourses[0]).toMatchObject({
      ratingAverage: null,
      ratingCount: 0,
    });
  });
});
