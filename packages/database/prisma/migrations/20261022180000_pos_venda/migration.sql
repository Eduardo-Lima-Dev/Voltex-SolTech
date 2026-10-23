-- CreateEnum
CREATE TYPE "plant_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "asset_status" AS ENUM ('ACTIVE', 'REPLACED', 'REMOVED');

-- CreateEnum
CREATE TYPE "warranty_kind" AS ENUM ('PRODUCT', 'PERFORMANCE');

-- CreateEnum
CREATE TYPE "ticket_type" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'REQUEST', 'PERFORMANCE_ALERT');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ticket_origin" AS ENUM ('USER', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "maintenance_kind" AS ENUM ('PREVENTIVE', 'CLEANING', 'INSPECTION');

-- CreateEnum
CREATE TYPE "om_contract_status" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "plants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "name" TEXT NOT NULL,
    "status" "plant_status" NOT NULL DEFAULT 'ACTIVE',
    "power_kwp" DOUBLE PRECISION,
    "expected_monthly_kwh" JSONB NOT NULL DEFAULT '[]',
    "expected_annual_kwh" DOUBLE PRECISION,
    "expected_source" TEXT,
    "engineering_snapshot_id" UUID,
    "activated_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "equipment_id" UUID,
    "category" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "serials" JSONB NOT NULL DEFAULT '[]',
    "installed_at" TIMESTAMP(3) NOT NULL,
    "status" "asset_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plant_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plant_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manufacturer_warranty_terms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "product_years" DOUBLE PRECISION,
    "performance_years" DOUBLE PRECISION,
    "performance_end_pct" DOUBLE PRECISION,
    "conditions" TEXT,
    "document_id" UUID,
    "source" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "valid_from" DATE NOT NULL,
    "superseded_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manufacturer_warranty_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_warranties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "term_id" UUID,
    "kind" "warranty_kind" NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "performance_end_pct" DOUBLE PRECISION,
    "origin" TEXT NOT NULL,
    "note" TEXT,
    "expiring_notified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_warranties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "ticket_type" NOT NULL,
    "priority" "ticket_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "origin" "ticket_origin" NOT NULL DEFAULT 'USER',
    "opened_by_id" UUID,
    "assignee_id" UUID,
    "asset_id" UUID,
    "work_order_id" UUID,
    "sla_due_at" TIMESTAMP(3),
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "automation_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "maintenance_kind" NOT NULL DEFAULT 'PREVENTIVE',
    "every_months" INTEGER NOT NULL,
    "last_done_at" TIMESTAMP(3),
    "next_due_at" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "om_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "om_contract_status" NOT NULL DEFAULT 'ACTIVE',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "monthly_cents" INTEGER NOT NULL,
    "billing" TEXT,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "document_id" UUID,
    "renewal_notified_at" TIMESTAMP(3),
    "renewal_opportunity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "om_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plants_installation_id_key" ON "plants"("installation_id");

-- CreateIndex
CREATE INDEX "plants_tenant_id_status_idx" ON "plants"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "plants_tenant_id_account_id_idx" ON "plants"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "plant_assets_tenant_id_plant_id_idx" ON "plant_assets"("tenant_id", "plant_id");

-- CreateIndex
CREATE INDEX "plant_events_tenant_id_plant_id_created_at_idx" ON "plant_events"("tenant_id", "plant_id", "created_at");

-- CreateIndex
CREATE INDEX "manufacturer_warranty_terms_tenant_id_manufacturer_category_idx" ON "manufacturer_warranty_terms"("tenant_id", "manufacturer", "category");

-- CreateIndex
CREATE INDEX "asset_warranties_tenant_id_ends_on_idx" ON "asset_warranties"("tenant_id", "ends_on");

-- CreateIndex
CREATE INDEX "asset_warranties_tenant_id_asset_id_idx" ON "asset_warranties"("tenant_id", "asset_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_priority_idx" ON "tickets"("tenant_id", "status", "priority");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_plant_id_idx" ON "tickets"("tenant_id", "plant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_number_key" ON "tickets"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_tenant_id_automation_key_key" ON "tickets"("tenant_id", "automation_key");

-- CreateIndex
CREATE INDEX "ticket_comments_tenant_id_ticket_id_created_at_idx" ON "ticket_comments"("tenant_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "maintenance_plans_tenant_id_active_next_due_at_idx" ON "maintenance_plans"("tenant_id", "active", "next_due_at");

-- CreateIndex
CREATE INDEX "om_contracts_tenant_id_status_ends_on_idx" ON "om_contracts"("tenant_id", "status", "ends_on");

-- AddForeignKey
ALTER TABLE "plants" ADD CONSTRAINT "plants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_assets" ADD CONSTRAINT "plant_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_assets" ADD CONSTRAINT "plant_assets_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_events" ADD CONSTRAINT "plant_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_events" ADD CONSTRAINT "plant_events_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manufacturer_warranty_terms" ADD CONSTRAINT "manufacturer_warranty_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_warranties" ADD CONSTRAINT "asset_warranties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_warranties" ADD CONSTRAINT "asset_warranties_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "plant_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_warranties" ADD CONSTRAINT "asset_warranties_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "manufacturer_warranty_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "om_contracts" ADD CONSTRAINT "om_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "om_contracts" ADD CONSTRAINT "om_contracts_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

