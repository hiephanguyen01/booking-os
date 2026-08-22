import assert from "node:assert/strict";
import test from "node:test";

import { PartnerInvalidStateError } from "./partner.errors.js";
import {
  assertCanApprove,
  assertCanCancel,
  assertCanReactivate,
  assertCanReject,
  assertCanReview,
  assertCanSubmit,
  assertCanSuspend,
  canCreateInventory,
  canEditApplication,
} from "./partner.js";

test("Partner application editing is limited to editable onboarding states", () => {
  assert.equal(canEditApplication({ applicationStatus: "draft" }), true);
  assert.equal(canEditApplication({ applicationStatus: "changes_requested" }), true);
  assert.equal(canEditApplication({ applicationStatus: "submitted" }), false);
  assert.equal(canEditApplication({ applicationStatus: "approved" }), false);
  assert.equal(canEditApplication({ applicationStatus: "rejected" }), false);
});

test("inventory eligibility requires an active Partner", () => {
  assert.equal(canCreateInventory({ operationalStatus: "inactive" }), false);
  assert.equal(canCreateInventory({ operationalStatus: "active" }), true);
  assert.equal(canCreateInventory({ operationalStatus: "suspended" }), false);
  assert.equal(canCreateInventory({ operationalStatus: "cancelled" }), false);
});

test("submit and tenant review guards enforce the application state machine", () => {
  assert.doesNotThrow(() =>
    assertCanSubmit({ applicationStatus: "draft", operationalStatus: "inactive" }),
  );
  assert.doesNotThrow(() =>
    assertCanSubmit({ applicationStatus: "changes_requested", operationalStatus: "inactive" }),
  );
  assert.throws(
    () => assertCanSubmit({ applicationStatus: "submitted", operationalStatus: "inactive" }),
    PartnerInvalidStateError,
  );

  const submitted = { applicationStatus: "submitted", operationalStatus: "inactive" } as const;
  assert.doesNotThrow(() => assertCanReview(submitted));
  assert.doesNotThrow(() => assertCanApprove(submitted));
  assert.doesNotThrow(() => assertCanReject(submitted));

  const draft = { applicationStatus: "draft", operationalStatus: "inactive" } as const;
  assert.throws(() => assertCanReview(draft), PartnerInvalidStateError);
  assert.throws(() => assertCanApprove(draft), PartnerInvalidStateError);
  assert.throws(() => assertCanReject(draft), PartnerInvalidStateError);
});

test("operational lifecycle guards require an approved Partner and exact source state", () => {
  assert.doesNotThrow(() =>
    assertCanSuspend({ applicationStatus: "approved", operationalStatus: "active" }),
  );
  assert.doesNotThrow(() =>
    assertCanReactivate({ applicationStatus: "approved", operationalStatus: "suspended" }),
  );
  assert.doesNotThrow(() =>
    assertCanCancel({ applicationStatus: "approved", operationalStatus: "active" }),
  );
  assert.doesNotThrow(() =>
    assertCanCancel({ applicationStatus: "approved", operationalStatus: "suspended" }),
  );

  assert.throws(
    () => assertCanSuspend({ applicationStatus: "approved", operationalStatus: "inactive" }),
    PartnerInvalidStateError,
  );
  assert.throws(
    () => assertCanReactivate({ applicationStatus: "rejected", operationalStatus: "suspended" }),
    PartnerInvalidStateError,
  );
  assert.throws(
    () => assertCanCancel({ applicationStatus: "approved", operationalStatus: "cancelled" }),
    PartnerInvalidStateError,
  );
});

test("invalid transition exposes a stable machine-readable error code", () => {
  assert.throws(
    () => assertCanApprove({ applicationStatus: "rejected", operationalStatus: "inactive" }),
    (error: unknown) =>
      error instanceof PartnerInvalidStateError && error.code === "PARTNER_INVALID_STATE",
  );
});
