-- Eliminação de dados pessoais (LGPD): registros imutáveis que carregam nome/contato do titular (linha do tempo,
-- fotos da proposta, do cálculo e da fatura) precisam poder ser ANONIMIZADOS. A exceção é estreita: só UPDATE, só
-- dentro de uma transação que declare `voltex.privacy_erasure = on` (o serviço de privacidade), nunca DELETE.
CREATE OR REPLACE FUNCTION prevent_pii_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('voltex.privacy_erasure', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% é imutável: % não é permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER timeline_events_immutable ON "timeline_events";
CREATE TRIGGER timeline_events_immutable
  BEFORE UPDATE OR DELETE ON "timeline_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();

DROP TRIGGER proposal_snapshots_immutable ON "proposal_snapshots";
CREATE TRIGGER proposal_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "proposal_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();

DROP TRIGGER quick_calculation_snapshots_immutable ON "quick_calculation_snapshots";
CREATE TRIGGER quick_calculation_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "quick_calculation_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();

DROP TRIGGER energy_bill_snapshots_immutable ON "energy_bill_snapshots";
CREATE TRIGGER energy_bill_snapshots_immutable
  BEFORE UPDATE OR DELETE ON "energy_bill_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_pii_snapshot_mutation();
