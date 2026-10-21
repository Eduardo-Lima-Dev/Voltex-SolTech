import { describe, expect, it } from 'vitest';
import {
  hasBlockingIssue,
  validateBatterySpec,
  validateChargeControllerSpec,
  validateGeneratorSpec,
  validateOffgridInverterSpec,
  validateSpec,
} from './validate.js';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

const battery = {
  chemistry: 'LFP' as const,
  nominalVoltageV: 51.2,
  capacityAh: 100,
  capacityHours: 5,
  maxDodPct: 90,
};
const controller = {
  technology: 'MPPT' as const,
  batteryVoltageV: 48,
  autoVoltage: false,
  ratedChargeCurrentA: 60,
  pvVocMaxV: 250,
  mpptMinV: 60,
  mpptMaxV: 230,
  tempCompensation: false,
};
const inverter = {
  topology: 'OFFGRID' as const,
  batteryVoltageV: 48,
  pContinuousW: 3000,
  vAcV: 220,
  phases: 1 as const,
  sineWave: true,
  gridInput: false,
  generatorInput: false,
  mpptBuiltIn: false,
};
const generator = {
  fuel: 'DIESEL' as const,
  pContinuousW: 3000,
  vAcV: 220,
  phases: 1 as const,
  autoStart: false,
  fuelLitersPerHour: 1,
};

describe('validação física: bateria', () => {
  it('ficha de lítio coerente não tem problemas', () => {
    expect(validateBatterySpec(battery)).toEqual([]);
  });
  it('chumbo com DoD alta, ciclos sem DoD, DoD de ciclos acima da máxima e unidades estranhas', () => {
    expect(
      codes(validateBatterySpec({ ...battery, chemistry: 'LEAD_FLOODED', maxDodPct: 90 })),
    ).toEqual(expect.arrayContaining(['LEAD_DOD_HIGH', 'FLOODED_DOD_HIGH']));
    expect(codes(validateBatterySpec({ ...battery, cycleLife: 3000 }))).toContain(
      'CYCLE_DOD_MISSING',
    );
    const above = validateBatterySpec({ ...battery, cycleLife: 3000, cycleDodPct: 95 });
    expect(codes(above)).toContain('CYCLE_DOD_ABOVE_MAX');
    expect(hasBlockingIssue(above)).toBe(true);
    expect(
      codes(
        validateBatterySpec({
          ...battery,
          nominalVoltageV: 7,
          capacityAh: 9000,
          roundTripEfficiencyPct: 50,
        }),
      ),
    ).toEqual(
      expect.arrayContaining(['BATTERY_VOLTAGE_ATYPICAL', 'CAPACITY_RANGE', 'EFFICIENCY_LOW']),
    );
  });
});

describe('validação física: controlador', () => {
  it('MPPT coerente', () => {
    expect(validateChargeControllerSpec(controller)).toEqual([]);
  });
  it('MPPT sem faixa, invertida ou acima da Voc máxima', () => {
    expect(codes(validateChargeControllerSpec({ ...controller, mpptMinV: undefined }))).toContain(
      'MPPT_RANGE_REQUIRED',
    );
    expect(codes(validateChargeControllerSpec({ ...controller, mpptMinV: 300 }))).toContain(
      'MPPT_RANGE_INVERTED',
    );
    expect(codes(validateChargeControllerSpec({ ...controller, mpptMaxV: 400 }))).toContain(
      'MPPT_ABOVE_VOC_MAX',
    );
  });
  it('PWM não exige faixa; potência FV exagerada e tensão de banco atípica avisam', () => {
    const pwm = {
      ...controller,
      technology: 'PWM' as const,
      mpptMinV: undefined,
      mpptMaxV: undefined,
    };
    expect(validateChargeControllerSpec(pwm)).toEqual([]);
    expect(
      codes(validateChargeControllerSpec({ ...pwm, pvPowerMaxW: 99_999, batteryVoltageV: 17 })),
    ).toEqual(expect.arrayContaining(['PV_POWER_HIGH', 'BATTERY_VOLTAGE_ATYPICAL']));
  });
});

describe('validação física: inversor off-grid e gerador', () => {
  it('inversor coerente', () => {
    expect(codes(validateOffgridInverterSpec(inverter))).toEqual([]);
  });
  it('surto menor que o contínuo, híbrido sem rede, MPPT embutido incompleto/invertido, carregador e onda', () => {
    expect(codes(validateOffgridInverterSpec({ ...inverter, pSurgeW: 100 }))).toContain(
      'SURGE_BELOW_CONTINUOUS',
    );
    expect(codes(validateOffgridInverterSpec({ ...inverter, topology: 'HYBRID' }))).toContain(
      'HYBRID_WITHOUT_GRID',
    );
    expect(codes(validateOffgridInverterSpec({ ...inverter, mpptBuiltIn: true }))).toContain(
      'MPPT_RANGE_REQUIRED',
    );
    expect(
      codes(
        validateOffgridInverterSpec({
          ...inverter,
          mpptBuiltIn: true,
          mpptMinV: 200,
          mpptMaxV: 100,
          pvVocMaxV: 250,
        }),
      ),
    ).toContain('MPPT_RANGE_INVERTED');
    expect(
      codes(
        validateOffgridInverterSpec({
          ...inverter,
          mpptBuiltIn: true,
          mpptMinV: 60,
          mpptMaxV: 200,
          pvVocMaxV: 250,
          gridInput: true,
        }),
      ),
    ).toContain('CHARGER_MISSING');
    expect(codes(validateOffgridInverterSpec({ ...inverter, sineWave: false }))).toContain(
      'NOT_SINE',
    );
  });
  it('gerador', () => {
    expect(validateGeneratorSpec(generator)).toEqual([]);
    expect(
      codes(validateGeneratorSpec({ ...generator, pStandbyW: 100, fuelLitersPerHour: undefined })),
    ).toEqual(expect.arrayContaining(['STANDBY_BELOW_CONTINUOUS', 'FUEL_MISSING']));
  });
  it('despacha pelo tipo', () => {
    expect(validateSpec('BATTERY', battery)).toEqual([]);
    expect(validateSpec('CHARGE_CONTROLLER', controller)).toEqual([]);
    expect(codes(validateSpec('OFFGRID_INVERTER', inverter))).toEqual([]);
    expect(validateSpec('GENERATOR', generator)).toEqual([]);
  });
});
