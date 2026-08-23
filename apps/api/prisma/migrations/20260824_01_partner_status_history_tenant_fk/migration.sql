ALTER TABLE "partner_status_history"
ADD CONSTRAINT "partner_status_history_tenant_id_fkey"
FOREIGN KEY ("tenant_id")
REFERENCES "tenants"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
