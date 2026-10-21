-- Rules Engine por chave e escopo (Fase 9A, ADR-0016).
-- Uma regra pode valer só para uma distribuidora, estado, tipo de projeto ou grupo de consumo; a mais específica vence.

ALTER TABLE "rule_sets" ADD COLUMN "scope" JSONB;
ALTER TABLE "rule_sets" ADD COLUMN "scope_key" TEXT NOT NULL DEFAULT '';

-- Antes: uma ativa por tenant e chave. Agora: uma ativa por tenant, chave e escopo.
DROP INDEX "rule_sets_one_active_per_key";
CREATE UNIQUE INDEX "rule_sets_one_active_per_key_scope"
  ON "rule_sets" ("tenant_id", "key", "scope_key") WHERE "status" = 'ACTIVE';

-- O escopo também é imutável depois de ativada a versão.
CREATE OR REPLACE FUNCTION prevent_rule_set_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'rule_sets: versão % já foi ativada e não pode ser excluída', OLD."version";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
    OR NEW."key" IS DISTINCT FROM OLD."key"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."scope" IS DISTINCT FROM OLD."scope"
    OR NEW."scope_key" IS DISTINCT FROM OLD."scope_key"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."sources" IS DISTINCT FROM OLD."sources"
    OR NEW."reviewed_by" IS DISTINCT FROM OLD."reviewed_by"
    OR NEW."reviewed_at" IS DISTINCT FROM OLD."reviewed_at"
  ) THEN
    RAISE EXCEPTION 'rule_sets: a definição da versão % é imutável depois de ativada; crie uma nova versão', OLD."version";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
