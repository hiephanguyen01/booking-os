import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusCard } from "../src/index.js";

describe("StatusCard", () => {
  it("renders a labelled healthy service status", () => {
    const html = renderToStaticMarkup(
      <StatusCard
        title="API status"
        state="healthy"
        description="API 0.1.0 is available"
        eyebrow="Storefront"
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="healthy"');
    expect(html).toContain("Storefront");
    expect(html).toContain("API status");
    expect(html).toContain("API 0.1.0 is available");
  });

  it("omits the optional eyebrow and supports degraded state", () => {
    const html = renderToStaticMarkup(
      <StatusCard
        title="API status"
        state="degraded"
        description="API is unavailable"
      />,
    );

    expect(html).toContain('data-state="degraded"');
    expect(html).not.toContain("statusCard__eyebrow");
  });
});
