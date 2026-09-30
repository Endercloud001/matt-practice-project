// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
  useFetcher,
  redirect,
} from "react-router";
import { createTestDb, seedBaseData } from "~/test/setup";
import { prepareReactDom } from "~/test/dom";

let testDb: ReturnType<typeof createTestDb>;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
  testDb = createTestDb();
  seedBaseData(testDb);
  prepareReactDom();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router?.dispose();
  container.remove();
});

it("attributes a missing-correlation response to the completed Router load, not idle or retained data", async () => {
  let resolveResponse: ((value: unknown) => void) | undefined;
  const observations: { attempt: number; data: unknown }[] = [];
  function Probe() {
    const fetcher = useFetcher<unknown>();
    const attempt = useRef(0);
    const [completed, setCompleted] = useState(0);
    useEffect(() => {
      if (completed !== 0 && fetcher.state === "idle") {
        observations.push({ attempt: completed, data: fetcher.data });
      }
    }, [completed, fetcher.data, fetcher.state]);
    return (
      <button
        onClick={() => {
          const current = ++attempt.current;
          setCompleted(0);
          void fetcher.load("/retry").then(() => setCompleted(current));
        }}
      >
        Retry
      </button>
    );
  }
  router = createMemoryRouter([
    { path: "/", element: <Probe /> },
    {
      path: "/retry",
      loader: () =>
        new Promise<unknown>((resolve) => {
          resolveResponse = resolve;
        }),
    },
  ]);
  await act(async () => root.render(<RouterProvider router={router} />));
  expect(observations).toEqual([]);
  await act(async () => container.querySelector("button")?.click());
  await act(async () =>
    resolveResponse?.({ ok: true, requestId: "old", value: 12 })
  );
  expect(observations.at(-1)).toEqual({
    attempt: 1,
    data: { ok: true, requestId: "old", value: 12 },
  });
  observations.length = 0;
  await act(async () => container.querySelector("button")?.click());
  expect(observations).toEqual([]);
  await act(async () =>
    resolveResponse?.({ ok: false, error: "invalid_query" })
  );
  expect(observations).toEqual([
    { attempt: 2, data: { ok: false, error: "invalid_query" } },
  ]);
});

it("can settle a departed or redirected Router load without returning its payload to the current view", async () => {
  let resolveResponse: ((value: unknown) => void) | undefined;
  const completions: string[] = [];
  function Probe() {
    const fetcher = useFetcher<unknown>();
    return (
      <button
        onClick={() => {
          void fetcher.load("/retry").then(() => completions.push("settled"));
        }}
      >
        Retry
      </button>
    );
  }
  router = createMemoryRouter([
    { path: "/", element: <Probe /> },
    {
      path: "/retry",
      loader: () => {
        return new Promise<unknown>((resolve) => {
          resolveResponse = resolve;
        });
      },
    },
    { path: "/login", element: <p>Login</p> },
  ]);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => container.querySelector("button")?.click());
  await act(async () => router.navigate("/login"));
  await act(async () =>
    resolveResponse?.({ ok: false, error: "invalid_query" })
  );
  expect(container.textContent).toBe("Login");
  expect(completions).toEqual(["settled"]);
  await act(async () => router.navigate("/"));
  await act(async () => container.querySelector("button")?.click());
  await act(async () => resolveResponse?.(redirect("/login")));
  expect(container.textContent).toBe("Login");
});

it("rejects a genuinely aborted load's late completion and retained data before attributing the active load", async () => {
  const requests: Request[] = [];
  const completions: ((value: unknown) => void)[] = [];
  const observations: { attempt: number; data: unknown }[] = [];
  function Probe() {
    const fetcher = useFetcher<unknown>();
    const activeAttempt = useRef(0);
    const [completed, setCompleted] = useState<{
      attempt: number;
      previousData: unknown;
    } | null>(null);
    useEffect(() => {
      if (
        completed &&
        completed.attempt === activeAttempt.current &&
        fetcher.state === "idle" &&
        fetcher.data !== completed.previousData
      ) {
        observations.push({ attempt: completed.attempt, data: fetcher.data });
      }
    }, [completed, fetcher.data, fetcher.state]);
    return (
      <button
        onClick={() => {
          const attempt = ++activeAttempt.current;
          const previousData = fetcher.data;
          setCompleted(null);
          void fetcher.load("/retry").then(() => {
            if (activeAttempt.current === attempt)
              setCompleted({ attempt, previousData });
          });
        }}
      >
        Retry
      </button>
    );
  }
  router = createMemoryRouter([
    { path: "/", element: <Probe /> },
    {
      path: "/retry",
      loader: ({ request }) => {
        requests.push(request);
        // Deliberately allow an aborted loader to finish late.
        return new Promise<unknown>((resolve) => completions.push(resolve));
      },
    },
  ]);
  await act(async () => root.render(<RouterProvider router={router} />));
  await act(async () => container.querySelector("button")?.click());
  await act(async () =>
    completions[0]({ ok: true, requestId: "old", value: 12 })
  );
  expect(observations).toHaveLength(1);
  observations.length = 0;
  await act(async () => container.querySelector("button")?.click());
  expect(requests[1].signal.aborted).toBe(false);
  await act(async () => container.querySelector("button")?.click());
  expect(requests[1].signal.aborted).toBe(true);
  expect(requests[2].signal.aborted).toBe(false);
  await act(async () => completions[1]({ ok: false, error: "forbidden" }));
  expect(observations).toEqual([]);
  await act(async () => completions[2]({ ok: false, error: "invalid_query" }));
  expect(observations).toEqual([
    { attempt: 3, data: { ok: false, error: "invalid_query" } },
  ]);
});
