import { expect, it } from "vitest";

import { cn } from "../src/lib/cn.js";

it("resolves conditional and conflicting classes", () => {
  expect(cn("px-2", false && "hidden", ["py-1", "px-4"])).toBe("py-1 px-4");
});
