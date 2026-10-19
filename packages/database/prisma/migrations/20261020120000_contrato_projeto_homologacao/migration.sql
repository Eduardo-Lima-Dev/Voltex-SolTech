-- Fase 7C: contrato, projeto e homologação básica.

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('DOCUMENTATION', 'SUBMITTED', 'INSPECTION', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "checklist_item_status" AS ENUM ('PENDING', 'DONE', 'WAIVED', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "automation_key" TEXT;

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "proposal_version" INTEGER NOT NULL,
    "quote_id" UUID NOT NULL,
    "scenario_label" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
    "template_version" INTEGER,
    "template_is_default" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "missing_variables" JSONB NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "pdf_document_id" UUID,
    "signed_document_id" UUID,
    "signed_at" TIMESTAMP(3),
    "signed_by_name" TEXT,
    "recorded_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homologation_checklists" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "distributor_id" UUID,
    "version" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "deadlines" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "reviewed_by" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homologation_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "consumer_unit_id" UUID,
    "distributor_id" UUID,
    "contract_id" UUID NOT NULL,
    "status" "project_status" NOT NULL DEFAULT 'DOCUMENTATION',
    "value_cents" INTEGER NOT NULL,
    "generation_class" TEXT,
    "responsible_id" UUID,
    "rules_ref" TEXT NOT NULL,
    "rules_scope" TEXT NOT NULL,
    "rules_source" TEXT NOT NULL,
    "rules_reviewed_by" TEXT,
    "rules_notes" TEXT,
    "rules_deadlines" JSONB NOT NULL,
    "protocol_number" TEXT,
    "submitted_at" TIMESTAMP(3),
    "access_opinion_due_at" TIMESTAMP(3),
    "access_opinion_due_source" TEXT,
    "inspection_requested_at" TIMESTAMP(3),
    "inspection_due_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_checklist_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "checklist_item_status" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completed_by_id" UUID,
    "document_id" UUID,
    "source" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_tenant_id_version_key" ON "contract_templates"("tenant_id", "version");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_opportunity_id_idx" ON "contracts"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "contracts_tenant_id_status_idx" ON "contracts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_opportunity_id_version_key" ON "contracts"("opportunity_id", "version");

-- CreateIndex
CREATE INDEX "homologation_checklists_tenant_id_distributor_id_idx" ON "homologation_checklists"("tenant_id", "distributor_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_opportunity_id_key" ON "projects"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_contract_id_key" ON "projects"("contract_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "projects_tenant_id_responsible_id_idx" ON "projects"("tenant_id", "responsible_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_tenant_id_project_code_key" ON "projects"("tenant_id", "project_code");

-- CreateIndex
CREATE INDEX "project_checklist_items_tenant_id_project_id_idx" ON "project_checklist_items"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_checklist_items_project_id_code_key" ON "project_checklist_items"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_tenant_id_automation_key_key" ON "tasks"("tenant_id", "automation_key");

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homologation_checklists" ADD CONSTRAINT "homologation_checklists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homologation_checklists" ADD CONSTRAINT "homologation_checklists_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Um contrato não cancelado por oportunidade.
CREATE UNIQUE INDEX "contracts_one_active_per_opportunity" ON "contracts"("opportunity_id") WHERE "status" <> 'CANCELLED';

-- Versões das regras de homologação: únicas por escopo (padrão da empresa ou por distribuidora).
CREATE UNIQUE INDEX "homologation_checklists_tenant_version_key"
  ON "homologation_checklists"("tenant_id", "version") WHERE "distributor_id" IS NULL;
CREATE UNIQUE INDEX "homologation_checklists_distributor_version_key"
  ON "homologation_checklists"("tenant_id", "distributor_id", "version") WHERE "distributor_id" IS NOT NULL;

-- Modelos de contrato e regras de homologação são versões imutáveis: publica-se uma nova.
CREATE TRIGGER contract_templates_immutable
  BEFORE UPDATE OR DELETE ON "contract_templates"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

CREATE TRIGGER homologation_checklists_immutable
  BEFORE UPDATE OR DELETE ON "homologation_checklists"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

-- O texto do contrato nunca muda depois de gerado (para ajustar, cancela-se e gera-se outro). Só avançam a situação,
-- o PDF e os dados da assinatura; assinado ou cancelado, não muda mais nada.
CREATE OR REPLACE FUNCTION prevent_contract_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contracts é imutável: DELETE não é permitido';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'contracts é imutável: contrato % já está %', OLD."version", OLD."status";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."opportunity_id" IS DISTINCT FROM OLD."opportunity_id"
     OR NEW."proposal_id" IS DISTINCT FROM OLD."proposal_id"
     OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."template_version" IS DISTINCT FROM OLD."template_version"
     OR NEW."body" IS DISTINCT FROM OLD."body"
     OR NEW."variables" IS DISTINCT FROM OLD."variables"
     OR NEW."value_cents" IS DISTINCT FROM OLD."value_cents"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'contracts é imutável: o texto e os valores do contrato não podem ser alterados';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contracts_immutable
  BEFORE UPDATE OR DELETE ON "contracts"
  FOR EACH ROW EXECUTE FUNCTION prevent_contract_change();
