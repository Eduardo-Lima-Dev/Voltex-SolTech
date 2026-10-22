-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "maintenance_plan_id" UUID,
ADD COLUMN     "plant_id" UUID,
ADD COLUMN     "ticket_id" UUID;

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_plant_id_idx" ON "work_orders"("tenant_id", "plant_id");

