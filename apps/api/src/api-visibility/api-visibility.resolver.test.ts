import assert from "node:assert/strict";
import test from "node:test";

import { InternalApi, SupportedApi } from "./api-visibility.decorator.js";
import { resolveApiVisibility } from "./api-visibility.resolver.js";

@InternalApi()
class InternalController {
  inherited(): void {}

  @SupportedApi()
  supportedOverride(): void {}
}

test("method visibility overrides controller visibility", () => {
  assert.equal(
    resolveApiVisibility(InternalController, InternalController.prototype.supportedOverride),
    "public-supported",
  );
  assert.equal(
    resolveApiVisibility(InternalController, InternalController.prototype.inherited),
    "internal",
  );
});

test("rejects missing visibility", () => {
  class MissingController {
    route(): void {}
  }

  assert.throws(
    () => resolveApiVisibility(MissingController, MissingController.prototype.route),
    /exactly one API visibility; no marker was found/,
  );
});

test("rejects conflicting visibility at the selected level", () => {
  @SupportedApi()
  @InternalApi()
  class ConflictingController {
    route(): void {}
  }

  assert.throws(
    () => resolveApiVisibility(ConflictingController, ConflictingController.prototype.route),
    /exactly one API visibility; both markers were found/,
  );
});
