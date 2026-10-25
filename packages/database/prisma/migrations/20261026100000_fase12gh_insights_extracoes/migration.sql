-- CreateEnum
CREATE TYPE "insight_severity" AS ENUM ('INFO', 'ATTENTION', 'CRITICAL');
-- CreateEnum
CREATE TYPE "insight_status" AS ENUM ('NEW', 'SEEN', 'RESOLVED', 'DISMISSED');
-- CreateEnum
CREATE TYPE "price_extraction_status" AS ENUM ('PENDING_REVIEW', 'IMPORTED', 'DISCARDED');
-- CreateTable
CREATE TABLE "insights" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "insight_severity" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "owner_id" UUID,
    "permission" TEXT NOT NULL,
    "facts" JSONB NOT NULL DEFAULT '[]',
    "default_text" TEXT NOT NULL,
    "ai_text" TEXT,
    "link" TEXT NOT NULL,
    "status" "insight_status" NOT NULL DEFAULT 'NEW',
    "status_by_id" UUID,
    "status_at" TIMESTAMP(3),
    "helpful" BOOLEAN,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "price_extractions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "price_extraction_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "model" TEXT,
    "neurons" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMP(3),
    "imported_by_id" UUID,
    CONSTRAINT "price_extractions_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "insights_tenant_id_status_generated_at_idx" ON "insights"("tenant_id", "status", "generated_at");
-- CreateIndex
CREATE UNIQUE INDEX "insights_tenant_id_dedupe_key_key" ON "insights"("tenant_id", "dedupe_key");
-- CreateIndex
CREATE INDEX "price_extractions_tenant_id_created_at_idx" ON "price_extractions"("tenant_id", "created_at");
-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "price_extractions" ADD CONSTRAINT "price_extractions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
