// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useLoaderData,
  redirect,
} from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import { prepareReactDom } from "~/test/dom";
let testDb: ReturnType<typeof createTestDb>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
import { AnalyticsPage } from "~/components/analytics-page";
import { analyticsRetryFixture } from "~/test/analytics-retry-fixture";

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  prepareReactDom();
  testDb = createTestDb();
  seedBaseData(testDb);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

async function mountPage({
  course = false,
  navigatePending = false,
}: { course?: boolean; navigatePending?: boolean } = {}) {
  const data = analyticsRetryFixture();
  if (course) data.course = { id: 7, title: "Learning TypeScript" };
  const requests: Request[] = [];
  const completions: ((value: unknown) => void)[] = [];
  const failures: ((reason: unknown) => void)[] = [];
  let navigateDone: ((value: typeof data) => void) | undefined;
  function Screen() {
    return <AnalyticsPage loaderData={useLoaderData()} />;
  }
  const retryLoader = ({ request }: { request: Request }) => {
    requests.push(request);
    return new Promise<unknown>((resolve, reject) => {
      completions.push(resolve);
      failures.push(reject);
    });
  };
  const pathname = course ? "/instructor/analytics/7" : "/instructor/analytics";
  router = createMemoryRouter(
    [
      {
        path: pathname,
        hydrateFallbackElement: <p>Loading analytics</p>,
        element: <Screen />,
        errorElement: <p>Route error boundary</p>,
        loader: ({ request }) =>
          navigatePending && new URL(request.url).searchParams.has("pending")
            ? new Promise<typeof data>((resolve) => {
                navigateDone = resolve;
              })
            : data,
      },
      { path: "/api/analytics/retry", loader: retryLoader },
      { path: "/api/analytics/students/retry", loader: retryLoader },
      { path: "/login", element: <p>Login</p> },
    ],
    {
      initialEntries: [
        `${pathname}?range=custom&start=2026-09-01&end=2026-10-01&instructorId=2&courseId=7`,
      ],
    }
  );
  await act(async () =>
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  );
  const finish = async ({
    index,
    payload,
  }: {
    index: number;
    payload: Record<string, unknown>;
  }) => {
    const url = new URL(requests[index].url);
    const params = url.searchParams;
    const scopeKey =
      params.get("scopeKey") ??
      new URLSearchParams(
        [...params].filter(([key]) => key !== "metric" && key !== "requestId")
      ).toString();
    await act(async () =>
      completions[index]({
        ok: true,
        requestId: params.get("requestId"),
        scopeKey,
        metric: params.get("metric"),
        asOf: "2026-09-30T01:00:00Z",
        ...payload,
      })
    );
  };
  return {
    data,
    requests,
    finish,
    completions,
    failures,
    navigateDone: () => navigateDone?.(data),
  };
}
function button(text: string) {
  const element = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === text
  );
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function cardButton(name: string) {
  const element = container.querySelector<HTMLButtonElement>(
    `[aria-labelledby="${name}-title"] button`
  );
  if (!element) throw new Error(`Missing retry for ${name}`);
  return element;
}
const status = () => container.querySelector('[role="status"]')?.textContent;

