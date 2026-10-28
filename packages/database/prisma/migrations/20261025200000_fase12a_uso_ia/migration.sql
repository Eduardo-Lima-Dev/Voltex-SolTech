-- CreateEnum
CREATE TYPE "ai_usage_purpose" AS ENUM ('CHAT', 'INSIGHTS', 'PROCUREMENT', 'DIAGNOSTICS');
-- CreateTable
CREATE TABLE "ai_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "user_key" TEXT NOT NULL,
    "purpose" "ai_usage_purpose" NOT NULL,
    "neurons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ai_usage_day_idx" ON "ai_usage"("day");
-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_tenant_id_day_user_key_purpose_key" ON "ai_usage"("tenant_id", "day", "user_key", "purpose");
-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
