import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentSettings } from "./consent-banner";

describe("ConsentSettings (problem 7: glanceable sizes)", () => {
  it("enlarges settings checkboxes to >= 24px with >= 44px label row", () => {
    const html = renderToStaticMarkup(<ConsentSettings />);
    // Checkbox input has h-6 w-6 (24px)
    expect(html).toContain("h-6 w-6");
    // Label row has min-h-[44px]
    expect(html).toContain("min-h-[44px]");
  });
});
