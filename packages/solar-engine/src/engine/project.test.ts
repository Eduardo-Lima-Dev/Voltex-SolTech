import { describe, expect, it } from 'vitest';
import { engineeringDesignSchema, surfaceSchema, type EngineeringDesign } from '@voltex/shared';
import { computeEngineeringResults } from './project.js';

const MODULE_ID = '0198a000-0000-7000-8000-000000000001';
const MODULE = { lengthMm: 2278, widthMm: 1134, pmaxWp: 550 };

const design = (over: Partial<EngineeringDesign> = {}): EngineeringDesign =>
  engineeringDesignSchema.parse({
    site: { latitude: -15.78, longitude: -47.93 },
    surfaces: [
      { id: 's1', name: 'Água norte', azimuthDegrees: 0, tiltDegrees: 20, widthM: 10, depthM: 5 },
    ],
    ...over,
  });

describe('resultados do projeto', () => {
  it('sem módulo escolhido há pendência e a potência fica nula', () => {
    const r = computeEngineeringResults(design(), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['MODULE_NOT_SELECTED']);
    expect(r.totals.powerKwp).toBeNull();
    expect(r.layout[0]?.fitCount).toBe(0);
    expect(r.shading).toHaveLength(1);
  });

  it('módulo fora do catálogo é pendência diferente', () => {
    const r = computeEngineeringResults(design({ defaultModuleId: MODULE_ID }), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['MODULE_NOT_FOUND']);
  });

  it('sem superfícies avisa', () => {
    const r = computeEngineeringResults(design({ surfaces: [] }), { modules: {} });
    expect(r.pending.map((p) => p.code)).toEqual(['NO_SURFACES']);
    expect(r.totals).toEqual({ moduleCount: 0, powerKwp: null, moduleAreaM2: null });
  });

  it('com módulo calcula layout, potência e sombra; o módulo da superfície vence o padrão', () => {
    const other = '0198a000-0000-7000-8000-000000000002';
    const d = design({
      defaultModuleId: MODULE_ID,
      surfaces: [
        surfaceSchema.parse({
          id: 's1',
          name: 'A',
          azimuthDegrees: 0,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
        }),
        surfaceSchema.parse({
          id: 's2',
          name: 'B',
          azimuthDegrees: 90,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
          moduleId: other,
        }),
      ],
    });
    const r = computeEngineeringResults(d, {
      modules: { [MODULE_ID]: MODULE, [other]: { lengthMm: 1700, widthMm: 1000, pmaxWp: 400 } },
    });
    expect(r.pending).toEqual([]);
    expect(r.layout[0]).toMatchObject({ moduleId: MODULE_ID, moduleCount: 8, powerKwp: 4.4 });
    expect(r.layout[1]?.moduleId).toBe(other);
    expect(r.totals.moduleCount).toBe(r.layout[0]!.moduleCount + r.layout[1]!.moduleCount);
    expect(r.totals.powerKwp).toBeCloseTo(
      (r.layout[0]!.powerKwp as number) + (r.layout[1]!.powerKwp as number),
      3,
    );
    expect(r.algorithmVersions).toMatchObject({ layout: 'layout-1.0.0', shading: 'shading-1.0.0' });
  });

  it('avisa que sem horizonte e sem obstáculos a perda por sombra é zero', () => {
    const r = computeEngineeringResults(design({ defaultModuleId: MODULE_ID }), {
      modules: { [MODULE_ID]: MODULE },
    });
    expect(r.shading[0]?.warnings.join(' ')).toMatch(/Sem perfil de horizonte/);
  });

  it('perda informada à mão substitui o cálculo e guarda a fonte', () => {
    const d = design({
      defaultModuleId: MODULE_ID,
      surfaces: [
        surfaceSchema.parse({
          id: 's1',
          name: 'A',
          azimuthDegrees: 0,
          tiltDegrees: 20,
          widthM: 10,
          depthM: 5,
          shadingLossOverride: { pct: 7.5, source: 'Visita técnica com Solmetric' },
        }),
      ],
    });
    const r = computeEngineeringResults(d, { modules: { [MODULE_ID]: MODULE } });
    expect(r.shading[0]).toMatchObject({
      overridden: true,
      annualLossPct: 7.5,
      overrideSource: 'Visita técnica com Solmetric',
    });
    expect(r.shading[0]?.monthlyLossPct).toEqual(Array(12).fill(7.5));
    expect(r.shading[0]?.warnings.join(' ')).toMatch(/informada à mão/);
  });
});

