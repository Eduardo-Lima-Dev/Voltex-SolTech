-- Fase 12.0: carteira do vendedor. A conta ganha um responsável.
ALTER TABLE "accounts" ADD COLUMN "owner_id" UUID;

-- Contas existentes: o responsável é o dono da oportunidade mais antiga da conta; sem oportunidade, o dono do
-- lead convertido que a originou (quando houver); caso contrário, a conta fica sem responsável (só a gestão a vê).
UPDATE "accounts" a
SET "owner_id" = o."owner_id"
FROM (
  SELECT DISTINCT ON ("account_id") "account_id", "owner_id"
  FROM "opportunities"
  WHERE "owner_id" IS NOT NULL
  ORDER BY "account_id", "created_at" ASC
) o
WHERE o."account_id" = a."id";

CREATE INDEX "accounts_tenant_id_owner_id_idx" ON "accounts"("tenant_id", "owner_id");

-- O cálculo ligado a uma oportunidade passa a ter a relação declarada, para a carteira do vendedor alcançar
-- os cálculos feitos por outras pessoas para as oportunidades dele.
UPDATE "calculation_sessions" SET "opportunity_id" = NULL
WHERE "opportunity_id" IS NOT NULL AND "opportunity_id" NOT IN (SELECT "id" FROM "opportunities");

ALTER TABLE "calculation_sessions"
  ADD CONSTRAINT "calculation_sessions_opportunity_id_fkey"
  FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "calculation_sessions_tenant_id_opportunity_id_idx"
  ON "calculation_sessions"("tenant_id", "opportunity_id");
