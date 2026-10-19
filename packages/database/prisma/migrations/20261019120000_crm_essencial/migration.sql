-- CreateEnum
CREATE TYPE "lead_source" AS ENUM ('FORM', 'LANDING_PAGE', 'WHATSAPP', 'API', 'REFERRAL', 'CSV_IMPORT', 'MARKETPLACE', 'CAMPAIGN', 'MANUAL', 'PARTNER_PORTAL');

-- CreateEnum
CREATE TYPE "customer_segment" AS ENUM ('RESIDENTIAL', 'RURAL', 'COMMERCIAL', 'INDUSTRIAL');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "phase_system" AS ENUM ('SINGLE_PHASE', 'TWO_PHASE', 'THREE_PHASE');

-- CreateEnum
CREATE TYPE "project_type" AS ENUM ('ON_GRID', 'HYBRID', 'OFF_GRID');

-- CreateEnum
CREATE TYPE "opportunity_stage" AS ENUM ('NEW_LEAD', 'FIRST_CONTACT', 'QUALIFICATION', 'BILL_PENDING', 'PRE_SIZING', 'TECHNICAL_VISIT_REQUIRED', 'ENGINEERING_REQUIRED', 'QUOTING', 'PROPOSAL_READY', 'PROPOSAL_SENT', 'NEGOTIATION', 'CREDIT_FINANCING', 'CONTRACT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "opportunity_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "energy_bill_status" AS ENUM ('UPLOADED', 'PARSED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "engineering_request_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "distributors" ADD COLUMN     "cnpj" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "lead_capture_key" TEXT;

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "document" TEXT,
    "email_normalized" TEXT,
    "phone_normalized" TEXT,
    "document_normalized" TEXT,
    "source" "lead_source" NOT NULL DEFAULT 'MANUAL',
    "segment" "customer_segment",
    "preliminary_group" "customer_group",
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "utm" JSONB,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "owner_id" UUID,
    "first_contact_due_at" TIMESTAMP(3),
    "first_contact_at" TIMESTAMP(3),
    "sla_alerted_at" TIMESTAMP(3),
    "disqualified_reason" TEXT,
    "converted_account_id" UUID,
    "converted_opportunity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "account_type" NOT NULL DEFAULT 'PERSON',
    "name" TEXT NOT NULL,
    "document" TEXT,
    "document_normalized" TEXT,
    "segment" "customer_segment",
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role_title" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "street" TEXT,
    "number" TEXT,
    "district" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "intake" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "number" TEXT NOT NULL,
    "distributor_id" UUID,
    "customer_group" "customer_group" NOT NULL DEFAULT 'B',
    "phase_system" "phase_system",
    "consumer_class" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "consumer_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" "opportunity_stage" NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "terminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "opportunity_stage" NOT NULL DEFAULT 'NEW_LEAD',
    "status" "opportunity_status" NOT NULL DEFAULT 'OPEN',
    "project_type" "project_type" NOT NULL DEFAULT 'ON_GRID',
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "consumer_unit_id" UUID,
    "lead_id" UUID,
    "owner_id" UUID,
    "lost_reason" TEXT,
    "expected_close_date" TIMESTAMP(3),
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "task_status" NOT NULL DEFAULT 'OPEN',
    "assignee_id" UUID,
    "opportunity_id" UUID,
    "lead_id" UUID,
    "account_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "origin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "consumer_unit_id" UUID,
    "document_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "energy_bill_status" NOT NULL DEFAULT 'UPLOADED',
    "extracted" JSONB NOT NULL DEFAULT '{}',
    "overall_confidence" DOUBLE PRECISION,
    "parser_name" TEXT,
    "parser_version" TEXT,
    "rejected_reason" TEXT,
    "validated_by_id" UUID,
    "validated_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "energy_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "energy_bill_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "fields" JSONB NOT NULL,
    "note" TEXT,
    "validated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "energy_bill_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "calculation_session_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "engineering_request_status" NOT NULL DEFAULT 'PENDING',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_created_at_idx" ON "leads"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_tenant_id_phone_normalized_idx" ON "leads"("tenant_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "leads_tenant_id_email_normalized_idx" ON "leads"("tenant_id", "email_normalized");

-- CreateIndex
CREATE INDEX "leads_tenant_id_document_normalized_idx" ON "leads"("tenant_id", "document_normalized");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_name_idx" ON "accounts"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_document_normalized_idx" ON "accounts"("tenant_id", "document_normalized");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_account_id_idx" ON "contacts"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "sites_tenant_id_account_id_idx" ON "sites"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "consumer_units_tenant_id_account_id_idx" ON "consumer_units"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "consumer_units_tenant_id_number_idx" ON "consumer_units"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "pipeline_stages_tenant_id_order_idx" ON "pipeline_stages"("tenant_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenant_id_key_key" ON "pipeline_stages"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_project_code_key" ON "opportunities"("project_code");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_stage_idx" ON "opportunities"("tenant_id", "stage");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_status_idx" ON "opportunities"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_owner_id_idx" ON "opportunities"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_account_id_idx" ON "opportunities"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "timeline_events_tenant_id_opportunity_id_created_at_idx" ON "timeline_events"("tenant_id", "opportunity_id", "created_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_due_at_idx" ON "tasks"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_assignee_id_status_idx" ON "tasks"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_opportunity_id_idx" ON "tasks"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "energy_bills_tenant_id_opportunity_id_idx" ON "energy_bills"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "energy_bills_tenant_id_status_idx" ON "energy_bills"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "energy_bill_snapshots_tenant_id_bill_id_created_at_idx" ON "energy_bill_snapshots"("tenant_id", "bill_id", "created_at");

-- CreateIndex
CREATE INDEX "engineering_requests_tenant_id_status_idx" ON "engineering_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "engineering_requests_tenant_id_opportunity_id_idx" ON "engineering_requests"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_lead_capture_key_key" ON "tenants"("lead_capture_key");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_units" ADD CONSTRAINT "consumer_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_units" ADD CONSTRAINT "consumer_units_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_units" ADD CONSTRAINT "consumer_units_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_units" ADD CONSTRAINT "consumer_units_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_bills" ADD CONSTRAINT "energy_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_bills" ADD CONSTRAINT "energy_bills_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_bill_snapshots" ADD CONSTRAINT "energy_bill_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "energy_bill_snapshots" ADD CONSTRAINT "energy_bill_snapshots_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "energy_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_requests" ADD CONSTRAINT "engineering_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_requests" ADD CONSTRAINT "engineering_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------
-- Regras de integridade que o Prisma não expressa
-- ---------------------------------------------------------------------------------------------------------

-- Oportunidade perdida precisa do motivo (RF-CRM-023), também no banco.
ALTER TABLE "opportunities"
  ADD CONSTRAINT "opportunities_lost_requires_reason"
  CHECK ("status" <> 'LOST' OR ("lost_reason" IS NOT NULL AND length(trim("lost_reason")) > 0));

-- O que a pessoa confirmou na fatura e a linha do tempo são registros imutáveis: só se acrescenta.
CREATE TRIGGER energy_bill_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "energy_bill_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

CREATE TRIGGER timeline_events_immutable
  BEFORE UPDATE OR DELETE ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
