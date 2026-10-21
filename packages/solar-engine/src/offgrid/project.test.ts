import { describe, expect, it } from 'vitest';
import { OFFGRID_PROVISIONAL_PARAMETERS } from './parameters.js';
import { computeOffgridResults, type OffgridContext } from './project.js';
import { IDS, baseContext, baseDesign } from './fixtures.js';
import type { OffgridResults } from '@voltex/shared';
import type { HourlySeries } from '../io/weather.js';

const withRules = (patch: Partial<OffgridContext> = {}): OffgridContext =>
  baseContext({ parameters: { ...OFFGRID_PROVISIONAL_PARAMETERS }, ...patch });

const codes = (r: OffgridResults, severity?: string): string[] =>
  r.checks.filter((c) => !severity || c.severity === severity).map((c) => c.code);

describe('projeto off-grid: caso completo', () => {
  const r = computeOffgridResults(baseDesign(), withRules());

  it('calcula carga, recurso, dimensionamento e escolhe sem erros', () => {
    expect(r.load.dailyWh).toBeGreaterThan(2000);
    expect(r.resource.source).toBe('SYNTHETIC');
    expect(r.sizing.pvPowerWp).toBeGreaterThan(800);
    expect(r.sizing.bankWhRequired).toBeGreaterThan(5000);
    expect(r.sizing.batterySeries).toBe(1);
    expect(r.sizing.moduleCount).toBe(Math.ceil(r.sizing.pvPowerWp / 550));
    expect(r.sizing.suggestedAutonomyDays).not.toBeNull();
    expect(codes(r, 'ERROR')).toEqual([]);
    expect(r.pending).toEqual([]);
    expect(r.selected?.moduleCount).toBe(4);
    expect(r.status).toBe('VALID_WITH_WARNINGS');
  });

  it('simula o ano, estressa e calcula o custo', () => {
    expect(r.simulation?.lolpPct).toBe(0);
    expect(r.simulation?.coveragePct).toBe(100);
    expect(r.simulation?.batteryLifeYears).toBeGreaterThan(5);
    expect(r.stress?.cloudyDays).toBe(3);
    expect(r.economics?.capexCents).toBeGreaterThan(0);
    expect(r.economics?.missingPrices).toEqual([]);
    expect(Object.keys(r.algorithmVersions)).toContain('dispatch');
  });

  it('é determinístico', () => {
    expect(computeOffgridResults(baseDesign(), withRules())).toEqual(r);
  });
});

describe('pendências', () => {
  it('sem regra usa valores provisórios e trava a aprovação', () => {
    const r = computeOffgridResults(baseDesign(), baseContext());
    expect(r.pending.map((p) => p.code)).toContain('RULE_PARAMETERS_MISSING');
    expect(r.status).toBe('INCOMPLETE');
    expect(r.simulation).not.toBeNull();
  });

  it('sem cargas, sem clima e sem escolhas', () => {
    const r = computeOffgridResults(
      baseDesign({
        site: { latitude: -15, longitude: -47 },
        loads: [],
        arrays: [],
        bank: { seriesCount: 1, parallelCount: 1 },
        controllerId: undefined,
        inverterId: undefined,
      }),
      withRules(),
    );
    const pending = r.pending.map((p) => p.code);
    expect(pending).toEqual(
      expect.arrayContaining([
        'NO_LOADS',
        'NO_SOLAR_RESOURCE',
        'NO_ARRAYS',
        'CONTROLLER_NOT_SELECTED',
        'BATTERY_NOT_SELECTED',
        'INVERTER_NOT_SELECTED',
      ]),
    );
    expect(r.status).toBe('INCOMPLETE');
    expect(r.simulation).toBeNull();
    expect(r.sizing.bankWhRequired).toBeNull();
    expect(r.resource.source).toBe('NONE');
  });

  it('arranjo sem módulo e módulo/controlador fora do catálogo', () => {
    const r = computeOffgridResults(
      baseDesign({
        arrays: [{ id: 'a1', name: 'Telhado', modulesInSeries: 4, parallelStrings: 1 }],
      }),
      withRules(),
    );
    expect(r.pending.map((p) => p.code)).toContain('MODULE_NOT_SELECTED');
    const missing = computeOffgridResults(baseDesign(), withRules({ status: {} }));
    expect(codes(missing, 'ERROR')).toContain('EQUIPMENT_NOT_FOUND');
  });

  it('equipamento rascunho não é aprovado', () => {
    const draft = computeOffgridResults(
      baseDesign(),
      withRules({ status: { ...baseContext().status, [IDS.battery]: 'DRAFT' } }),
    );
    expect(codes(draft, 'ERROR')).toContain('EQUIPMENT_NOT_APPROVED');
    expect(draft.status).toBe('INVALID');
  });

  it('sem temperatura mínima não confere a Voc a frio', () => {
    const r = computeOffgridResults(
      baseDesign({ site: { latitude: -15, longitude: -47, designTminC: null } }),
      withRules(),
    );
    expect(r.pending.map((p) => p.code)).toContain('DESIGN_TMIN_MISSING');
  });
});

