-- CreateEnum
CREATE TYPE "integration_kind" AS ENUM ('MONITORING', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('DISABLED', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "integration_health" AS ENUM ('UNKNOWN', 'GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "integration_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "communication_channel" AS ENUM ('EMAIL', 'WHATSAPP_LINK', 'COPY_LINK');

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" "integration_kind" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "integration_status" NOT NULL DEFAULT 'DISABLED',
    "official" BOOLEAN NOT NULL,
    "credentials" JSONB NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "health" "integration_health" NOT NULL DEFAULT 'UNKNOWN',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "terms_accepted_by_id" UUID,
    "terms_accepted_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "integration_run_status" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "integration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_dead_letters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,

    CONSTRAINT "integration_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "channel" "communication_channel" NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "account_id" UUID,
    "sent_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_tenant_id_kind_status_idx" ON "integration_connections"("tenant_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_tenant_id_provider_label_key" ON "integration_connections"("tenant_id", "provider", "label");

-- CreateIndex
CREATE INDEX "integration_runs_tenant_id_connection_id_started_at_idx" ON "integration_runs"("tenant_id", "connection_id", "started_at");

-- CreateIndex
CREATE INDEX "integration_dead_letters_tenant_id_resolved_at_idx" ON "integration_dead_letters"("tenant_id", "resolved_at");

-- CreateIndex
CREATE INDEX "communication_logs_tenant_id_entity_type_entity_id_idx" ON "communication_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "communication_logs_tenant_id_account_id_idx" ON "communication_logs"("tenant_id", "account_id");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_runs" ADD CONSTRAINT "integration_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_runs" ADD CONSTRAINT "integration_runs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_dead_letters" ADD CONSTRAINT "integration_dead_letters_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

