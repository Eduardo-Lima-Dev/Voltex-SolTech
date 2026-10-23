-- CreateEnum
CREATE TYPE "commissioning_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "commissioning_result" AS ENUM ('PENDING', 'PENDING_RULE', 'PENDING_DATA', 'PASS', 'FAIL', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "installations" ADD COLUMN     "acceptance_ip" TEXT,
ADD COLUMN     "acceptance_note" TEXT,
ADD COLUMN     "acceptance_signature_document_id" UUID,
ADD COLUMN     "acceptance_user_agent" TEXT,
ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "accepted_by_name" TEXT,
ADD COLUMN     "accepted_channel" TEXT;

-- CreateTable
CREATE TABLE "commissioning_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "commissioning_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "level" TEXT NOT NULL DEFAULT 'STANDARD',
    "rule_ref" TEXT NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "rule_note" TEXT,
    "rule_sources" JSONB NOT NULL DEFAULT '[]',
    "rule_reviewed_by" TEXT,
    "internal_test_rule" BOOLEAN NOT NULL DEFAULT false,
    "engineering_snapshot_id" UUID,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "notes" JSONB NOT NULL DEFAULT '[]',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "decision_note" TEXT,
    "report_document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissioning_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissioning_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "test_group" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "unit" TEXT,
    "expected_kind" TEXT NOT NULL,
    "tolerance_pct" DOUBLE PRECISION,
    "min_value" DOUBLE PRECISION,
    "max_value" DOUBLE PRECISION,
    "required" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "subject_label" TEXT NOT NULL,
    "electrical" JSONB,
    "result" "commissioning_result" NOT NULL DEFAULT 'PENDING',
    "measured_value" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "expected_value" DOUBLE PRECISION,
    "deviation_pct" DOUBLE PRECISION,
    "basis" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "conditions" JSONB,
    "measured_at" TIMESTAMP(3),
    "measured_by_id" UUID,
    "evidence_photo_ids" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissioning_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commissioning_records_tenant_id_status_idx" ON "commissioning_records"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_records_installation_id_attempt_key" ON "commissioning_records"("installation_id", "attempt");

-- CreateIndex
CREATE INDEX "commissioning_tests_tenant_id_record_id_position_idx" ON "commissioning_tests"("tenant_id", "record_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "commissioning_tests_record_id_code_subject_key_key" ON "commissioning_tests"("record_id", "code", "subject_key");

-- AddForeignKey
ALTER TABLE "commissioning_records" ADD CONSTRAINT "commissioning_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_records" ADD CONSTRAINT "commissioning_records_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_tests" ADD CONSTRAINT "commissioning_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissioning_tests" ADD CONSTRAINT "commissioning_tests_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "commissioning_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

