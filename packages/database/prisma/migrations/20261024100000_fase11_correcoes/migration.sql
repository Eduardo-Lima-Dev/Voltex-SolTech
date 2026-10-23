-- CreateEnum
CREATE TYPE "signature_request_status" AS ENUM ('SENT', 'COMPLETED', 'DECLINED', 'ERROR');

-- CreateEnum
CREATE TYPE "portal_upload_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "monthly_bill_cents" INTEGER,
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "score_breakdown" JSONB,
ADD COLUMN     "scored_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "monitoring_snapshots" RENAME COLUMN "kwh_power" TO "power_kw";

-- AlterTable
ALTER TABLE "portal_accesses" ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "portal_magic_links" ADD COLUMN     "access_id" UUID;

-- AlterTable
ALTER TABLE "portal_sessions" ADD COLUMN     "access_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_recovery_codes" JSONB;

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" "signature_request_status" NOT NULL DEFAULT 'SENT',
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT NOT NULL,
    "webhook_secret_hash" TEXT NOT NULL,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_uploads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "access_id" UUID,
    "document_id" UUID NOT NULL,
    "note" TEXT,
    "status" "portal_upload_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signature_requests_tenant_id_contract_id_idx" ON "signature_requests"("tenant_id", "contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "signature_requests_provider_external_id_key" ON "signature_requests"("provider", "external_id");

-- CreateIndex
CREATE INDEX "portal_uploads_tenant_id_project_id_status_idx" ON "portal_uploads"("tenant_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_alarms_plant_id_code_opened_at_key" ON "monitoring_alarms"("plant_id", "code", "opened_at");

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_magic_links" ADD CONSTRAINT "portal_magic_links_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "portal_accesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_access_id_fkey" FOREIGN KEY ("access_id") REFERENCES "portal_accesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_uploads" ADD CONSTRAINT "portal_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

