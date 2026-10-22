-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "geo" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "signature_document_id" UUID,
ADD COLUMN     "signed_at" TIMESTAMP(3),
ADD COLUMN     "signed_by_name" TEXT;

-- CreateTable
CREATE TABLE "work_order_photos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "client_action_id" TEXT NOT NULL,
    "caption" TEXT,
    "taken_at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "visible_to_customer" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_action_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "work_order_id" UUID,
    "type" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "message" TEXT,

    CONSTRAINT "field_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_order_photos_document_id_key" ON "work_order_photos"("document_id");

-- CreateIndex
CREATE INDEX "work_order_photos_tenant_id_work_order_id_idx" ON "work_order_photos"("tenant_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_photos_tenant_id_client_action_id_key" ON "work_order_photos"("tenant_id", "client_action_id");

-- CreateIndex
CREATE INDEX "field_actions_tenant_id_work_order_id_idx" ON "field_actions"("tenant_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_actions_tenant_id_client_action_id_key" ON "field_actions"("tenant_id", "client_action_id");

-- AddForeignKey
ALTER TABLE "work_order_photos" ADD CONSTRAINT "work_order_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_photos" ADD CONSTRAINT "work_order_photos_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_actions" ADD CONSTRAINT "field_actions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