it("keeps independent cards concurrent, disables filters/pagination/student retries and announces the latest accepted completion", async () => {
  const screen = await mountPage();
  await act(async () => cardButton("purchaseTotal").click());
  expect(cardButton("purchaseTotal").disabled).toBe(true);
  expect(cardButton("enrollmentCount").disabled).toBe(false);
  expect(button("Retry Average Progress").disabled).toBe(true);
  expect(container.querySelector("fieldset[disabled]")).not.toBeNull();
  expect(
    container.querySelector('a[aria-label="Go to student page 2"]')
  ).toBeNull();
  expect(container.querySelector('a[aria-label="Go to page 2"]')).toBeNull();
  expect(
    container.querySelector('a[href^="/instructor/analytics/7"]')
  ).not.toBeNull();
  await act(async () => cardButton("enrollmentCount").click());
  expect(screen.requests).toHaveLength(2);
  await screen.finish({
    index: 1,
    payload: { result: { state: "value", value: 8 } },
  });
  expect(status()).toBe("Updating analytics");
  await screen.finish({
    index: 0,
    payload: {
      result: { state: "value", value: 0 },
      asOf: "2026-09-30T02:00:00Z",
    },
  });
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(status()).toContain("Purchase Total refreshed");
  expect(
    container
      .querySelector('[aria-labelledby="purchaseTotal-title"] time')
      ?.getAttribute("datetime")
  ).toBe("2026-09-30T02:00:00Z");
  expect(
    container
      .querySelector('[aria-labelledby="enrollmentCount-title"] time')
      ?.getAttribute("datetime")
  ).toBe("2026-09-30T01:00:00Z");
  expect(status()).toContain(
    "Other metrics keep their earlier observation times"
  );
  expect(
    container.querySelector('[aria-labelledby="purchaseTotal-title"]')
      ?.textContent
  ).toContain("$0.00");
  expect(
    container.querySelector('[aria-labelledby="enrollmentCount-title"]')
      ?.textContent
  ).toContain("8");
  expect(button("Retry Average Progress").disabled).toBe(false);
});

it("accepts Student completion while a card remains busy and retains both refreshed columns", async () => {
  const screen = await mountPage();
  await act(async () => button("Retry Average Progress").click());
  expect(button("Retry Best-Attempt Quiz Average").disabled).toBe(true);
  expect(cardButton("purchaseTotal").disabled).toBe(false);
  await act(async () => cardButton("purchaseTotal").click());
  const column = {
    course: { id: 7 },
    page: 1,
    pageSize: 20,
    totalCount: 21,
    totalPages: 2,
    rows: [
      { id: 3, result: { state: "value", value: 75 } },
      { id: 4, result: { state: "value", value: 50 } },
    ],
  };
  await screen.finish({ index: 0, payload: column });
  expect(container.querySelector("table")?.textContent).toContain("75%");
  expect(status()).toBe("Updating analytics");
  await screen.finish({
    index: 1,
    payload: { result: { state: "value", value: 10 } },
  });
  await act(async () => button("Retry Best-Attempt Quiz Average").click());
  await screen.finish({
    index: 2,
    payload: {
      ...column,
      asOf: "2026-09-30T02:00:00Z",
      rows: [
        { id: 3, result: { state: "value", value: 0.8 } },
        { id: 4, result: { state: "value", value: 0.6 } },
      ],
    },
  });
  expect(container.querySelector("table")?.textContent).toContain("75%");
  expect(container.querySelector("table")?.textContent).toContain("80.0%");
  expect(container.textContent).toContain("Full Student Name");
  expect(
    [...container.querySelectorAll("time")].map((time) => time.dateTime)
  ).toContain("2026-09-30T01:00:00Z");
  expect(
    [...container.querySelectorAll("time")].map((time) => time.dateTime)
  ).toContain("2026-09-30T02:00:00Z");
  expect(status()).toContain("Best-Attempt Quiz Average refreshed");
});

it.each([
  { course: { id: 8 } },
  { page: 2 },
  { pageSize: 10 },
  { totalCount: 22 },
  { totalPages: 3 },
  {
    rows: [
      { id: 4, result: { state: "value", value: 3 } },
      { id: 3, result: { state: "value", value: 3 } },
    ],
  },
  {
    rows: [
      { id: 999, result: { state: "value", value: 3 } },
      { id: 4, result: { state: "value", value: 3 } },
    ],
  },
  { rows: [] },
])(
  "removes the entire dashboard and roster on membership mismatch %j",
  async (mismatch) => {
    const screen = await mountPage();
    await act(async () => button("Retry Average Progress").click());
    await screen.finish({
      index: 0,
      payload: {
        course: { id: 7 },
        page: 1,
        pageSize: 20,
        totalCount: 21,
        totalPages: 2,
        rows: [
          { id: 3, result: { state: "value", value: 3 } },
          { id: 4, result: { state: "value", value: 3 } },
        ],
        ...mismatch,
      },
    });
    expect(container.querySelector("h1")?.textContent).toBe(
      "Student membership changed"
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("student@example.com");
    expect(
      container.querySelector('[aria-labelledby="purchaseTotal-title"]')
    ).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/instructor/analytics?range=custom&start=2026-09-01&end=2026-10-01"
    );
  }
);

