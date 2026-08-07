import assert from "node:assert/strict";
import test from "node:test";

import {
  InvitationInvalidOrExpiredError,
  LastTenantOwnerError,
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
  TenantNotAvailableError,
  TenantProvisioningConflictError,
  TenantProvisioningIdempotencyConflictError,
  TenantProvisioningInProgressError,
} from "./membership-errors.js";

const cases = [
  [MembershipRequiredError, "MEMBERSHIP_REQUIRED"],
  [MembershipInactiveError, "MEMBERSHIP_INACTIVE"],
  [InvitationInvalidOrExpiredError, "INVITATION_INVALID_OR_EXPIRED"],
  [RoleGrantNotAllowedError, "ROLE_GRANT_NOT_ALLOWED"],
  [LastTenantOwnerError, "LAST_TENANT_OWNER"],
  [TenantNotAvailableError, "TENANT_NOT_AVAILABLE"],
  [TenantProvisioningConflictError, "TENANT_PROVISIONING_CONFLICT"],
  [TenantProvisioningIdempotencyConflictError, "TENANT_PROVISIONING_IDEMPOTENCY_CONFLICT"],
  [TenantProvisioningInProgressError, "TENANT_PROVISIONING_IN_PROGRESS"],
] as const;

for (const [ErrorType, code] of cases) {
  test(`${code} is a stable sanitized membership error`, () => {
    const error = new ErrorType();

    assert.equal(error.name, ErrorType.name);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.deepEqual(Object.keys(error), ["code", "name"]);
  });
}
