// @vitest-environment jsdom
import { act, StrictMode, useState } from "react";
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useFetchers,
  useLocation,
  useNavigation,
} from "react-router";
import { createTestDb, seedBaseData } from "~/test/setup";
import { prepareReactDom } from "~/test/dom";

let testDb: ReturnType<typeof createTestDb>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
import {
  useAnalyticsRetry,
  type RetryEvent,
  type MetricRetryOptions,
} from "~/lib/use-analytics-retry";
import type { StudentSnapshots } from "~/services/analyticsService";

it("rejects invalid business targets and recovery data at the TypeScript interface", () => {
  expectTypeOf<{
    kind: "page";
    scope: { kind: "course" };
    metric: "purchaseTotal";
    label: string;
  }>().not.toMatchTypeOf<MetricRetryOptions["target"]>();
  expectTypeOf<{
    kind: "page";
    scope: { kind: "overview" };
    metric: "quizCount";
    label: string;
  }>().not.toMatchTypeOf<MetricRetryOptions["target"]>();
  expectTypeOf<{
    kind: "summary";
    course: { id: number; title: string };
    metric: "quizCount";
    label: string;
  }>().not.toMatchTypeOf<MetricRetryOptions["target"]>();
  type StudentRetry = ReturnType<typeof useAnalyticsRetry>;
  expectTypeOf<{ metric: "purchaseTotal" }>().not.toMatchTypeOf<
    Parameters<StudentRetry["retry"]>[0]
  >();
  expectTypeOf<
    Extract<StudentRetry["view"], { state: "reload-required" }>
  >().not.toHaveProperty("value");
});

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  prepareReactDom();
  testDb = createTestDb();
  seedBaseData(testDb);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

it("refreshes Student columns independently and preserves current identities and both observation times", async () => {
  const events: RetryEvent[] = [];
  const requests: Request[] = [];
  let resolveResponse: ((value: unknown) => void) | undefined;
  const snapshots: StudentSnapshots = {
    course: { id: 7, title: "TypeScript" },
    page: 2,
    pageSize: 20,
    totalCount: 21,
    totalPages: 2,
    rows: [
      {
        id: 3,
        name: "Student Name",
        email: "student@example.com",
        enrolledAt: "2026-09-01",
        studentProgress: { state: "error", reason: "read_failed" },
        quizAverage: { state: "error", reason: "read_failed" },
      },
    ],
  };
  let changeSnapshots: ((value: StudentSnapshots) => void) | undefined;
  function Screen() {
    const location = useLocation();
    const [currentSnapshots, setSnapshots] = useState(snapshots);
    changeSnapshots = setSnapshots;
    const retry = useAnalyticsRetry({
      target: { kind: "student-columns" },
      initial: {
        snapshots: currentSnapshots,
        asOf: "2026-09-30T00:00:00.000Z",
      },
      context: {
        generation: location.key,
        navigationPending: false,
        retryPending: false,
        report: (event) => events.push(event),
      },
    });
    return (
      <>
        <pre>{JSON.stringify(retry.view)}</pre>
        <button onClick={() => retry.retry({ metric: "studentProgress" })}>
          Progress
        </button>
        <button onClick={() => retry.retry({ metric: "quizAverage" })}>
          Quiz
        </button>
      </>
    );
  }
  router = createMemoryRouter(
    [
      { path: "/", element: <Screen /> },
      {
        path: "/api/analytics/students/retry",
        loader: ({ request }) => {
          requests.push(request);
          return new Promise<unknown>((resolve) => {
            resolveResponse = resolve;
          });
        },
      },
    ],
    { initialEntries: ["/?range=all&coursePage=3"] }
  );
  await act(async () => root.render(<RouterProvider router={router} />));
  for (const [index, metric, value, asOf] of [
    [0, "studentProgress", 75, "2026-09-30T01:00:00.000Z"],
    [1, "quizAverage", 0.8, "2026-09-30T02:00:00.000Z"],
  ] as const) {
    await act(async () => container.querySelectorAll("button")[index].click());
    const params = new URL(requests.at(-1)!.url).searchParams;
    expect(params.get("coursePage")).toBe("3");
    expect(params.get("studentPage")).toBe("2");
    expect(params.get("courseId")).toBe("7");
    expect([...params.values()].join(" ")).not.toContain("student@example.com");
    await act(async () =>
      resolveResponse?.({
        ok: true,
        metric,
        requestId: params.get("requestId"),
        scopeKey: params.get("scopeKey"),
        asOf,
        course: snapshots.course,
        page: 2,
        pageSize: 20,
        totalCount: 21,
        totalPages: 2,
        rows: [{ id: 3, result: { state: "value", value } }],
      })
    );
  }
  expect(container.textContent).toContain(
    '"studentProgress":{"state":"value","value":75}'
  );
  expect(container.textContent).toContain(
    '"quizAverage":{"state":"value","value":0.8}'
  );
  expect(container.textContent).toContain("Student Name");
  expect(container.textContent).toContain("2026-09-30T01:00:00.000Z");
  expect(container.textContent).toContain("2026-09-30T02:00:00.000Z");
  expect(
    events.filter(
      (event) => event.kind === "notice" && event.message.includes("refreshed")
    )
  ).toHaveLength(2);
  await act(async () =>
    changeSnapshots?.({
      ...snapshots,
      course: { ...snapshots.course, title: "Renamed course" },
      rows: snapshots.rows.map((row) => ({
        ...row,
        name: "Renamed student",
        email: "new@example.com",
      })),
    })
  );
  expect(container.textContent).toContain('"value":75');
  expect(container.textContent).toContain('"value":0.8');
  expect(container.textContent).toContain("Renamed student");
  expect(container.textContent).toContain("new@example.com");
  expect(container.textContent).not.toContain("student@example.com");
  expect(
    events.filter((event) => event.message.includes("refreshed"))
  ).toHaveLength(2);
  await act(async () =>
    changeSnapshots?.({
      ...snapshots,
      rows: snapshots.rows.map((row) => ({ ...row, id: 99 })),
    })
  );
  expect(container.textContent).not.toContain('"value":75');
  expect(container.textContent).toContain('"refreshed":false');
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
});

