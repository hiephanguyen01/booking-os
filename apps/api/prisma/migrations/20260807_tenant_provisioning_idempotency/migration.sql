CREATE TYPE "tenant_provisioning_request_status" AS ENUM ('in_progress', 'completed');

CREATE TABLE "tenant_provisioning_requests" (
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "status" "tenant_provisioning_request_status" NOT NULL DEFAULT 'in_progress',
  "tenant_id" UUID,
  "tenant_slug" TEXT,
  "owner_membership_id" UUID,
  "owner_invitation_id" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tenant_provisioning_requests_pkey" PRIMARY KEY ("idempotency_key")
);

REVOKE ALL ON TABLE "tenant_provisioning_requests" FROM PUBLIC;
REVOKE ALL ON TABLE "tenant_provisioning_requests" FROM booking_app;
GRANT SELECT, INSERT, UPDATE
  ON TABLE "tenant_provisioning_requests"
  TO booking_platform_app;
