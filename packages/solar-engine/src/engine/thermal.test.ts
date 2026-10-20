import { describe, expect, it } from 'vitest';
import {
  cellTemperatureC,
  iscAtTemperatureA,
  vmppRangeV,
  vocColdV,
  voltageAtTemperatureV,
} from './thermal.js';

describe('temperatura da célula (ENG-F01)', () => {
  it('NOCT 45 °C, 30 °C e 800 W/m² dão 55 °C', () => {
    expect(cellTemperatureC({ ambientC: 30, noctC: 45, irradianceWm2: 800 })).toBeCloseTo(55, 10);
  });
  it('sem irradiância a célula está na temperatura ambiente', () => {
    expect(cellTemperatureC({ ambientC: 18, noctC: 45, irradianceWm2: 0 })).toBe(18);
  });
  it('recusa irradiância negativa', () => {
    expect(() => cellTemperatureC({ ambientC: 18, noctC: 45, irradianceWm2: -1 })).toThrow(
      RangeError,
    );
  });
});

describe('tensão com a temperatura (ENG-F02/F03)', () => {
  it('em 25 °C a tensão é a de STC', () => {
    expect(
      voltageAtTemperatureV({ stcVoltageV: 49.5, coefficientPctPerC: -0.27, cellTemperatureC: 25 }),
    ).toBe(49.5);
  });

  it('Voc no frio: 49,5 V, β −0,27 %/°C, −5 °C → 53,5095 V', () => {
    expect(vocColdV({ vocStcV: 49.5, betaVocPctPerC: -0.27, minAmbientC: -5 })).toBeCloseTo(
      53.5095,
      4,
    );
  });

  it('Vmpp frio/quente com β de Voc quando não há β de Vmpp (premissa registrada)', () => {
    const r = vmppRangeV({
      vmppStcV: 41.5,
      betaVocPctPerC: -0.27,
      minAmbientC: 5,
      maxCellC: 70,
    });
    expect(r.coldV).toBeCloseTo(43.741, 3);
    expect(r.hotV).toBeCloseTo(36.45775, 4);
    expect(r.coefficientSource).toBe('BETA_VOC_ASSUMED');
  });

  it('usa o β de Vmpp quando informado', () => {
    const r = vmppRangeV({
      vmppStcV: 41.5,
      betaVmppPctPerC: -0.35,
      betaVocPctPerC: -0.27,
      minAmbientC: 5,
      maxCellC: 70,
    });
    expect(r.hotV).toBeCloseTo(34.96375, 4);
    expect(r.coefficientSource).toBe('BETA_VMPP');
  });

  it('Isc sobe com a temperatura: 13,9 A, α +0,05 %/°C, 70 °C → 14,21275 A', () => {
    expect(
      iscAtTemperatureA({ iscStcA: 13.9, alphaIscPctPerC: 0.05, cellTemperatureC: 70 }),
    ).toBeCloseTo(14.21275, 5);
  });

  it('exemplo do Manual CRESESB 2014, p. 152 (Kt 0,03 ≡ NOCT 44 °C): 60 °C e Voc 33,9 V', () => {
    const tcel = cellTemperatureC({ ambientC: 30, noctC: 44, irradianceWm2: 1000 });
    expect(tcel).toBeCloseTo(60, 10);
    const voc = voltageAtTemperatureV({
      stcVoltageV: 38.4,
      coefficientPctPerC: -0.33,
      cellTemperatureC: tcel,
    });
    expect(voc).toBeCloseTo(33.96, 2); // o manual arredonda para 33,9 V
  });
});