describe('verificações do arranjo e do controlador', () => {
  const run = (patch: Record<string, unknown>, ctx: Partial<OffgridContext> = {}) =>
    computeOffgridResults(baseDesign(patch), withRules(ctx));

  it('Voc a frio acima do limite', () => {
    const r = run({
      arrays: [
        { id: 'a1', name: 'T', moduleId: IDS.module, modulesInSeries: 6, parallelStrings: 1 },
      ],
    });
    expect(codes(r, 'ERROR')).toContain('VOC_COLD_EXCEEDS');
  });

  it('Vmpp a quente abaixo do MPPT e da tensão de carga', () => {
    const r = run({
      arrays: [
        { id: 'a1', name: 'T', moduleId: IDS.module, modulesInSeries: 1, parallelStrings: 1 },
      ],
    });
    expect(codes(r, 'ERROR')).toEqual(
      expect.arrayContaining(['VMPP_BELOW_MPPT', 'ARRAY_BELOW_CHARGE_VOLTAGE']),
    );
  });

  it('corrente e potência acima do controlador', () => {
    const r = run({
      arrays: [
        { id: 'a1', name: 'T', moduleId: IDS.module, modulesInSeries: 4, parallelStrings: 5 },
      ],
    });
    expect(codes(r, 'ERROR')).toContain('CONTROLLER_CURRENT_EXCEEDED');
    expect(codes(r, 'WARNING')).toContain('CONTROLLER_POWER_EXCEEDED');
  });

  it('controlador PWM não alcança a tensão de carga', () => {
    const pwm = baseContext().controllers[IDS.controller];
    const r = run(
      {},
      {
        controllers: {
          [IDS.controller]: {
            ...(pwm as object),
            technology: 'PWM',
            mpptMinV: undefined,
            mpptMaxV: undefined,
          } as never,
        },
      },
    );
    expect(codes(r)).not.toContain('PWM_CANNOT_CHARGE');
    const low = run(
      {
        arrays: [
          { id: 'a1', name: 'T', moduleId: IDS.module, modulesInSeries: 1, parallelStrings: 1 },
        ],
      },
      {
        controllers: {
          [IDS.controller]: {
            ...(pwm as object),
            technology: 'PWM',
            mpptMinV: undefined,
            mpptMaxV: undefined,
          } as never,
        },
      },
    );
    expect(codes(low, 'ERROR')).toContain('PWM_CANNOT_CHARGE');
  });

  it('tensão do banco no controlador', () => {
    const c = baseContext().controllers[IDS.controller];
    const small = run(
      {},
      { controllers: { [IDS.controller]: { ...(c as object), batteryVoltageV: 24 } as never } },
    );
    expect(codes(small, 'ERROR')).toContain('CONTROLLER_VOLTAGE_MISMATCH');
    const bigger = run(
      {},
      {
        controllers: {
          [IDS.controller]: { ...(c as object), batteryVoltageV: 96, autoVoltage: false } as never,
        },
      },
    );
    expect(codes(bigger, 'WARNING')).toContain('CONTROLLER_VOLTAGE_HIGHER');
  });

  it('MPPT embutido no inversor dispensa o controlador', () => {
    const inv = baseContext().inverters[IDS.inverter];
    const r = run(
      { controllerId: undefined },
      {
        inverters: {
          [IDS.inverter]: {
            ...(inv as object),
            mpptBuiltIn: true,
            mpptCount: 2,
            mpptMinV: 60,
            mpptMaxV: 230,
            pvVocMaxV: 250,
            mpptCurrentA: 30,
            pvPowerMaxW: 3000,
          } as never,
        },
      },
    );
    expect(r.pending.map((p) => p.code)).not.toContain('CONTROLLER_NOT_SELECTED');
    expect(codes(r)).toContain('VOC_COLD_OK');
    expect(r.selected).not.toBeNull();
  });
});