it.each(["forbidden", "not_found", "invalid_page"])(
  "prioritizes whole-page recovery for Student %s",
  async (error) => {
    const screen = await mountPage();
    await act(async () => button("Retry Average Progress").click());
    await act(async () => cardButton("purchaseTotal").click());
    await screen.finish({
      index: 0,
      payload: { ok: false, error, metric: undefined },
    });
    await screen.finish({
      index: 1,
      payload: { result: { state: "value", value: 99 } },
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("student@example.com");
    expect(container.querySelector("h1")?.textContent).toBe(
      error === "forbidden"
        ? "Analytics access changed"
        : error === "not_found"
          ? "Course no longer available"
          : "Student membership changed"
    );
  }
);

it.each(["courseId=8", "instructorId=9"])(
  "hides the old roster during scope navigation %s and ignores late recovery",
  async (nextScope) => {
    const screen = await mountPage({ navigatePending: true });
    await act(async () => button("Retry Average Progress").click());
    let navigation: Promise<void> | undefined;
    await act(async () => {
      navigation = router.navigate(
        `/instructor/analytics?pending=1&${nextScope}`
      );
    });
    expect(container.querySelector("table")).toBeNull();
    await screen.finish({
      index: 0,
      payload: { ok: false, error: "forbidden" },
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      screen.navigateDone();
      await navigation;
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  }
);

it("preserves the same-course roster with an Updating explanation during navigation", async () => {
  const screen = await mountPage({ navigatePending: true });
  let navigation: Promise<void> | undefined;
  await act(async () => {
    navigation = router.navigate(
      "/instructor/analytics?pending=1&courseId=7&instructorId=2&range=all"
    );
  });
  expect(container.textContent).toContain("student@example.com");
  expect(container.textContent).toContain(
    "Updating · Showing previous results"
  );
  expect(button("Retry Average Progress").disabled).toBe(true);
  await act(async () => {
    screen.navigateDone();
    await navigation;
  });
});

it("keeps session redirect handling in React Router", async () => {
  const screen = await mountPage();
  await act(async () => cardButton("purchaseTotal").click());
  await act(async () => screen.completions[0](redirect("/login")));
  expect(container.textContent).toBe("Login");
});

it("leaves thrown loaders to the Router error boundary without fabricating empty metrics", async () => {
  const screen = await mountPage();
  await act(async () => cardButton("purchaseTotal").click());
  await act(async () => screen.failures[0](new Error("Read transport failed")));
  expect(container.textContent).toBe("Route error boundary");
  expect(container.querySelector("table")).toBeNull();
});

it("retains a partially refreshed Student column and its time on a malformed current completion", async () => {
  const screen = await mountPage();
  await act(async () => button("Retry Average Progress").click());
  await screen.finish({
    index: 0,
    payload: {
      asOf: screen.data.asOf,
      course: { id: 7 },
      page: 1,
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
      rows: [
        { id: 3, result: { state: "value", value: 75 } },
        { id: 4, result: { state: "error", reason: "read_failed" } },
      ],
    },
  });
  expect(container.textContent).toContain(
    "Average Progress column refreshed at"
  );
  expect(container.querySelector("table")?.textContent).toContain("75%");
  await act(async () => button("Retry Average Progress").click());
  await screen.finish({
    index: 1,
    payload: {
      course: { id: 7 },
      page: 1,
      pageSize: 20,
      totalCount: 21,
      totalPages: 2,
      rows: [
        { id: 3, result: { state: "value", value: "bad" } },
        { id: 4, result: { state: "value", value: 99 } },
      ],
    },
  });
  expect(container.querySelector("table")?.textContent).toContain("75%");
  expect(container.querySelector("table")?.textContent).not.toContain("99%");
  expect(button("Retry Average Progress").disabled).toBe(false);
  expect(status()).toContain("Unable to refresh student metrics");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
