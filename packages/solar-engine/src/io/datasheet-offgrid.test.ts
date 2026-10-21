import { describe, expect, it } from 'vitest';
import { extractOffgridDatasheet, isOffgridKind } from './datasheet-offgrid.js';

describe('leitor de ficha: tipos do Off-Grid', () => {
  it('bateria: rótulos do texto e dados do título', () => {
    const r = extractOffgridDatasheet(
      'BATTERY',
      'Tensão nominal: 51,2 V\nCapacidade nominal 100 Ah\nProfundidade de descarga 90%\nVida útil 6000 ciclos\nCorrente de carga máxima: 50 A\nCorrente de descarga contínua 100 A\nEficiência 95%\nPeso 45 kg\nLiFePO4',
      'Bateria UNIPOWER 4,8KWH - 48V 100AH',
      'Unipower',
    );
    expect(r.spec).toMatchObject({
      nominalVoltageV: 51.2,
      capacityAh: 100,
      maxDodPct: 90,
      cycleLife: 6000,
      maxChargeCurrentA: 50,
      maxDischargeCurrentA: 100,
      roundTripEfficiencyPct: 95,
      weightKg: 45,
      chemistry: 'LFP',
    });
    expect(r.fieldConfidence.nominalVoltageV).toBe('MEDIUM');
    expect(r.missing).toEqual([]);
  });

  it('bateria com texto pobre: usa o título com confiança baixa e lista o que falta', () => {
    const r = extractOffgridDatasheet(
      'BATTERY',
      '',
      'Bateria UNIPOWER 4,8KWH - 48V 100AH (In Wall)',
    );
    expect(r.spec).toMatchObject({ nominalVoltageV: 48, capacityAh: 100 });
    expect(r.fieldConfidence.nominalVoltageV).toBe('LOW');
    expect(r.missing).toEqual(expect.arrayContaining(['chemistry', 'maxDodPct']));
  });

  it('outras químicas', () => {
    const chem = (t: string) => extractOffgridDatasheet('BATTERY', t, '').spec.chemistry;
    expect(chem('bateria opzs 2v')).toBe('OPZS');
    expect(chem('bateria opzv')).toBe('OPZV');
    expect(chem('bateria agm selada')).toBe('LEAD_AGM');
    expect(chem('bateria gel')).toBe('LEAD_GEL');
    expect(chem('bateria estacionaria')).toBe('LEAD_FLOODED');
    expect(chem('li-ion nmc')).toBe('NMC');
    expect(chem('sem pista')).toBeUndefined();
  });

  it('controlador de carga', () => {
    const r = extractOffgridDatasheet(
      'CHARGE_CONTROLLER',
      'Controlador MPPT 60A 12/24/48V\nMax PV input voltage: 150 V\nMPPT range 30 - 120 V\nEficiência 98%\nMax PV power 3200 W',
      'Controlador de carga MPPT 60A',
    );
    expect(r.spec).toMatchObject({
      technology: 'MPPT',
      ratedChargeCurrentA: 60,
      pvVocMaxV: 150,
      mpptMinV: 30,
      mpptMaxV: 120,
      efficiencyPct: 98,
      pvPowerMaxW: 3200,
      autoVoltage: true,
    });
    expect(
      extractOffgridDatasheet('CHARGE_CONTROLLER', '', 'Controlador PWM 20A 12V').spec,
    ).toMatchObject({ technology: 'PWM', batteryVoltageV: 12 });
  });

  it('inversor off-grid e híbrido', () => {
    const r = extractOffgridDatasheet(
      'OFFGRID_INVERTER',
      'Inversor híbrido 5 kW\nPotência de surto: 10000 W\nBattery voltage 48 V\nSaída 220 V monofásico\nEficiência máxima 93%\nCorrente de carga 60 A\nMPPT range 120 - 450 V\nMax PV input voltage: 500 V\nentrada de gerador',
      'Inversor Híbrido 5kW 48V',
    );
    expect(r.spec).toMatchObject({
      topology: 'HYBRID',
      pContinuousW: 5000,
      pSurgeW: 10000,
      batteryVoltageV: 48,
      vAcV: 220,
      phases: 1,
      efficiencyPct: 93,
      chargerCurrentA: 60,
      generatorInput: true,
      mpptBuiltIn: true,
      mpptMinV: 120,
      mpptMaxV: 450,
      pvVocMaxV: 500,
    });
    const off = extractOffgridDatasheet(
      'OFFGRID_INVERTER',
      'onda modificada 12 v',
      'Inversor 1500 W',
    );
    expect(off.spec).toMatchObject({ topology: 'OFFGRID', sineWave: false, pContinuousW: 1500 });
    expect(extractOffgridDatasheet('OFFGRID_INVERTER', 'trifásico', 'Inversor').spec.phases).toBe(
      3,
    );
    expect(extractOffgridDatasheet('OFFGRID_INVERTER', 'bifásico', 'Inversor').spec.phases).toBe(2);
  });

  it('gerador', () => {
    const r = extractOffgridDatasheet(
      'GENERATOR',
      'Gerador a diesel\nPotência nominal 5000 W\nPotência máxima 5500 W\n220 V monofásico\nConsumo 1,8 L/h\npartida automática',
      'Gerador Diesel 5kVA',
    );
    expect(r.spec).toMatchObject({
      fuel: 'DIESEL',
      pContinuousW: 5000,
      pStandbyW: 5500,
      vAcV: 220,
      phases: 1,
      fuelLitersPerHour: 1.8,
      autoStart: true,
    });
    expect(
      extractOffgridDatasheet('GENERATOR', '', 'Gerador gasolina 3,5kVA trifásico').spec,
    ).toMatchObject({ fuel: 'GASOLINE', phases: 3, pContinuousW: 2800 });
    expect(extractOffgridDatasheet('GENERATOR', 'etanol flex', 'G').spec.fuel).toBe('ETHANOL');
    expect(extractOffgridDatasheet('GENERATOR', 'gás glp', 'G').spec.fuel).toBe('GAS');
  });

  it('PDF sem nada legível avisa e lista tudo o que falta', () => {
    const r = extractOffgridDatasheet('GENERATOR', 'xyz', 'abc');
    expect(r.notes[0]).toContain('Não consegui ler');
    expect(r.missing.length).toBeGreaterThan(2);
    expect(isOffgridKind('BATTERY')).toBe(true);
    expect(isOffgridKind('MODULE')).toBe(false);
    expect(isOffgridKind(undefined)).toBe(false);
  });
});
