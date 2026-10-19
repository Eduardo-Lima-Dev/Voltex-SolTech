-- Anonimização: a manutenção também pode apagar o nome de quem assinou (dado pessoal), além de texto e variáveis.
-- Rodízio de chave de criptografia: o texto e as variáveis do contrato passam a ser guardados cifrados e precisam ser
-- recifrados quando a chave muda. O contrato continua imutável: a ÚNICA exceção é uma transação que declare
-- `voltex.reencrypt = on` (só a ferramenta de rodízio faz isso) e que altere SOMENTE `body` e `variables`.
CREATE OR REPLACE FUNCTION prevent_contract_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contracts é imutável: DELETE não é permitido';
  END IF;
  IF current_setting('voltex.reencrypt', true) = 'on'
     AND NEW."id" = OLD."id"
     AND NEW."tenant_id" = OLD."tenant_id"
     AND NEW."opportunity_id" = OLD."opportunity_id"
     AND NEW."proposal_id" = OLD."proposal_id"
     AND NEW."quote_id" = OLD."quote_id"
     AND NEW."version" = OLD."version"
     AND NEW."status" = OLD."status"
     AND NEW."template_version" IS NOT DISTINCT FROM OLD."template_version"
     AND NEW."value_cents" = OLD."value_cents"
     AND NEW."created_at" = OLD."created_at"
     AND NEW."pdf_document_id" IS NOT DISTINCT FROM OLD."pdf_document_id"
     AND NEW."signed_document_id" IS NOT DISTINCT FROM OLD."signed_document_id"
     AND NEW."signed_at" IS NOT DISTINCT FROM OLD."signed_at"
     AND NEW."cancelled_at" IS NOT DISTINCT FROM OLD."cancelled_at"
     AND NEW."cancel_reason" IS NOT DISTINCT FROM OLD."cancel_reason" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'contracts é imutável: contrato % já está %', OLD."version", OLD."status";
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id"
     OR NEW."opportunity_id" IS DISTINCT FROM OLD."opportunity_id"
     OR NEW."proposal_id" IS DISTINCT FROM OLD."proposal_id"
     OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."template_version" IS DISTINCT FROM OLD."template_version"
     OR NEW."body" IS DISTINCT FROM OLD."body"
     OR NEW."variables" IS DISTINCT FROM OLD."variables"
     OR NEW."value_cents" IS DISTINCT FROM OLD."value_cents"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'contracts é imutável: o texto e os valores do contrato não podem ser alterados';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
