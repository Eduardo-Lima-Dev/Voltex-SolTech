-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "custom_pipeline_stages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "base_stage" "opportunity_stage" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "custom_stage_id" UUID;

-- CreateIndex
CREATE INDEX "custom_pipeline_stages_tenant_id_base_stage_position_idx" ON "custom_pipeline_stages"("tenant_id", "base_stage", "position");

-- AddForeignKey
ALTER TABLE "custom_pipeline_stages" ADD CONSTRAINT "custom_pipeline_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_custom_stage_id_fkey" FOREIGN KEY ("custom_stage_id") REFERENCES "custom_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
