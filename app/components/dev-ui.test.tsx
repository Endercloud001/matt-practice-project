// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DevUI } from "~/components/dev-ui";
import { UserRole } from "~/db/schema";
import { prepareReactDom } from "~/test/dom";

type DevUIProps = Parameters<typeof DevUI>[0];

const users: DevUIProps["users"] = [
  { id: 1, name: "Alice Admin", role: UserRole.Admin },
  { id: 2, name: "Bob Student", role: UserRole.Student },
];

const countries: DevUIProps["countries"] = [
  { code: "US", name: "United States" },
];

let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;

beforeEach(() => {
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

function findButtonByText(text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text)
  );
}

it("collapses the user switcher after a successful user change", async () => {
  let switchToBob: (() => void) | undefined;

  function Screen() {
    const [currentUser, setCurrentUser] = useState<DevUIProps["currentUser"]>(
      users[0]
    );
    switchToBob = () => setCurrentUser(users[1]);

    return (
      <DevUI
        users={users}
        currentUser={currentUser}
        devCountry={null}
        countryTierInfo={{ tier: 1, discount: 0, label: "Standard" }}
        countries={countries}
      />
    );
  }

  router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Screen />,
      },
    ],
    { initialEntries: ["/?panel=dev"] }
  );

  await act(async () => root.render(<RouterProvider router={router} />));

  await act(async () => findButtonByText("Switch user")?.click());
  expect(findButtonByText("Bob Student")).not.toBeUndefined();

  await act(async () => switchToBob?.());

  expect(container.textContent).toContain("Bob Student");
  expect(findButtonByText("Alice Admin")).toBeUndefined();
});
