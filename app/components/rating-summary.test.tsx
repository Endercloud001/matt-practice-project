import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RatingSummary } from "./rating-summary";

describe("RatingSummary", () => {
  it("renders nothing for a zero-count course", () => {
    expect(
      renderToStaticMarkup(<RatingSummary average={null} count={0} />)
    ).toBe("");
  });

  it("rounds the displayed average to one decimal for text and stars", () => {
    const html = renderToStaticMarkup(
      <RatingSummary average={3.75} count={2} />
    );

    expect(html).toContain("3.8 out of 5 stars");
    expect(html).toContain(">3.8<");
    expect(html).toContain("(2 ratings)");
  });

  it("rounds decimal half ties up despite binary floating-point representation", () => {
    const html = renderToStaticMarkup(
      <RatingSummary average={4.05} count={10} />
    );

    expect(html).toContain("4.1 out of 5 stars");
    expect(html).toContain(">4.1<");
  });
});
