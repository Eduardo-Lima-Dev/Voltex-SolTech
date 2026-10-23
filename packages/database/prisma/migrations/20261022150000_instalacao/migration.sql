-- CreateEnum
CREATE TYPE "installation_status" AS ENUM ('AWAITING_ENGINEERING', 'AWAITING_MATERIAL', 'MATERIAL_READY', 'SCHEDULING', 'CREW_ASSIGNED', 'IN_PROGRESS', 'FIELD_ISSUE', 'INSTALLED', 'COMMISSIONING', 'CUSTOMER_ACCEPTANCE', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "material_item_status" AS ENUM ('PENDING', 'ORDERED', 'RECEIVED', 'SEPARATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "work_order_type" AS ENUM ('VISIT', 'SURVEY', 'INSTALLATION', 'COMMISSIONING', 'MAINTENANCE', 'CLEANING');

-- CreateEnum
CREATE TYPE "work_order_status" AS ENUM ('PENDING', 'SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "field_issue_status" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "installations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "engineering_snapshot_id" UUID,
    "status" "installation_status" NOT NULL DEFAULT 'AWAITING_ENGINEERING',
    "responsible_id" UUID,
    "materials_generated_at" TIMESTAMP(3),
    "materials_ready_at" TIMESTAMP(3),
    "installed_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installation_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "from_status" "installation_status",
    "to_status" "installation_status" NOT NULL,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "equipment_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_cost_cents" INTEGER,
    "status" "material_item_status" NOT NULL DEFAULT 'PENDING',
    "supplier" TEXT,
    "purchase_order" TEXT,
    "ordered_cents" INTEGER,
    "expected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "separated_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "crew_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "crew_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID,
    "project_code" TEXT,
    "account_id" UUID,
    "site_id" UUID,
    "type" "work_order_type" NOT NULL,
    "status" "work_order_status" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "crew_id" UUID,
    "assignee_id" UUID,
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_issues" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "installation_id" UUID NOT NULL,
    "work_order_id" UUID,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "status" "field_issue_status" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reported_by_id" UUID,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installations_project_id_key" ON "installations"("project_id");

-- CreateIndex
CREATE INDEX "installations_tenant_id_status_idx" ON "installations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "installations_tenant_id_account_id_idx" ON "installations"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "installation_history_tenant_id_installation_id_created_at_idx" ON "installation_history"("tenant_id", "installation_id", "created_at");

-- CreateIndex
CREATE INDEX "material_items_tenant_id_installation_id_status_idx" ON "material_items"("tenant_id", "installation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crews_tenant_id_name_key" ON "crews"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "crew_members_tenant_id_user_id_idx" ON "crew_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crew_members_crew_id_user_id_key" ON "crew_members"("crew_id", "user_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_status_scheduled_start_idx" ON "work_orders"("tenant_id", "status", "scheduled_start");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_installation_id_idx" ON "work_orders"("tenant_id", "installation_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_assignee_id_status_idx" ON "work_orders"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_crew_id_scheduled_start_idx" ON "work_orders"("tenant_id", "crew_id", "scheduled_start");

-- CreateIndex
CREATE INDEX "field_issues_tenant_id_installation_id_status_idx" ON "field_issues"("tenant_id", "installation_id", "status");

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installations" ADD CONSTRAINT "installations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_history" ADD CONSTRAINT "installation_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installation_history" ADD CONSTRAINT "installation_history_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crews" ADD CONSTRAINT "crews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

