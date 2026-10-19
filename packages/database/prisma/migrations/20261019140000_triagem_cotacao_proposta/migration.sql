-- CreateEnum
CREATE TYPE "margin_status" AS ENUM ('WITHIN_POLICY', 'BELOW_POLICY', 'NO_POLICY');

-- CreateEnum
CREATE TYPE "approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "quote_approval_status" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "proposal_status" AS ENUM ('GENERATED', 'SENT', 'VIEWED', 'ACCEPTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "triage_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "traffic_light" NOT NULL,
    "checks" JSONB NOT NULL,
    "missing_fields" JSONB NOT NULL,
    "needs_human_review" BOOLEAN NOT NULL,
    "needs_engineering_review" BOOLEAN NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "rule_set_ref" TEXT NOT NULL,
    "bill_snapshot_id" UUID,
    "calculation_session_id" UUID,
    "inputs_fingerprint" TEXT NOT NULL,
    "invalidated_at" TIMESTAMP(3),
    "invalidated_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_overrides" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "justification" TEXT NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "margin_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_margin_rate" DOUBLE PRECISION NOT NULL,
    "project_type" "project_type",
    "team_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "margin_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "calculation_session_id" UUID,
    "items" JSONB NOT NULL,
    "costs" JSONB NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "margin" JSONB NOT NULL,
    "margin_status" "margin_status" NOT NULL,
    "min_margin_rate" DOUBLE PRECISION,
    "policy_id" UUID,
    "approval_status" "quote_approval_status" NOT NULL DEFAULT 'NONE',
    "locked_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MARGIN',
    "quote_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "status" "approval_status" NOT NULL DEFAULT 'PENDING',
    "margin_rate" DOUBLE PRECISION NOT NULL,
    "min_margin_rate" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "justification" TEXT NOT NULL,
    "requested_by_id" UUID,
    "decision_justification" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "proposal_status" NOT NULL DEFAULT 'GENERATED',
    "scenarios" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "token_hash" TEXT,
    "sent_at" TIMESTAMP(3),
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_name" TEXT,
    "accepted_by_document" TEXT,
    "accepted_ip" TEXT,
    "accepted_user_agent" TEXT,
    "pdf_document_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "triage_snapshots_tenant_id_opportunity_id_created_at_idx" ON "triage_snapshots"("tenant_id", "opportunity_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "triage_snapshots_opportunity_id_version_key" ON "triage_snapshots"("opportunity_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "triage_overrides_evaluation_id_key" ON "triage_overrides"("evaluation_id");

-- CreateIndex
CREATE INDEX "triage_overrides_tenant_id_idx" ON "triage_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "margin_policies_tenant_id_active_idx" ON "margin_policies"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "quotes_tenant_id_opportunity_id_idx" ON "quotes"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_opportunity_id_version_key" ON "quotes"("opportunity_id", "version");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_status_created_at_idx" ON "approval_requests"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_tenant_id_quote_id_idx" ON "approval_requests"("tenant_id", "quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_token_hash_key" ON "proposals"("token_hash");

-- CreateIndex
CREATE INDEX "proposals_tenant_id_opportunity_id_idx" ON "proposals"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE INDEX "proposals_tenant_id_status_idx" ON "proposals"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_opportunity_id_version_key" ON "proposals"("opportunity_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_snapshots_proposal_id_key" ON "proposal_snapshots"("proposal_id");

-- CreateIndex
CREATE INDEX "proposal_snapshots_tenant_id_idx" ON "proposal_snapshots"("tenant_id");

-- AddForeignKey
ALTER TABLE "triage_snapshots" ADD CONSTRAINT "triage_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_snapshots" ADD CONSTRAINT "triage_snapshots_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_overrides" ADD CONSTRAINT "triage_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_overrides" ADD CONSTRAINT "triage_overrides_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "triage_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "margin_policies" ADD CONSTRAINT "margin_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_snapshots" ADD CONSTRAINT "proposal_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_snapshots" ADD CONSTRAINT "proposal_snapshots_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------------------
-- Regras de integridade que o Prisma não expressa
-- ---------------------------------------------------------------------------------------------------------

-- Margem mínima plausível; preço positivo.
ALTER TABLE "margin_policies" ADD CONSTRAINT "margin_policies_rate_range" CHECK ("min_margin_rate" >= 0 AND "min_margin_rate" <= 0.95);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_price_positive" CHECK ("price_cents" > 0);

-- A decisão de uma aprovação precisa de responsável, justificativa e data (e só existe depois de decidida).
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_complete"
  CHECK (
    ("status" = 'PENDING' AND "decided_at" IS NULL AND "decision_justification" IS NULL)
    OR ("status" <> 'PENDING' AND "decided_at" IS NOT NULL AND "decision_justification" IS NOT NULL AND length(trim("decision_justification")) > 0)
  );

-- Liberação da triagem e conteúdo da proposta: registros imutáveis.
CREATE TRIGGER triage_overrides_immutable
  BEFORE UPDATE OR DELETE ON "triage_overrides"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

CREATE TRIGGER proposal_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "proposal_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

-- O relatório da triagem é imutável; só a invalidação (uma vez, de nulo para um valor) pode ser gravada.
CREATE OR REPLACE FUNCTION prevent_triage_snapshot_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'triage_snapshots é imutável: DELETE não é permitido';
  END IF;
  IF OLD."invalidated_at" IS NOT NULL THEN
    RAISE EXCEPTION 'triage_snapshots é imutável: a avaliação % já foi invalidada', OLD."version";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."opportunity_id" IS DISTINCT FROM OLD."opportunity_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."checks" IS DISTINCT FROM OLD."checks"
     OR NEW."missing_fields" IS DISTINCT FROM OLD."missing_fields"
     OR NEW."needs_human_review" IS DISTINCT FROM OLD."needs_human_review"
     OR NEW."needs_engineering_review" IS DISTINCT FROM OLD."needs_engineering_review"
     OR NEW."algorithm_version" IS DISTINCT FROM OLD."algorithm_version"
     OR NEW."rule_set_ref" IS DISTINCT FROM OLD."rule_set_ref"
     OR NEW."bill_snapshot_id" IS DISTINCT FROM OLD."bill_snapshot_id"
     OR NEW."calculation_session_id" IS DISTINCT FROM OLD."calculation_session_id"
     OR NEW."inputs_fingerprint" IS DISTINCT FROM OLD."inputs_fingerprint"
     OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'triage_snapshots é imutável: só a invalidação pode ser gravada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER triage_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "triage_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_triage_snapshot_change();
