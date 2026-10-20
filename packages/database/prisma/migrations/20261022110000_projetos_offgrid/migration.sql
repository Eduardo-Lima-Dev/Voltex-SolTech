-- CreateTable
CREATE TABLE "offgrid_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "system_type" TEXT NOT NULL DEFAULT 'OFFGRID',
    "status" "engineering_request_status" NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "due_at" TIMESTAMP(3),
    "assignee_id" UUID,
    "project_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offgrid_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offgrid_projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system_type" TEXT NOT NULL DEFAULT 'OFFGRID',
    "status" "engineering_project_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "opportunity_id" UUID,
    "site_id" UUID,
    "responsible_id" UUID,
    "art_type" TEXT,
    "art_number" TEXT,
    "notes" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offgrid_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offgrid_versions" (
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

    CONSTRAINT "offgrid_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offgrid_review_comments" (
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

    CONSTRAINT "offgrid_review_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offgrid_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offgrid_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offgrid_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "request_id" UUID,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offgrid_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offgrid_requests_tenant_id_status_idx" ON "offgrid_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "offgrid_requests_tenant_id_assignee_id_idx" ON "offgrid_requests"("tenant_id", "assignee_id");

-- CreateIndex
CREATE INDEX "offgrid_projects_tenant_id_status_idx" ON "offgrid_projects"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offgrid_projects_tenant_id_code_key" ON "offgrid_projects"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "offgrid_versions_tenant_id_project_id_idx" ON "offgrid_versions"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "offgrid_versions_tenant_id_status_idx" ON "offgrid_versions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offgrid_versions_project_id_number_key" ON "offgrid_versions"("project_id", "number");

-- CreateIndex
CREATE INDEX "offgrid_review_comments_tenant_id_version_id_status_idx" ON "offgrid_review_comments"("tenant_id", "version_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offgrid_snapshots_version_id_key" ON "offgrid_snapshots"("version_id");

-- CreateIndex
CREATE INDEX "offgrid_snapshots_tenant_id_project_id_idx" ON "offgrid_snapshots"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "offgrid_events_tenant_id_project_id_created_at_idx" ON "offgrid_events"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "offgrid_events_tenant_id_request_id_created_at_idx" ON "offgrid_events"("tenant_id", "request_id", "created_at");

-- AddForeignKey
ALTER TABLE "offgrid_requests" ADD CONSTRAINT "offgrid_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_requests" ADD CONSTRAINT "offgrid_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_requests" ADD CONSTRAINT "offgrid_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "offgrid_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_projects" ADD CONSTRAINT "offgrid_projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_projects" ADD CONSTRAINT "offgrid_projects_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_versions" ADD CONSTRAINT "offgrid_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_versions" ADD CONSTRAINT "offgrid_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "offgrid_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_review_comments" ADD CONSTRAINT "offgrid_review_comments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_review_comments" ADD CONSTRAINT "offgrid_review_comments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "offgrid_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_snapshots" ADD CONSTRAINT "offgrid_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_snapshots" ADD CONSTRAINT "offgrid_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "offgrid_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_snapshots" ADD CONSTRAINT "offgrid_snapshots_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "offgrid_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_events" ADD CONSTRAINT "offgrid_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_events" ADD CONSTRAINT "offgrid_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "offgrid_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offgrid_events" ADD CONSTRAINT "offgrid_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "offgrid_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Versão enviada ou decidida é congelada (mesmo contrato do Engine).
CREATE OR REPLACE FUNCTION prevent_offgrid_version_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'offgrid_versions: a versão % já foi enviada e não pode ser excluída', OLD."number";
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
      RAISE EXCEPTION 'offgrid_versions: a versão % está congelada; crie uma nova versão', OLD."number";
    END IF;
    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
         (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED')
    ) THEN
      RAISE EXCEPTION 'offgrid_versions: transição % -> % não é permitida', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER offgrid_versions_frozen
  BEFORE UPDATE OR DELETE ON "offgrid_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_offgrid_version_change();

CREATE TRIGGER offgrid_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "offgrid_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();
