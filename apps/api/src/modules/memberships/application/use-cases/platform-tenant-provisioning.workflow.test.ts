import assert from "node:assert/strict";
import test from "node:test";

import type { MembershipDataSession } from "../ports/membership-data-session.js";
import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import type { TenantProvisioningIdempotencyPort } from "../ports/tenant-provisioning-idempotency.port.js";
import { PlatformTenantProvisioningWorkflow } from "./platform-tenant-provisioning.workflow.js";

const NOW = new Date("2026-08-07T13:45:00.000Z");

const INPUT: ProvisionPlatformTenantInput = Object.freeze({
  actorUserId: "10000000-0000-4000-8000-000000000001",
  idempotencyKey: "create-tenant-acme-20260807",
  requestHash: "a".repeat(64),
  slug: "acme",
  tenantName: "Acme Ltd",
  ownerEmail: "Owner@Example.COM",
  normalizedOwnerEmail: "owner@example.com",
  tenantHostname: "acme.booking.test",
  requestId: "request-1",
  now: NOW,
});

const COMMITTED_RESULT: ProvisionPlatformTenantResult = Object.freeze({
  tenantId: "30000000-0000-4000-8000-000000000001",
  slug: "acme",
  status: "provisioning",
  ownerMembershipId: "40000000-0000-4000-8000-000000000001",
  ownerInvitationId: "50000000-0000-4000-8000-000000000001",
  replayed: true,
});

test("replays a completed provisioning request without entering tenant scope", async () => {
  let runTenantCalls = 0;
  let completeCalls = 0;
  const idempotency: TenantProvisioningIdempotencyPort = {
    async claim(input) {
      assert.deepEqual(input, {
        key: INPUT.idempotencyKey,
        requestHash: INPUT.requestHash,
        actorUserId: INPUT.actorUserId,
        now: NOW,
      });
      return { status: "completed", result: COMMITTED_RESULT };
    },
    async complete() {
      completeCalls += 1;
    },
  };
  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency,
        async runTenant<T>(
          _tenantId: string,
          _tenantWork: (session: MembershipDataSession) => Promise<T>,
        ): Promise<T> {
          runTenantCalls += 1;
          throw new Error("tenant scope must not be entered for an idempotent replay");
        },
      });
    },
  };
  const workflow = new PlatformTenantProvisioningWorkflow(transaction);

  const result = await workflow.provision(INPUT);

  assert.deepEqual(result, COMMITTED_RESULT);
  assert.equal(runTenantCalls, 0);
  assert.equal(completeCalls, 0);
});
