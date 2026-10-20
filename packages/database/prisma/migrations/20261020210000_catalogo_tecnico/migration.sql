-- CreateEnum
CREATE TYPE "equipment_kind" AS ENUM ('MODULE', 'INVERTER', 'PROTECTION', 'CABLE');

-- CreateEnum
CREATE TYPE "equipment_status" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "equipment_origin" AS ENUM ('MANUAL', 'CSV', 'PAN', 'OND', 'DATASHEET_PDF', 'CEC');

-- CreateTable
CREATE TABLE "equipment_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "equipment_kind" NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "origin" "equipment_origin" NOT NULL DEFAULT 'MANUAL',
    "external_record_id" UUID,
    "field_confidence" JSONB NOT NULL DEFAULT '{}',
    "reference_cost_cents" INTEGER,
    "datasheet_document_id" UUID,
    "inmetro_registration" TEXT,
    "inmetro_status" TEXT NOT NULL DEFAULT 'NOT_VERIFIED',
    "inmetro_checked_at" TIMESTAMP(3),
    "inmetro_checked_by" TEXT,
    "status" "equipment_status" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "retired_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID,
    "description" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "sku" TEXT,
    "price_cents" INTEGER NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_records" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "field_confidence" JSONB NOT NULL DEFAULT '{}',
    "content_hash" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_items_tenant_id_kind_status_idx" ON "equipment_items"("tenant_id", "kind", "status");

-- CreateIndex
CREATE INDEX "equipment_items_tenant_id_manufacturer_model_idx" ON "equipment_items"("tenant_id", "manufacturer", "model");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_items_tenant_id_kind_manufacturer_model_revision_key" ON "equipment_items"("tenant_id", "kind", "manufacturer", "model", "revision");

-- CreateIndex
CREATE INDEX "price_list_items_tenant_id_equipment_id_valid_from_idx" ON "price_list_items"("tenant_id", "equipment_id", "valid_from");

-- CreateIndex
CREATE INDEX "price_list_items_tenant_id_supplier_idx" ON "price_list_items"("tenant_id", "supplier");

-- CreateIndex
CREATE INDEX "external_records_kind_manufacturer_idx" ON "external_records"("kind", "manufacturer");

-- CreateIndex
CREATE UNIQUE INDEX "external_records_source_id_kind_manufacturer_model_key" ON "external_records"("source_id", "kind", "manufacturer", "model");

-- AddForeignKey
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipment_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_records" ADD CONSTRAINT "external_records_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Regras de integridade que o Prisma não expressa (ADR-0017)
-- ---------------------------------------------------------------------------------------------------------

-- No máximo UMA revisão aprovada por empresa, tipo, fabricante e modelo.
CREATE UNIQUE INDEX "equipment_one_approved_per_model"
  ON "equipment_items" ("tenant_id", "kind", "manufacturer", "model") WHERE "status" = 'APPROVED';

-- Aprovar registra quando e por quem.
ALTER TABLE "equipment_items"
  ADD CONSTRAINT "equipment_approved_has_approval"
  CHECK ("status" = 'DRAFT' OR ("approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL));

-- Depois de aprovado (ou aposentado) o item técnico é imutável: corrigir = nova revisão. Só o ciclo de vida
-- (APPROVED -> RETIRED), a conferência do INMETRO, o anexo da ficha, o custo de referência e as notas mudam.
CREATE OR REPLACE FUNCTION prevent_equipment_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'equipment_items: item % (revisão %) já foi aprovado e não pode ser excluído; aposente-o', OLD."model", OLD."revision";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."manufacturer" IS DISTINCT FROM OLD."manufacturer"
       OR NEW."model" IS DISTINCT FROM OLD."model"
       OR NEW."revision" IS DISTINCT FROM OLD."revision"
       OR NEW."spec" IS DISTINCT FROM OLD."spec"
       OR NEW."origin" IS DISTINCT FROM OLD."origin"
       OR NEW."field_confidence" IS DISTINCT FROM OLD."field_confidence"
       OR NEW."external_record_id" IS DISTINCT FROM OLD."external_record_id"
       OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
       OR NEW."approved_by_id" IS DISTINCT FROM OLD."approved_by_id" THEN
      RAISE EXCEPTION 'equipment_items: a ficha técnica da revisão % de % é imutável depois de aprovada; crie uma nova revisão', OLD."revision", OLD."model";
    END IF;
    IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
      RAISE EXCEPTION 'equipment_items: item aposentado não volta a valer; crie uma nova revisão';
    END IF;
    IF OLD."status" = 'APPROVED' AND NEW."status" = 'DRAFT' THEN
      RAISE EXCEPTION 'equipment_items: item aprovado não volta a rascunho';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER equipment_items_immutable
  BEFORE UPDATE OR DELETE ON "equipment_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_equipment_change();