async function mountMetric(
  initialEntries = ["/?range=all&coursePage=3&studentPage=2"]
) {
  const events: RetryEvent[] = [];
  const requests: Request[] = [];
  const completions: ((value: unknown) => void)[] = [];
  let change: ((value: Partial<MetricRetryOptions>) => void) | undefined;
  function Screen() {
    const location = useLocation();
    const [overrides, setOverrides] = useState<Partial<MetricRetryOptions>>({});
    change = (value) => setOverrides((previous) => ({ ...previous, ...value }));
    const retry = useAnalyticsRetry({
      target: {
        kind: "page",
        scope: { kind: "overview" },
        metric: "purchaseTotal",
        label: "Purchase Total",
      },
      initial: {
        metric: { state: "error", reason: "read_failed" },
        asOf: "2026-09-30T00:00:00Z",
      },
      context: {
        generation: location.key,
        navigationPending: false,
        retryPending: false,
        report: (event) => events.push(event),
      },
      ...overrides,
    });
    return (
      <>
        <pre>{JSON.stringify(retry.view)}</pre>
        <button
          disabled={retry.disabled}
          onClick={() => {
            retry.retry();
            retry.retry();
          }}
        >
          Retry twice
        </button>
      </>
    );
  }
  router = createMemoryRouter(
    [
      { path: "/", element: <Screen /> },
      { path: "/other", element: <p>Other page</p> },
      {
        path: "/api/analytics/retry",
        loader: ({ request }) => {
          requests.push(request);
          return new Promise<unknown>((resolve) => completions.push(resolve));
        },
      },
    ],
    { initialEntries }
  );
  await act(async () =>
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>
    )
  );
  const start = async () =>
    act(async () => container.querySelector("button")?.click());
  const finish = async (
    payload: Record<string, unknown>,
    index = requests.length - 1
  ) => {
    const params = new URL(requests[index].url).searchParams;
    await act(async () =>
      completions[index]({
        requestId: params.get("requestId"),
        scopeKey: new URLSearchParams(
          [...params].filter(([key]) => key !== "metric" && key !== "requestId")
        ).toString(),
        ...payload,
      })
    );
  };
  return {
    events,
    requests,
    start,
    finish,
    change: async (value: Partial<MetricRetryOptions>) =>
      act(async () => change?.(value)),
  };
}

