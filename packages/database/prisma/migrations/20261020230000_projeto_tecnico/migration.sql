-- CreateEnum
CREATE TYPE "engineering_project_status" AS ENUM ('IN_PROGRESS', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "engineering_version_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "review_comment_status" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "engineering_requests" ADD COLUMN     "assignee_id" UUID,
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "resolution" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "engineering_projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "engineering_project_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "opportunity_id" UUID,
    "responsible_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "engineering_version_status" NOT NULL DEFAULT 'DRAFT',
    "design" JSONB NOT NULL,
    "results" JSONB,
    "fingerprint" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "stale_reasons" JSONB NOT NULL DEFAULT '[]',
    "rule_refs" JSONB NOT NULL DEFAULT '[]',
    "data_refs" JSONB NOT NULL DEFAULT '[]',
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "decision_note" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engineering_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_version_equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "engineering_version_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_review_comments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "section" TEXT NOT NULL,
    "author_id" UUID,
    "text" TEXT NOT NULL,
    "status" "review_comment_status" NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_review_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engineering_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engineering_projects_tenant_id_status_idx" ON "engineering_projects"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "engineering_projects_tenant_id_opportunity_id_idx" ON "engineering_projects"("tenant_id", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_projects_tenant_id_code_key" ON "engineering_projects"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "engineering_versions_tenant_id_project_id_idx" ON "engineering_versions"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "engineering_versions_tenant_id_status_idx" ON "engineering_versions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_versions_project_id_number_key" ON "engineering_versions"("project_id", "number");

-- CreateIndex
CREATE INDEX "engineering_version_equipment_tenant_id_equipment_id_idx" ON "engineering_version_equipment"("tenant_id", "equipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_version_equipment_version_id_equipment_id_key" ON "engineering_version_equipment"("version_id", "equipment_id");

-- CreateIndex
CREATE INDEX "engineering_review_comments_tenant_id_version_id_status_idx" ON "engineering_review_comments"("tenant_id", "version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "engineering_snapshots_version_id_key" ON "engineering_snapshots"("version_id");

-- CreateIndex
CREATE INDEX "engineering_snapshots_tenant_id_project_id_idx" ON "engineering_snapshots"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "engineering_requests_tenant_id_assignee_id_idx" ON "engineering_requests"("tenant_id", "assignee_id");

-- AddForeignKey
ALTER TABLE "engineering_requests" ADD CONSTRAINT "engineering_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_projects" ADD CONSTRAINT "engineering_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_projects" ADD CONSTRAINT "engineering_projects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_versions" ADD CONSTRAINT "engineering_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_versions" ADD CONSTRAINT "engineering_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_version_equipment" ADD CONSTRAINT "engineering_version_equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_version_equipment" ADD CONSTRAINT "engineering_version_equipment_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "engineering_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_review_comments" ADD CONSTRAINT "engineering_review_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_review_comments" ADD CONSTRAINT "engineering_review_comments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "engineering_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_snapshots" ADD CONSTRAINT "engineering_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_snapshots" ADD CONSTRAINT "engineering_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engineering_snapshots" ADD CONSTRAINT "engineering_snapshots_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "engineering_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------
-- Regras de integridade que o Prisma não expressa (ADR-0015)
-- ---------------------------------------------------------------------------------------------------------

-- No máximo UMA versão aprovada por projeto: aprovar a nova exige aposentar a anterior (SUPERSEDED).
CREATE UNIQUE INDEX "engineering_one_approved_per_project"
  ON "engineering_versions" ("project_id") WHERE "status" = 'APPROVED';

-- Versão enviada ou decidida é congelada: o desenho e os resultados não mudam mais. Só o ciclo de vida
-- (DRAFT -> SUBMITTED -> APPROVED/REJECTED; APPROVED -> SUPERSEDED), a decisão e a marca "desatualizada" podem mudar.
CREATE OR REPLACE FUNCTION prevent_engineering_version_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'engineering_versions: a versão % já foi enviada e não pode ser excluída', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
       OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
       OR NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."design" IS DISTINCT FROM OLD."design"
       OR NEW."results" IS DISTINCT FROM OLD."results"
       OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
       OR NEW."rule_refs" IS DISTINCT FROM OLD."rule_refs"
       OR NEW."data_refs" IS DISTINCT FROM OLD."data_refs"
       OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at" THEN
      RAISE EXCEPTION 'engineering_versions: a versão % está congelada; crie uma nova versão', OLD."number";
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
         (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')
    ) THEN
      RAISE EXCEPTION 'engineering_versions: transição % -> % não é permitida', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER engineering_versions_frozen
  BEFORE UPDATE OR DELETE ON "engineering_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_engineering_version_change();

-- O snapshot da versão aprovada é imutável (só a eliminação de dados pessoais pode anonimizá-lo, ver LGPD).
CREATE TRIGGER engineering_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "engineering_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();
