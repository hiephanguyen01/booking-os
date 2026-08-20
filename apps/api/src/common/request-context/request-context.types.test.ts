import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext } from "@booking-os/contracts";

import {
  isAuthenticatedRequestContext,
  isAuthorizationReadyRequestContext,
} from "./request-context.types.js";

function partnerCandidate(overrides: Record<string, unknown> = {}): RequestContext {
  return {
    requestId: "request-1",
    traceId: "trace-1",
    source: "console",
    actorId: "user-1",
    sessionId: "session-1",
    authScope: {
      type: "partner",
      tenantId: "tenant-1",
      partnerId: "partner-1",
    },
    sessionState: "active",
    authorizationVersion: 1,
    membershipAuthorizationVersion: 1,
    ...overrides,
  } as RequestContext;
}

test("authenticated Partner scope requires both trusted tenant and Partner identifiers", () => {
  const valid = partnerCandidate();
  assert.equal(isAuthenticatedRequestContext(valid), true);

  const missingTenant = partnerCandidate({
    authScope: { type: "partner", tenantId: "", partnerId: "partner-1" },
  });
  assert.equal(isAuthenticatedRequestContext(missingTenant), false);

  const missingPartner = partnerCandidate({
    authScope: { type: "partner", tenantId: "tenant-1", partnerId: "" },
  });
  assert.equal(isAuthenticatedRequestContext(missingPartner), false);
});

test("Partner scope is authorization-ready only with active state and positive membership epoch", () => {
  const valid = partnerCandidate();
  if (!isAuthenticatedRequestContext(valid)) {
    assert.fail("Expected Partner candidate to be authenticated.");
  }
  assert.equal(isAuthorizationReadyRequestContext(valid), true);

  const missingMembershipEpoch = partnerCandidate({ membershipAuthorizationVersion: undefined });
  if (!isAuthenticatedRequestContext(missingMembershipEpoch)) {
    assert.fail("Expected missing-epoch candidate to remain authenticated.");
  }
  assert.equal(isAuthorizationReadyRequestContext(missingMembershipEpoch), false);

  const invitationPending = partnerCandidate({ sessionState: "invitation_pending" });
  if (!isAuthenticatedRequestContext(invitationPending)) {
    assert.fail("Expected invitation-pending candidate to remain authenticated.");
  }
  assert.equal(isAuthorizationReadyRequestContext(invitationPending), false);
});
