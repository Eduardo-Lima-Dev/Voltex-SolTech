-- Fase 10: novos tipos de equipamento do catálogo (off-grid e híbrido).
ALTER TYPE "equipment_kind" ADD VALUE IF NOT EXISTS 'BATTERY';
ALTER TYPE "equipment_kind" ADD VALUE IF NOT EXISTS 'CHARGE_CONTROLLER';
ALTER TYPE "equipment_kind" ADD VALUE IF NOT EXISTS 'OFFGRID_INVERTER';
ALTER TYPE "equipment_kind" ADD VALUE IF NOT EXISTS 'GENERATOR';
