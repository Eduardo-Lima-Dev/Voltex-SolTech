-- O SQLSTATE 23001 (restrict_violation) era reinterpretado pelo driver do Prisma como violação de chave
-- estrangeira e escondia a mensagem. Usa a exceção padrão (P0001) para que o motivo chegue à aplicação.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é imutável: % não é permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;