describe('verificações do banco', () => {
  const run = (patch: Record<string, unknown>, ctx: Partial<OffgridContext> = {}) =>
    computeOffgridResults(baseDesign(patch), withRules(ctx));

  it('tensão do banco, paralelo e autonomia', () => {
    expect(
      codes(run({ bank: { batteryId: IDS.battery, seriesCount: 2, parallelCount: 2 } }), 'ERROR'),
    ).toContain('BANK_VOLTAGE_MISMATCH');
    expect(
      codes(run({ bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 6 } }), 'ERROR'),
    ).toContain('BANK_PARALLEL_EXCEEDED');
    expect(
      codes(run({ bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 1 } }), 'ERROR'),
    ).toContain('AUTONOMY_BELOW_MIN');
  });

  it('DoD pedida acima do limite e banco frio', () => {
    const r = run({
      bank: {
        batteryId: IDS.battery,
        seriesCount: 1,
        parallelCount: 2,
        designDodPct: 95,
        temperatureC: 5,
      },
    });
    expect(codes(r, 'WARNING')).toEqual(expect.arrayContaining(['DOD_LIMITED', 'BATTERY_COLD']));
  });

  it('chumbo usa o limite de C da regra e a corrente de carga alta é avisada', () => {
    const lead = {
      chemistry: 'LEAD_AGM' as const,
      nominalVoltageV: 12,
      capacityAh: 200,
      capacityHours: 20,
      maxDodPct: 80,
    };
    const r = run(
      {
        bank: { batteryId: IDS.battery, seriesCount: 4, parallelCount: 3 },
        arrays: [
          { id: 'a1', name: 'T', moduleId: IDS.module, modulesInSeries: 4, parallelStrings: 3 },
        ],
      },
      { batteries: { [IDS.battery]: lead } },
    );
    expect(codes(r, 'WARNING')).toContain('CHARGE_RATE_HIGH');
    expect(r.selected?.batteryCount).toBe(12);
  });

  it('bateria de lítio sem corrente máxima na ficha usa 0,5 C', () => {
    const lfp = baseContext().batteries[IDS.battery];
    const r = run(
      {},
      {
        batteries: {
          [IDS.battery]: {
            ...(lfp as object),
            maxChargeCurrentA: undefined,
            maxDischargeCurrentA: undefined,
            maxParallel: undefined,
          } as never,
        },
      },
    );
    expect(r.selected).not.toBeNull();
  });

  it('química "outra" gera aviso', () => {
    const other = {
      ...(baseContext().batteries[IDS.battery] as object),
      chemistry: 'OTHER',
    } as never;
    expect(run({}, { batteries: { [IDS.battery]: other } }).warnings.join(' ')).toContain('outra');
  });
});

const shaded = {
  id: 'a1',
  name: 'Telhado',
  moduleId: IDS.module,
  modulesInSeries: 4,
  parallelStrings: 1,
  shadingLossPct: 85,
};

