import { describe, expect, it } from 'vitest';
import { arrayElectrical, stringLimits, type StringLimitsInput } from './strings.js';

describe('série e paralelo (ENG-F05, EnergIF p. 41–42)', () => {
  it('20 módulos em série e 2 strings em paralelo', () => {
    expect(
      arrayElectrical({
        modulesInSeries: 20,
        stringsInParallel: 2,
        moduleVoltageV: 40,
        moduleCurrentA: 13,
      }),
    ).toEqual({ voltageV: 800, currentA: 26, powerW: 20_800 });
  });
  it('recusa quantidades inválidas', () => {
    const base = { stringsInParallel: 1, moduleVoltageV: 40, moduleCurrentA: 13 };
    expect(() => arrayElectrical({ ...base, modulesInSeries: 0 })).toThrow(RangeError);
    expect(() => arrayElectrical({ ...base, modulesInSeries: 1.5 })).toThrow(RangeError);
    expect(() => arrayElectrical({ ...base, modulesInSeries: 2, stringsInParallel: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('limites da string (ENG-F06)', () => {
  const base: StringLimitsInput = {
    vocColdV: 53.5,
    vmppColdV: 43.7,
    vmppHotV: 36.5,
    inverter: { maxDcVoltageV: 1100, mpptMinV: 200, mpptMaxV: 1000, startVoltageV: 250 },
  };

  it('limitado pela tensão máxima do inversor e pela tensão de partida', () => {
    expect(stringLimits(base)).toEqual({
      maxModules: 20,
      minModules: 7,
      maxLimitedBy: 'INVERTER_MAX_VOLTAGE',
      minLimitedBy: 'START_VOLTAGE',
      feasible: true,
    });
  });

  it('tensão máxima do sistema do módulo pode ser o limite', () => {
    const r = stringLimits({ ...base, moduleMaxSystemVoltageV: 1000 });
    expect(r.maxModules).toBe(18);
    expect(r.maxLimitedBy).toBe('MODULE_SYSTEM_VOLTAGE');
  });

  it('o MPPT máximo pode ser o limite', () => {
    const r = stringLimits({
      ...base,
      inverter: { maxDcVoltageV: 1500, mpptMinV: 200, mpptMaxV: 800 },
    });
    expect(r.maxModules).toBe(18);
    expect(r.maxLimitedBy).toBe('MPPT_MAX_VOLTAGE');
    expect(r.minLimitedBy).toBe('MPPT_MIN_VOLTAGE');
    expect(r.minModules).toBe(6);
  });

  it('sinaliza par inviável (mínimo acima do máximo)', () => {
    const r = stringLimits({
      ...base,
      inverter: { maxDcVoltageV: 500, mpptMinV: 400, mpptMaxV: 480 },
    });
    expect(r.feasible).toBe(false);
  });

  it('recusa tensões não positivas', () => {
    expect(() => stringLimits({ ...base, vocColdV: 0 })).toThrow(RangeError);
  });
});