it("guards synchronous reentry, accepts genuine zero once in StrictMode and preserves it across equivalent inputs", async () => {
  const screen = await mountMetric();
  await screen.start();
  expect(screen.requests).toHaveLength(1);
  expect(container.querySelector("button")?.disabled).toBe(true);
  await screen.finish({
    ok: true,
    metric: "purchaseTotal",
    result: { state: "value", value: 0 },
    asOf: "2026-09-30T01:00:00Z",
  });
  await screen.change({
    target: {
      kind: "page",
      scope: { kind: "overview" },
      metric: "purchaseTotal",
      label: "New label",
    },
  });
  expect(container.textContent).toContain('"value":0');
  expect(container.textContent).toContain("2026-09-30T01:00:00Z");
  expect(
    screen.events.filter((event) => event.message.includes("refreshed"))
  ).toHaveLength(1);
});

it.each([
  { metric: "enrollmentCount" },
  { result: { state: "value", value: "oops" } },
  { result: { state: "error", reason: "unknown" } },
  { asOf: "invalid time" },
  { requestId: undefined, scopeKey: undefined, ok: false, error: "forbidden" },
])(
  "preserves prior values on invalid current payload %j without authorization recovery",
  async (malformed) => {
    const screen = await mountMetric();
    await screen.start();
    await screen.finish({
      ok: true,
      metric: "purchaseTotal",
      result: { state: "value", value: 4 },
      asOf: "2026-09-30T01:00:00Z",
      ...malformed,
    });
    expect(container.textContent).toContain('"reason":"read_failed"');
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(
      screen.events.filter((event) => event.message.includes("Unable"))
    ).toHaveLength(1);
    expect(
      screen.events.filter((event) => event.kind === "recovery")
    ).toHaveLength(0);
  }
);

it.each(["forbidden", "not_found"])(
  "recovers for correlated %s without a success metric field",
  async (error) => {
    const screen = await mountMetric();
    await screen.start();
    await screen.finish({ ok: false, error });
    expect(container.textContent).toContain('"state":"reload-required"');
    expect(container.textContent).not.toContain('"metric"');
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(
      screen.events.filter((event) => event.kind === "recovery")
    ).toHaveLength(1);
  }
);

it.each([{ requestId: "old" }, { scopeKey: "different" }])(
  "ignores explicitly uncorrelated completed responses %j",
  async (mismatch) => {
    const screen = await mountMetric();
    await screen.start();
    await screen.finish({ ok: false, error: "forbidden", ...mismatch });
    expect(container.textContent).toContain('"state":"ready"');
    expect(screen.events).toHaveLength(1);
  }
);

it.each([
  { state: "empty", reason: "no_records" },
  { state: "unavailable", reason: "missing_source_data" },
  { state: "error", reason: "read_failed" },
])("preserves metric semantics for accepted %j", async (result) => {
  const screen = await mountMetric();
  await screen.start();
  await screen.finish({
    ok: true,
    metric: "purchaseTotal",
    result,
    asOf: "2026-09-30T01:00:00Z",
  });
  expect(container.textContent).toContain(JSON.stringify(result));
  expect(container.textContent).toContain("2026-09-30T01:00:00Z");
  expect(
    screen.events.filter((event) => event.kind === "recovery")
  ).toHaveLength(0);
});

it("replaces overrides immediately for new initial asOf and rejects an old target completion", async () => {
  const screen = await mountMetric();
  await screen.start();
  await screen.finish({
    ok: true,
    metric: "purchaseTotal",
    result: { state: "value", value: 42 },
    asOf: "2026-09-30T01:00:00Z",
  });
  await screen.start();
  await screen.change({
    initial: {
      metric: { state: "value", value: 9 },
      asOf: "2026-09-30T02:00:00Z",
    },
    target: {
      kind: "page",
      scope: { kind: "course", courseId: 7 },
      metric: "enrollmentCount",
      label: "Enrollments",
    },
  });
  expect(container.textContent).toContain('"value":9');
  expect(container.textContent).not.toContain('"value":42');
  await screen.finish({ ok: false, error: "forbidden" });
  expect(
    screen.events.filter((event) => event.kind === "recovery")
  ).toHaveLength(0);
  expect(container.textContent).toContain('"value":9');
});

it("rejects a late completion after leaving and returning to the same URL", async () => {
  const screen = await mountMetric();
  await screen.start();
  await act(async () => router.navigate("/other"));
  await act(async () =>
    router.navigate("/?range=all&coursePage=3&studentPage=2")
  );
  await screen.finish({ ok: false, error: "forbidden" });
  expect(
    screen.events.filter((event) => event.kind === "recovery")
  ).toHaveLength(0);
  expect(container.textContent).toContain('"state":"ready"');
});