describe('verificações do inversor e do gerador', () => {
  const run = (patch: Record<string, unknown>, ctx: Partial<OffgridContext> = {}) =>
    computeOffgridResults(baseDesign(patch), withRules(ctx));
  const inv = (patch: object) => ({
    [IDS.inverter]: { ...(baseContext().inverters[IDS.inverter] as object), ...patch } as never,
  });

  it('tensão, potência, surto, eficiência e onda', () => {
    expect(codes(run({}, { inverters: inv({ batteryVoltageV: 24 }) }), 'ERROR')).toContain(
      'INVERTER_VOLTAGE_MISMATCH',
    );
    expect(
      codes(run({}, { inverters: inv({ pContinuousW: 300, pSurgeW: 400 }) }), 'ERROR'),
    ).toEqual(expect.arrayContaining(['INVERTER_POWER_LOW', 'INVERTER_SURGE_LOW']));
    const weak = run(
      {},
      { inverters: inv({ efficiencyPct: 70, sineWave: false, pSurgeW: undefined }) },
    );
    expect(codes(weak, 'WARNING')).toEqual(
      expect.arrayContaining(['INVERTER_EFFICIENCY_LOW', 'INVERTER_NOT_SINE']),
    );
  });

  it('dois inversores somam potência', () => {
    const r = run({ inverterCount: 2 });
    expect(r.selected?.inverterContinuousW).toBe(6000);
  });

  it('híbrido exige inversor híbrido', () => {
    expect(codes(run({ systemType: 'HYBRID' }), 'ERROR')).toContain('INVERTER_NOT_HYBRID');
    const ok = run({ systemType: 'HYBRID', inverterId: IDS.hybridInverter });
    expect(codes(ok)).toContain('INVERTER_HYBRID_OK');
    expect(ok.simulation?.gridKwh).toBeGreaterThan(0);
    expect(ok.warnings.join(' ')).toContain('sem dados da rede');
  });

  it('híbrido em autoconsumo com queda diária e recarga pela rede', () => {
    const r = run({
      systemType: 'HYBRID',
      inverterId: IDS.hybridInverter,
      bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 1 },
      arrays: [shaded],
      grid: {
        mode: 'SELF_CONSUMPTION',
        dailyOutageStartHour: 19,
        dailyOutageHours: 3,
        gridChargeBelowSocPct: 40,
        tariffCentsPerKwh: 90,
      },
    });
    expect(r.simulation?.gridKwh).toBeGreaterThan(0);
    expect(r.economics?.annualGridCents).toBeGreaterThan(0);
  });

  it('gerador: escolha, potência, carregamento e SOC invertido', () => {
    expect(run({ generator: { enabled: true } }).pending.map((p) => p.code)).toContain(
      'GENERATOR_NOT_SELECTED',
    );
    const ok = run({
      generator: { enabled: true, generatorId: IDS.generator, fuelPriceCentsPerLiter: 650 },
    });
    expect(codes(ok)).toContain('GENERATOR_POWER_OK');
    expect(ok.selected?.generatorW).toBe(3500);
    expect(ok.economics?.capexItems.some((i) => i.description === 'Gerador')).toBe(true);
    const small = run(
      { generator: { enabled: true, generatorId: IDS.generator, startSocPct: 80, stopSocPct: 40 } },
      {
        generators: {
          [IDS.generator]: {
            fuel: 'GAS',
            pContinuousW: 400,
            vAcV: 220,
            phases: 1,
            autoStart: false,
          },
        },
      },
    );
    expect(codes(small, 'ERROR')).toEqual(
      expect.arrayContaining(['GENERATOR_POWER_LOW', 'GENERATOR_SOC_INVERTED']),
    );
    const noInput = run(
      { generator: { enabled: true, generatorId: IDS.generator } },
      { inverters: inv({ generatorInput: false }) },
    );
    expect(codes(noInput, 'WARNING')).toContain('INVERTER_NO_GENERATOR_INPUT');
    const limited = run(
      { generator: { enabled: true, generatorId: IDS.generator } },
      {
        generators: {
          [IDS.generator]: {
            fuel: 'GAS',
            pContinuousW: 600,
            vAcV: 220,
            phases: 1,
            autoStart: false,
          },
        },
      },
    );
    expect(codes(limited, 'WARNING')).toContain('GENERATOR_CHARGING_LIMITED');
  });

  it('o gerador reduz a perda de carga de um banco pequeno', () => {
    const smallBank = {
      bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 1 },
      autonomyDays: 1,
      arrays: [shaded],
    };
    const without = run(smallBank);
    const withGen = run({ ...smallBank, generator: { enabled: true, generatorId: IDS.generator } });
    expect(withGen.simulation?.unmetKwh).toBeLessThanOrEqual(without.simulation?.unmetKwh ?? 0);
    expect(withGen.simulation?.generatorKwh).toBeGreaterThan(0);
  });
});

