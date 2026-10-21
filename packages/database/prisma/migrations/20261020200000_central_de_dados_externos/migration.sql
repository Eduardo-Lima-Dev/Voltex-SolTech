-- CreateEnum
CREATE TYPE "data_collection_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "watch_kind" AS ENUM ('NORM', 'LAW', 'OTHER');

-- CreateEnum
CREATE TYPE "update_proposal_type" AS ENUM ('TARIFF', 'WATCH_CHANGE', 'CATALOG_ITEM', 'SOLAR_RESOURCE', 'RULE_REVIEW');

-- CreateEnum
CREATE TYPE "update_proposal_status" AS ENUM ('PENDING', 'APPROVED', 'DISCARDED');

-- CreateTable
CREATE TABLE "data_sources" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "license_status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "terms_checked_at" TIMESTAMP(3),
    "terms_checked_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_collections" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "status" "data_collection_status" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "summary" JSONB NOT NULL DEFAULT '{}',
    "content_hash" TEXT,
    "error" TEXT,

    CONSTRAINT "data_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_series" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "payload" BYTEA,
    "collection_id" UUID NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "horizon_profiles" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation_m" DOUBLE PRECISION,
    "points" JSONB NOT NULL,
    "collection_id" UUID NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "horizon_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_watches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "watch_kind" NOT NULL DEFAULT 'NORM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_hash" TEXT,
    "last_text" TEXT,
    "checked_at" TIMESTAMP(3),
    "changed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "source_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_proposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "update_proposal_type" NOT NULL,
    "status" "update_proposal_status" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "target" JSONB,
    "proposed" JSONB NOT NULL,
    "diff" JSONB,
    "origin" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "update_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_key_key" ON "data_sources"("key");

-- CreateIndex
CREATE INDEX "data_collections_source_id_started_at_idx" ON "data_collections"("source_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "weather_series_source_id_kind_latitude_longitude_period_key" ON "weather_series"("source_id", "kind", "latitude", "longitude", "period");

-- CreateIndex
CREATE UNIQUE INDEX "horizon_profiles_source_id_latitude_longitude_key" ON "horizon_profiles"("source_id", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "source_watches_tenant_id_enabled_idx" ON "source_watches"("tenant_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "source_watches_tenant_id_url_key" ON "source_watches"("tenant_id", "url");

-- CreateIndex
CREATE INDEX "update_proposals_tenant_id_status_created_at_idx" ON "update_proposals"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "update_proposals_tenant_id_dedupe_key_key" ON "update_proposals"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "data_collections" ADD CONSTRAINT "data_collections_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_series" ADD CONSTRAINT "weather_series_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_series" ADD CONSTRAINT "weather_series_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "data_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horizon_profiles" ADD CONSTRAINT "horizon_profiles_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "horizon_profiles" ADD CONSTRAINT "horizon_profiles_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "data_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_watches" ADD CONSTRAINT "source_watches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_proposals" ADD CONSTRAINT "update_proposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
