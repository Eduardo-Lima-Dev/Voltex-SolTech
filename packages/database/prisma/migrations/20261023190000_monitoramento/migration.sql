-- CreateTable
CREATE TABLE "plant_monitoring_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_plant_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plant_monitoring_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_daily" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kwh_generated" DECIMAL(10,2) NOT NULL,
    "source" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_snapshots" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "kwh_power" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitoring_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_alarms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "monitoring_alarms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plant_monitoring_links_plant_id_connection_id_key" ON "plant_monitoring_links"("plant_id", "connection_id");

-- CreateIndex
CREATE INDEX "plant_monitoring_links_tenant_id_plant_id_idx" ON "plant_monitoring_links"("tenant_id", "plant_id");

-- CreateIndex
CREATE INDEX "plant_monitoring_links_tenant_id_connection_id_idx" ON "plant_monitoring_links"("tenant_id", "connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_daily_plant_id_date_source_key" ON "monitoring_daily"("plant_id", "date", "source");

-- CreateIndex
CREATE INDEX "monitoring_daily_tenant_id_plant_id_date_idx" ON "monitoring_daily"("tenant_id", "plant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_snapshots_plant_id_key" ON "monitoring_snapshots"("plant_id");

-- CreateIndex
CREATE INDEX "monitoring_snapshots_tenant_id_plant_id_idx" ON "monitoring_snapshots"("tenant_id", "plant_id");

-- CreateIndex
CREATE INDEX "monitoring_alarms_tenant_id_plant_id_opened_at_idx" ON "monitoring_alarms"("tenant_id", "plant_id", "opened_at");

-- CreateIndex
CREATE INDEX "monitoring_alarms_tenant_id_closed_at_idx" ON "monitoring_alarms"("tenant_id", "closed_at");

-- AddForeignKey
ALTER TABLE "plant_monitoring_links" ADD CONSTRAINT "plant_monitoring_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_monitoring_links" ADD CONSTRAINT "plant_monitoring_links_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plant_monitoring_links" ADD CONSTRAINT "plant_monitoring_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_daily" ADD CONSTRAINT "monitoring_daily_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_daily" ADD CONSTRAINT "monitoring_daily_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_snapshots" ADD CONSTRAINT "monitoring_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_snapshots" ADD CONSTRAINT "monitoring_snapshots_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_alarms" ADD CONSTRAINT "monitoring_alarms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoring_alarms" ADD CONSTRAINT "monitoring_alarms_plant_id_fkey" FOREIGN KEY ("plant_id") REFERENCES "plants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
