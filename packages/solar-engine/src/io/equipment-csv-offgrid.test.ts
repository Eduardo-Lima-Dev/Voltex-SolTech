import { describe, expect, it } from 'vitest';
import { EQUIPMENT_KINDS } from '@voltex/shared';
import { equipmentCsvTemplate, parseEquipmentCsv } from './equipment-csv.js';
import { missingFields } from './import-types.js';

describe('planilhas dos tipos off-grid', () => {
  it('todo tipo tem modelo com fabricante, modelo e custo', () => {
    for (const kind of EQUIPMENT_KINDS) {
      const header = equipmentCsvTemplate(kind).trim().split(';');
      expect(header.slice(0, 2)).toEqual(['fabricante', 'modelo']);
      expect(header.at(-1)).toBe('custo_referencia_reais');
    }
  });

  it('lê bateria, controlador, inversor off-grid e gerador', () => {
    const battery = parseEquipmentCsv(
      'BATTERY',
      'fabricante;modelo;quimica;tensao_nominal_v;capacidade_ah;dod_maxima_pct\nAcme;B100;LFP;51,2;100;90\n',
    );
    expect(battery.items[0]?.spec).toMatchObject({
      chemistry: 'LFP',
      nominalVoltageV: 51.2,
      capacityAh: 100,
      maxDodPct: 90,
    });
    const controller = parseEquipmentCsv(
      'CHARGE_CONTROLLER',
      'fabricante;modelo;tecnologia;tensao_banco_v;corrente_carga_a;voc_max_v;tensao_automatica\nAcme;C60;MPPT;48;60;250;sim\n',
    );
    expect(controller.items[0]?.spec).toMatchObject({ technology: 'MPPT', autoVoltage: true });
    const inverter = parseEquipmentCsv(
      'OFFGRID_INVERTER',
      'fabricante;modelo;topologia;tensao_banco_v;potencia_continua_w;tensao_ca_v;fases\nAcme;I3;hibrido;48;3000;220;monofasico\n',
    );
    expect(inverter.items[0]?.spec).toMatchObject({ topology: 'HYBRID', phases: 1 });
    const generator = parseEquipmentCsv(
      'GENERATOR',
      'fabricante;modelo;combustivel;potencia_continua_w;tensao_ca_v;fases\nAcme;G35;diesel;3500;220;3\n',
    );
    expect(generator.items[0]?.spec).toMatchObject({ fuel: 'DIESEL', phases: 3 });
    expect(missingFields('GENERATOR', generator.items[0]?.spec ?? {})).toEqual([]);
    expect(missingFields('BATTERY', {})).toContain('capacityAh');
  });
});
