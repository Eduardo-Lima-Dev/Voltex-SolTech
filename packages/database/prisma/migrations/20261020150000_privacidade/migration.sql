-- LGPD: pedidos de eliminação/anonimização e marca de dados anonimizados.

-- CreateEnum
CREATE TYPE "privacy_subject_type" AS ENUM ('LEAD', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "privacy_request_status" AS ENUM ('COMPLETED', 'BLOCKED');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "anonymized_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "anonymized_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" "privacy_subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "subject_label" TEXT NOT NULL,
    "status" "privacy_request_status" NOT NULL,
    "reason" TEXT NOT NULL,
    "blocked_reason" TEXT,
    "retained_until" TIMESTAMP(3),
    "summary" JSONB NOT NULL,
    "requested_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_requests_tenant_id_created_at_idx" ON "privacy_requests"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- O registro do pedido nunca muda nem some.
CREATE TRIGGER privacy_requests_immutable
  BEFORE UPDATE OR DELETE ON "privacy_requests"
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();