it.each([
  {
    kind: "page",
    scope: { kind: "overview" },
    metric: "enrollmentCount",
    label: "Enrollments",
  },
  {
    kind: "page",
    scope: { kind: "course", courseId: 7 },
    metric: "purchaseTotal",
    label: "Purchase",
  },
  {
    kind: "summary",
    course: { id: 8, title: "Other" },
    metric: "purchaseTotal",
    label: "Purchase",
  },
] satisfies MetricRetryOptions["target"][])(
  "invalidates old values and pending responses on a same-generation target change %j",
  async (target) => {
    const screen = await mountMetric();
    await screen.start();
    await screen.finish({
      ok: true,
      metric: "purchaseTotal",
      result: { state: "value", value: 42 },
      asOf: "2026-09-30T01:00:00Z",
    });
    await screen.start();
    await screen.change({ target });
    expect(container.textContent).not.toContain('"value":42');
    await screen.finish({ ok: false, error: "forbidden" });
    expect(
      screen.events.filter((event) => event.kind === "recovery")
    ).toHaveLength(0);
    expect(container.textContent).toContain('"state":"ready"');
  }
);

it.each([
  {
    kind: "page",
    scope: { kind: "overview" },
    metric: "purchaseTotal",
    label: "Purchase",
  },
  {
    kind: "page",
    scope: { kind: "course", courseId: 7 },
    metric: "purchaseTotal",
    label: "Purchase",
  },
  {
    kind: "summary",
    course: { id: 8, title: "Other" },
    metric: "purchaseTotal",
    label: "Purchase",
  },
] satisfies MetricRetryOptions["target"][])(
  "constructs the business scope for $kind",
  async (target) => {
    const screen = await mountMetric([
      "/?range=custom&start=2026-09-01&end=2026-10-01&instructorId=2&courseId=999&coursePage=3&studentPage=2",
    ]);
    await screen.change({ target });
    await screen.start();
    const params = new URL(screen.requests[0].url).searchParams;
    expect(params.get("courseId")).toBe(
      target.kind === "summary"
        ? "8"
        : target.scope.kind === "course"
          ? "7"
          : "999"
    );
    expect(params.get("instructorId")).toBe("2");
    expect(params.get("start")).toBe("2026-09-01");
    expect(params.get("coursePage")).toBe(
      target.kind === "summary" ? null : "3"
    );
    expect(params.get("studentPage")).toBe(
      target.kind === "summary" ? null : "2"
    );
  }
);

it("preserves the metric and reports a missing-correlation current completion exactly once", async () => {
  let resolveResponse: ((value: unknown) => void) | undefined;
  const events: RetryEvent[] = [];
  const requests: Request[] = [];
  function Screen() {
    const location = useLocation();
    const navigation = useNavigation();
    const fetchers = useFetchers();
    const retry = useAnalyticsRetry({
      target: {
        kind: "page",
        scope: { kind: "overview" },
        metric: "purchaseTotal",
        label: "Purchase Total",
      },
      initial: {
        metric: { state: "error", reason: "read_failed" },
        asOf: "2026-09-30T00:00:00.000Z",
      },
      context: {
        generation: location.key,
        navigationPending: navigation.state !== "idle",
        retryPending: fetchers.some((f) => f.state !== "idle"),
        report: (event) => events.push(event),
      },
    });
    return (
      <>
        <pre>{JSON.stringify(retry.view)}</pre>
        <button disabled={retry.disabled} onClick={retry.retry}>
          Retry
        </button>
      </>
    );
  }
  router = createMemoryRouter([
    { path: "/", element: <Screen /> },
    {
      path: "/api/analytics/retry",
      loader: ({ request }) => {
        requests.push(request);
        return new Promise<unknown>((resolve) => {
          resolveResponse = resolve;
        });
      },
    },
  ]);
  await act(async () => root.render(<RouterProvider router={router} />));
  expect(events).toEqual([]);
  await act(async () => container.querySelector("button")?.click());
  expect(requests).toHaveLength(1);
  expect(events.filter((e) => e.kind === "recovery")).toEqual([]);
  await act(async () =>
    resolveResponse?.({ ok: false, error: "invalid_query" })
  );
  expect(container.querySelector("pre")?.textContent).toContain(
    '"state":"error"'
  );
  expect(
    events.filter((e) => e.kind === "notice" && e.message.includes("Unable"))
  ).toHaveLength(1);
  expect(events.filter((e) => e.kind === "recovery")).toEqual([]);
  expect(container.querySelector("button")?.disabled).toBe(false);
});