describe('simulação, comparações e economia no resultado do projeto', () => {
  const INVERTER_ID = '0198a000-0000-7000-8000-0000000000a1';
  const moduleSpec = {
    technology: 'MONO_SI' as const,
    pmaxWp: 550,
    vmppV: 41.7,
    imppA: 13.19,
    vocV: 49.7,
    iscA: 13.98,
    betaVocPctPerC: -0.27,
    alphaIscPctPerC: 0.05,
    gammaPmaxPctPerC: -0.34,
    noctC: 45,
    lengthMm: 2278,
    widthMm: 1134,
    bifacial: false,
  };
  const inverterSpec = {
    topology: 'STRING' as const,
    pAcNomW: 5000,
    vDcMaxV: 1100,
    mpptMinV: 140,
    mpptMaxV: 1000,
    mpptCount: 2,
    inputsPerMppt: 2,
    iMaxPerMpptA: 30,
    vAcV: 220,
    phases: 1,
    iAcMaxA: 25,
    exportLimitation: false,
  };
  const hour = (h: number) => (h >= 6 && h <= 17 ? 600 : 0);
  const series = {
    startAt: '2025-03-20T00:00:00Z',
    timeStandard: 'UTC' as const,
    ghiWhM2: Array.from({ length: 48 }, (_, i) => hour(i % 24)),
    dhiWhM2: Array.from({ length: 48 }, (_, i) => hour(i % 24) * 0.2),
    tempC: Array.from({ length: 48 }, () => 26),
    missingHours: 0,
  };
  const d = (economics?: unknown, simulation?: unknown) =>
    design({
      defaultModuleId: MODULE_ID,
      inverters: [{ id: 'e1', inverterId: INVERTER_ID, mppts: [] }],
      ...(economics ? { economics: economics as never } : {}),
      ...(simulation ? { simulation: simulation as never } : {}),
    });
  const context = (extra: Record<string, unknown> = {}) => ({
    modules: { [MODULE_ID]: moduleSpec },
    inverters: { [INVERTER_ID]: inverterSpec as never },
    prices: {
      [MODULE_ID]: { cents: 60_000, source: 'REFERENCE' as const },
      [INVERTER_ID]: { cents: 400_000, source: 'REFERENCE' as const },
    },
    ...extra,
  });
  const sim = {
    source: 'nasa-power' as const,
    year: 2025,
    lossPct: 14,
    inverterEfficiencyPct: 96,
    comparisonWarningPct: 5,
  };

  it('sem série: simulação incompleta e economia pendente de simulação', () => {
    const r = computeEngineeringResults(
      d({ monthlyConsumptionKwh: 300, tariffCentsPerKwh: 90, tariffSource: 'Fatura' }),
      context(),
    );
    expect(r.simulation?.status).toBe('INCOMPLETE');
    expect(r.economics?.pending.map((p) => p.code)).toEqual([
      'ECONOMICS_RULE_MISSING',
      'SIMULATION_MISSING',
    ]);
  });

  it('sem premissas econômicas nem regra: pendências explícitas', () => {
    const r = computeEngineeringResults(d(), context());
    expect(r.economics?.pending.map((p) => p.code)).toContain('ECONOMICS_INPUT_MISSING');
  });

  it('com série: energia, mensal, dia típico, cascata e comparações com PVGIS e Calculator', () => {
    const r = computeEngineeringResults(
      d(undefined, {
        ...sim,
        albedo: 0.2,
        pvgisReferenceEnergyKwh: 1,
        calculatorReferenceEnergyKwh: 2,
      }),
      context({
        simulation: {
          series,
          lossFraction: 0.14,
          inverterEfficiencyPct: 96,
          comparisonWarningPct: 5,
          albedo: 0.2,
          pvgisReferenceEnergyKwh: 1,
          calculatorReferenceEnergyKwh: 2,
        },
      }),
    );
    const s = r.simulation!;
    expect(s.energyKwh).toBeGreaterThan(0);
    expect(s.monthlyKwh).toHaveLength(12);
    expect(s.typicalDayKw).toHaveLength(24);
    expect(s.losses?.at(-1)?.id).toBe('AC');
    expect(s.comparisons?.map((c) => c.source)).toEqual(['PVGIS', 'CALCULATOR']);
    expect(s.warnings.join(' ')).toMatch(/difere .*% da referência PVGIS/);
  });

  it('sem referência PVGIS e sem coeficiente de potência no módulo, avisa; economia calcula com financiamento, cenários e tornado', () => {
    const { gammaPmaxPctPerC: _g, ...noGamma } = moduleSpec;
    const r = computeEngineeringResults(
      d(
        {
          monthlyConsumptionKwh: 300,
          tariffCentsPerKwh: 90,
          tariffSource: 'Fatura de teste',
          horizonYears: 10,
          financing: { downPaymentPct: 20, annualRatePct: 18, termMonths: 24, system: 'SAC' },
          scenarios: [{ name: 'Pessimista', generationFactor: 0.9 }],
        },
        sim,
      ),
      context({
        modules: { [MODULE_ID]: noGamma },
        simulation: {
          series,
          lossFraction: 0.14,
          inverterEfficiencyPct: 96,
          comparisonWarningPct: 5,
        },
        economicsParameters: { compensationFactor: 1 },
      }),
    );
    const w = r.simulation!.warnings.join(' ');
    expect(w).toMatch(/sem coeficiente de potência/);
    expect(w).toMatch(/Sem geração de referência PVGIS/);
    const e = r.economics!;
    expect(e.status).toBe('VALID');
    expect(e.financing?.system).toBe('SAC');
    expect(e.scenarios?.[0]?.name).toBe('Pessimista');
    expect(e.sensitivity).toHaveLength(6);
    expect(e.cashFlow).toHaveLength(10);
    expect(e.horizonYears).toBe(10);
  });
});
