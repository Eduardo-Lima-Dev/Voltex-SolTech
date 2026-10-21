import { describe, expect, it } from 'vitest';
import { extractProtectionDatasheet, isProtectionKind } from './datasheet-protection.js';

describe('leitor de ficha: proteções', () => {
  it('disjuntor: corrente, tensão, polos, curva, capacidade e norma', () => {
    const r = extractProtectionDatasheet(
      'PROTECTION',
      'Minidisjuntor bipolar curva C\nCorrente nominal 32 A\nTensão nominal 230 V\nPoder de corte 6 kA\nNBR NM 60898',
      'Disjuntor 2P 32A curva C',
      'WEG',
    );
    expect(r.spec).toMatchObject({
      protectionKind: 'BREAKER_AC',
      ratedCurrentA: 32,
      ratedVoltageV: 230,
      poles: 2,
      curve: 'C',
      breakingCapacityKa: 6,
    });
    expect(String(r.spec.standard)).toContain('NBR');
    expect(r.missing).toEqual([]);
  });

  it('DPS CC pelo contexto fotovoltaico, DPS CA sem ele', () => {
    expect(
      extractProtectionDatasheet('PROTECTION', 'DPS fotovoltaico 1000 Vcc', 'DPS 1000V').spec,
    ).toMatchObject({ protectionKind: 'SURGE_DC', ratedVoltageV: 1000 });
    expect(
      extractProtectionDatasheet('PROTECTION', 'Protetor contra surtos 275 V ca', 'DPS Classe II')
        .spec,
    ).toMatchObject({ protectionKind: 'SURGE_AC' });
  });

  it('fusível, seccionadora, DR, string box', () => {
    expect(
      extractProtectionDatasheet('PROTECTION', 'Fusível gPV 15 A 1000 V cc', 'Fusível 15A').spec,
    ).toMatchObject({ protectionKind: 'FUSE_DC', ratedCurrentA: 15, ratedVoltageV: 1000 });
    expect(
      extractProtectionDatasheet(
        'PROTECTION',
        'Seccionadora CC 63 A 1000 Vdc 4P',
        'Interruptor seccionador',
      ).spec,
    ).toMatchObject({ protectionKind: 'DISCONNECTOR_DC', ratedCurrentA: 63, poles: 4 });
    const dr = extractProtectionDatasheet(
      'PROTECTION',
      'Interruptor diferencial residual Tipo A\nSensibilidade 30 mA\n40 A',
      'DR 40A 30mA',
    );
    expect(dr.spec).toMatchObject({ protectionKind: 'RCD', sensitivityMa: 30, ratedCurrentA: 40 });
    expect(
      extractProtectionDatasheet('PROTECTION', 'String box 2 entradas', 'String Box 2E').spec
        .protectionKind,
    ).toBe('STRING_BOX');
  });

  it('o que a ficha não traz aparece como faltando, por tipo', () => {
    const r = extractProtectionDatasheet('PROTECTION', 'Disjuntor genérico', 'Disjuntor');
    expect(r.missing).toEqual(expect.arrayContaining(['ratedCurrentA', 'ratedVoltageV']));
    const none = extractProtectionDatasheet('PROTECTION', 'xyz', 'abc');
    expect(none.notes[0]).toContain('Não consegui ler');
    expect(none.missing).toContain('protectionKind');
  });
});

describe('leitor de ficha: cabos', () => {
  it('cabo solar: seção, isolação, tensão, temperatura e norma', () => {
    const r = extractProtectionDatasheet(
      'CABLE',
      'Cabo solar fotovoltaico\nSeção nominal: 6 mm²\nCondutor de cobre estanhado\nIsolação XLPE\nTensão nominal 1,8 kV\nTemperatura máxima do condutor 120 °C\nNBR 16612',
      'Cabo Solar 6mm² 1,8kV',
    );
    expect(r.spec).toMatchObject({
      cableKind: 'DC_SOLAR',
      crossSectionMm2: 6,
      conductor: 'CU',
      insulation: 'XLPE',
      maxConductorTempC: 120,
    });
    expect(r.spec.voltageRatingV).toBe(1800);
    expect(String(r.spec.standard)).toContain('NBR');
    expect(r.missing).toEqual([]);
  });

  it('cabo CA com 0,6/1 kV e alumínio', () => {
    const r = extractProtectionDatasheet(
      'CABLE',
      'Cabo de potência 0,6/1 kV HEPR alumínio 3 x 35 mm2',
      'Cabo 35mm²',
    );
    expect(r.spec).toMatchObject({
      cableKind: 'AC',
      crossSectionMm2: 35,
      conductor: 'AL',
      insulation: 'HEPR',
      voltageRatingV: 1000,
    });
  });

  it('tensão direta em V e sem dados', () => {
    expect(
      extractProtectionDatasheet('CABLE', 'Tensão nominal 750 V', 'Cabo flexível 2,5 mm²').spec,
    ).toMatchObject({ crossSectionMm2: 2.5, voltageRatingV: 750 });
    const none = extractProtectionDatasheet('CABLE', 'x', 'y');
    expect(none.missing).toContain('crossSectionMm2');
    expect(isProtectionKind('CABLE')).toBe(true);
    expect(isProtectionKind('MODULE')).toBe(false);
    expect(isProtectionKind(undefined)).toBe(false);
  });
});