describe('perda de carga, estresse e cenários', () => {
  it('perda de carga acima do limite é erro', () => {
    const r = computeOffgridResults(
      baseDesign({
        arrays: [
          {
            id: 'a1',
            name: 'T',
            moduleId: IDS.module,
            modulesInSeries: 4,
            parallelStrings: 1,
            shadingLossPct: 100,
          },
        ],
      }),
      withRules(),
    );
    expect(r.simulation?.lolpPct).toBeGreaterThan(5);
    expect(codes(r, 'ERROR')).toContain('LOLP_EXCEEDS');
    expect(r.status).toBe('INVALID');
  });

  it('estresse reprova com poucos dias de autonomia e fica nulo com série curta', () => {
    const thin = computeOffgridResults(
      baseDesign({
        bank: { batteryId: IDS.battery, seriesCount: 1, parallelCount: 2 },
        stress: { cloudyDays: 6, irradianceFactor: 0.05, loadGrowthPct: 50 },
      }),
      withRules(),
    );
    expect(thin.stress?.survives).toBe(false);
    expect(codes(thin, 'WARNING')).toContain('STRESS_FAILED');
    const series: HourlySeries = {
      startAt: '2021-01-01T00:00:00',
      timeStandard: 'LST',
      ghiWhM2: Array(48).fill(300),
      dhiWhM2: Array(48).fill(100),
      tempC: Array(48).fill(25),
      missingHours: 0,
    };
    const short = computeOffgridResults(baseDesign(), withRules({ series }));
    expect(short.resource.source).toBe('SERIES');
    expect(short.stress).toBeNull();
    const off = computeOffgridResults(baseDesign({ stress: { enabled: false } }), withRules());
    expect(off.stress).toBeNull();
  });

  it('cenários variam banco, strings e gerador', () => {
    const r = computeOffgridResults(
      baseDesign({
        scenarios: [
          { id: 's1', name: 'Banco maior', bank: { parallelCount: 3 } },
          { id: 's2', name: 'Mais FV', parallelStrings: 2 },
          { id: 's3', name: 'Com gerador', generatorEnabled: true },
        ],
        generator: { enabled: false, generatorId: IDS.generator },
      }),
      withRules(),
    );
    expect(r.scenarios).toHaveLength(3);
    const [bank, pv, gen] = r.scenarios;
    expect(bank?.bankNominalWh ?? 0).toBeGreaterThan(r.selected?.bankNominalWh ?? 0);
    expect(pv?.pvPowerWp ?? 0).toBeGreaterThan(r.selected?.pvPowerWp ?? 0);
    expect(gen?.generator).toBe(true);
    expect(gen?.capexCents).toBeGreaterThan(r.economics?.capexCents ?? 0);
  });

  it('autonomia de projeto abaixo do mínimo usa o mínimo e avisa', () => {
    const r = computeOffgridResults(baseDesign({ autonomyDays: 1 }), withRules());
    expect(r.sizing.autonomyDays).toBe(2);
    expect(r.warnings.join(' ')).toContain('abaixo do mínimo');
  });

  it('redutores e eficiências do projeto prevalecem sobre a regra', () => {
    const r = computeOffgridResults(
      baseDesign({ red1: 0.6, red2: 0.8, batteryEfficiency: 0.9, inverterEfficiency: 0.95 }),
      withRules(),
    );
    expect(r.sizing.red1).toBe(0.6);
    expect(r.sizing.inverterEfficiency).toBe(0.95);
  });
});
