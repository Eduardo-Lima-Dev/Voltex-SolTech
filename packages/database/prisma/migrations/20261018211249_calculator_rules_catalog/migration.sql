-- CreateEnum
CREATE TYPE "traffic_light" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "customer_group" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "rule_set_status" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "calculation_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_id" UUID,
    "title" TEXT,
    "customer_name" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "traffic_light" "traffic_light" NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "rule_set_ref" TEXT NOT NULL,
    "references" JSONB NOT NULL,
    "opportunity_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "calculation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quick_calculation_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "created_by_id" UUID,
    "customer_name" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "traffic_light" "traffic_light" NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "rule_set_ref" TEXT NOT NULL,
    "references" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quick_calculation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distributors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "distributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "distributor_id" UUID NOT NULL,
    "customer_group" "customer_group" NOT NULL,
    "modality" TEXT,
    "energy_cents_per_kwh" DOUBLE PRECISION NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_resources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "hsp_monthly" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "plane" TEXT NOT NULL DEFAULT 'Plano horizontal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "solar_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_sets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "rule_set_status" NOT NULL DEFAULT 'DRAFT',
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "definition" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calculation_sessions_tenant_id_created_at_idx" ON "calculation_sessions"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "calculation_sessions_tenant_id_traffic_light_idx" ON "calculation_sessions"("tenant_id", "traffic_light");

-- CreateIndex
CREATE INDEX "quick_calculation_snapshots_tenant_id_session_id_idx" ON "quick_calculation_snapshots"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "quick_calculation_snapshots_tenant_id_created_at_idx" ON "quick_calculation_snapshots"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "distributors_tenant_id_idx" ON "distributors"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "distributors_tenant_id_name_key" ON "distributors"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "tariffs_tenant_id_distributor_id_valid_from_idx" ON "tariffs"("tenant_id", "distributor_id", "valid_from");

-- CreateIndex
CREATE INDEX "solar_resources_tenant_id_name_idx" ON "solar_resources"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "solar_resources_tenant_id_name_state_key" ON "solar_resources"("tenant_id", "name", "state");

-- CreateIndex
CREATE INDEX "rule_sets_tenant_id_key_status_idx" ON "rule_sets"("tenant_id", "key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rule_sets_tenant_id_key_version_key" ON "rule_sets"("tenant_id", "key", "version");

-- AddForeignKey
ALTER TABLE "calculation_sessions" ADD CONSTRAINT "calculation_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_calculation_snapshots" ADD CONSTRAINT "quick_calculation_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_calculation_snapshots" ADD CONSTRAINT "quick_calculation_snapshots_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "calculation_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "distributors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_resources" ADD CONSTRAINT "solar_resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Regras de integridade que o Prisma não expressa
-- ---------------------------------------------------------------------------------------------------------

-- No máximo UMA versão ativa por tenant e chave de regra.
CREATE UNIQUE INDEX "rule_sets_one_active_per_key" ON "rule_sets" ("tenant_id", "key") WHERE "status" = 'ACTIVE';

-- Ativar exige o responsável pela revisão (RN-012).
ALTER TABLE "rule_sets"
  ADD CONSTRAINT "rule_sets_active_requires_review"
  CHECK ("status" <> 'ACTIVE' OR ("reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "valid_from" IS NOT NULL));

-- Regra ativada ou aposentada é imutável: mudar uma regra cria uma NOVA versão.
CREATE OR REPLACE FUNCTION prevent_rule_set_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'rule_sets: versão % já foi ativada e não pode ser excluída', OLD."version";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."key" IS DISTINCT FROM OLD."key"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."sources" IS DISTINCT FROM OLD."sources"
    OR NEW."reviewed_by" IS DISTINCT FROM OLD."reviewed_by"
    OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
  ) THEN
    RAISE EXCEPTION 'rule_sets: a definição da versão % é imutável depois de ativada; crie uma nova versão', OLD."version";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rule_sets_immutable
  BEFORE UPDATE OR DELETE ON "rule_sets"
  FOR EACH ROW EXECUTE FUNCTION prevent_rule_set_change();

-- Snapshots do Calculator são imutáveis (ADR-0006): nenhuma linha pode ser alterada ou removida.
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% é imutável: % não é permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quick_calculation_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "quick_calculation_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
