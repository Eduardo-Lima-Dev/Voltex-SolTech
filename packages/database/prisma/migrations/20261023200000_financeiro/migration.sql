-- CreateEnum
CREATE TYPE "receivable_status" AS ENUM ('OPEN', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "credit_application_status" AS ENUM ('SIMULATED', 'SENT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "receivables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "reference_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_method" TEXT,
    "receipt_document_id" UUID,
    "status" "receivable_status" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_cost_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "receivable_id" UUID,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimated_cents" INTEGER,
    "actual_cents" INTEGER NOT NULL,
    "supplier" TEXT,
    "document_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "base" TEXT NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "user_id" UUID,
    "project_id" UUID,
    "amount_cents" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "status" "credit_application_status" NOT NULL DEFAULT 'SIMULATED',
    "annual_rate_pct" DOUBLE PRECISION,
    "term_months" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "total_cents" INTEGER,
    "pendencies" JSONB NOT NULL DEFAULT '[]',
    "document_id" UUID,
    "applied_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receivables_tenant_id_project_id_due_at_idx" ON "receivables"("tenant_id", "project_id", "due_at");

-- CreateIndex
CREATE INDEX "receivables_tenant_id_status_idx" ON "receivables"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "project_cost_entries_tenant_id_project_id_idx" ON "project_cost_entries"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "commission_policies_tenant_id_valid_from_idx" ON "commission_policies"("tenant_id", "valid_from");

-- CreateIndex
CREATE INDEX "commissions_tenant_id_policy_id_calculated_at_idx" ON "commissions"("tenant_id", "policy_id", "calculated_at");

-- CreateIndex
CREATE INDEX "commissions_tenant_id_user_id_paid_at_idx" ON "commissions"("tenant_id", "user_id", "paid_at");

-- CreateIndex
CREATE INDEX "credit_applications_tenant_id_project_id_idx" ON "credit_applications"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "credit_applications_tenant_id_status_idx" ON "credit_applications"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_cost_entries" ADD CONSTRAINT "project_cost_entries_receivable_id_fkey" FOREIGN KEY ("receivable_id") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_policies" ADD CONSTRAINT "commission_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "commission_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
