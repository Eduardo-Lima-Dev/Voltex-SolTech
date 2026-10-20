ALTER TYPE "engineering_request_status" ADD VALUE IF NOT EXISTS 'WAITING_VISIT';
ALTER TYPE "engineering_request_status" ADD VALUE IF NOT EXISTS 'WAITING_INFO';
ALTER TYPE "engineering_request_status" ADD VALUE IF NOT EXISTS 'IN_REVIEW';

ALTER TABLE "engineering_requests" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "engineering_requests" ADD COLUMN "due_at" TIMESTAMP(3);

ALTER TABLE "engineering_projects"
  ADD COLUMN "site_id" UUID,
  ADD COLUMN "consumer_unit_id" UUID,
  ADD COLUMN "distributor_id" UUID,
  ADD COLUMN "target_kwp" DOUBLE PRECISION,
  ADD COLUMN "generation_class" TEXT,
  ADD COLUMN "art_type" TEXT,
  ADD COLUMN "art_number" TEXT,
  ADD COLUMN "council_registration" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE TABLE "engineering_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "request_id" UUID,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "engineering_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engineering_surveys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "completed_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "engineering_surveys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engineering_document_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "document_id" UUID,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "engineering_document_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "engineering_events_tenant_id_project_id_created_at_idx" ON "engineering_events"("tenant_id", "project_id", "created_at");
CREATE INDEX "engineering_events_tenant_id_request_id_created_at_idx" ON "engineering_events"("tenant_id", "request_id", "created_at");
CREATE UNIQUE INDEX "engineering_surveys_project_id_key" ON "engineering_surveys"("project_id");
CREATE UNIQUE INDEX "engineering_document_items_project_id_code_key" ON "engineering_document_items"("project_id", "code");

ALTER TABLE "engineering_events" ADD CONSTRAINT "engineering_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_events" ADD CONSTRAINT "engineering_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineering_events" ADD CONSTRAINT "engineering_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "engineering_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineering_surveys" ADD CONSTRAINT "engineering_surveys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_surveys" ADD CONSTRAINT "engineering_surveys_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "engineering_document_items" ADD CONSTRAINT "engineering_document_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "engineering_document_items" ADD CONSTRAINT "engineering_document_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "engineering_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
