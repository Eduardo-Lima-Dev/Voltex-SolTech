import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { AlertSeverity, CustomerGroup, ProjectType, TrafficLight } from '@voltex/shared';
import {
  ALGORITHM_VERSION,
  annualConsumption,
  annualGeneration,
  cashFlowPaybackYears,
  compensationRatio,
  estimatedAreaM2,
  investmentCents,
  moduleCount,
  monthlyGeneration,
  requiredPowerKwp,
  runQuickCalculation,
  simplePaybackYears,
  weightedAverageHsp,
  type QuickCalculationInput,
} from '../index.js';

/** Caso de referência do memorial (docs/06-calculos/calculator.md). */
const reference = (overrides: Partial<QuickCalculationInput> = {}): QuickCalculationInput => ({
  consumptionMonthlyKwh: Array<number>(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
  ...overrides,
});

const codes = (r: ReturnType<typeof runQuickCalculation>) => r.alerts.map((a) => a.code);

describe('caso de referência', () => {
  const r = runQuickCalculation(reference());

  it('dimensiona o sistema', () => {
    expect(r.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(r.averageMonthlyConsumptionKwh).toBe(500);
    expect(r.compensableMonthlyKwh).toBe(470);
    expect(r.annualConsumptionKwh).toBe(6000);
    expect(r.averageHsp).toBe(5);
    expect(r.requiredPowerKwp).toBeCloseTo(3.863, 3);
    expect(r.moduleCount).toBe(8);
    expect(r.installedPowerKwp).toBe(4.4);
    expect(r.estimatedAreaM2).toBe(20.64);
  });

  it('estima a geração', () => {
    expect(r.annualGenerationKwh).toBeCloseTo(6424, 1);
    expect(r.monthlyGenerationKwh).toHaveLength(12);
    expect(r.monthlyGenerationKwh[0]).toBeCloseTo(545.6, 1); // 4,4 × 5 × 31 × 0,8
    expect(r.monthlyGenerationKwh[1]).toBeCloseTo(492.8, 1); // fevereiro, 28 dias
    expect(r.compensationRatio).toBeCloseTo(1.0707, 4);
  });

  it('calcula investimento, economia e payback', () => {
    expect(r.investmentCents).toBe(1_980_000);
    expect(r.firstYearSavingsCents).toBe(535_800); // 470 kWh × 12 × 95 cent
    expect(r.accumulatedSavingsCents).toBe(25 * 535_800);
    expect(r.simplePaybackYears).toBeCloseTo(3.7, 1);
    expect(r.cashFlowPaybackYears).toBeCloseTo(3.7, 1);
    expect(r.cashFlow).toHaveLength(25);
    expect(r.cashFlow[0]?.cumulativeCents).toBe(535_800 - 1_980_000);
  });

  it('é verde, sem alertas e com confiança máxima', () => {
    expect(r.trafficLight).toBe(TrafficLight.GREEN);
    expect(r.alerts).toEqual([]);
    expect(r.requiresEngineering).toBe(false);
    expect(r.confidenceScore).toBe(100);
  });

  it('é determinístico', () => {
    expect(runQuickCalculation(reference())).toEqual(r);
  });
});

describe('premissas financeiras', () => {
  it('custo total informado tem precedência sobre o custo por Wp', () => {
    const r = runQuickCalculation(reference({ systemCostCents: 2_000_000 }));
    expect(r.investmentCents).toBe(2_000_000);
  });

  it('aplica reajuste tarifário a partir do segundo ano', () => {
    const r = runQuickCalculation(reference({ tariffEscalationRate: 0.1 }));
    expect(r.cashFlow[0]?.savingsCents).toBe(535_800);
    expect(r.cashFlow[1]?.savingsCents).toBe(589_380);
    expect(r.cashFlowPaybackYears).toBeLessThan(r.simplePaybackYears ?? 0);
  });

  it('aplica degradação à geração e limita a economia ao consumo a compensar', () => {
    const r = runQuickCalculation(reference({ moduleDegradationRate: 0.05, horizonYears: 25 }));
    const last = r.cashFlow[24];
    expect(last?.generationKwh).toBeCloseTo(6424 * 0.95 ** 24, 3);
    expect(last?.compensatedKwh).toBeLessThan(470 * 12);
    expect(r.cashFlow[0]?.compensatedKwh).toBe(470 * 12);
  });

  it('sem payback no horizonte: payback nulo e alerta informativo (continua verde)', () => {
    const r = runQuickCalculation(reference({ costPerWpCents: 5000 }));
    expect(r.cashFlowPaybackYears).toBeNull();
    expect(codes(r)).toContain('NO_PAYBACK_IN_HORIZON');
    expect(r.trafficLight).toBe(TrafficLight.GREEN);
  });
});

describe('semáforo', () => {
  it('amarelo para Grupo A e pede engenharia', () => {
    const r = runQuickCalculation(reference({ customerGroup: CustomerGroup.A }));
    expect(r.trafficLight).toBe(TrafficLight.YELLOW);
    expect(codes(r)).toEqual(['GROUP_A_COMPLEX']);
    expect(r.requiresEngineering).toBe(true);
    expect(r.confidenceScore).toBe(95);
  });

  it.each([
    [{ contractedDemandRelevant: true }, 'CONTRACTED_DEMAND_RELEVANT'],
    [{ possibleGridZero: true }, 'POSSIBLE_GRID_ZERO'],
    [{ shadingRelevant: true }, 'SHADING_RELEVANT'],
    [{ projectType: ProjectType.HYBRID }, 'HYBRID_REQUESTED'],
    [{ projectType: ProjectType.OFF_GRID }, 'OFF_GRID_REQUESTED'],
    [{ missingCriticalData: ['concessionária'] }, 'MISSING_CRITICAL_DATA'],
  ] as const)('amarelo para %j', (override, code) => {
    const r = runQuickCalculation(reference(override as Partial<QuickCalculationInput>));
    expect(r.trafficLight).toBe(TrafficLight.YELLOW);
    expect(codes(r)).toContain(code);
    expect(r.requiresEngineering).toBe(true);
  });

  it('vermelho quando a área disponível é insuficiente', () => {
    const r = runQuickCalculation(reference({ availableAreaM2: 10 }));
    expect(r.trafficLight).toBe(TrafficLight.RED);
    expect(codes(r)).toContain('INSUFFICIENT_AREA');
    expect(r.alerts.find((a) => a.code === 'INSUFFICIENT_AREA')?.severity).toBe(
      AlertSeverity.BLOCKING,
    );
    expect(r.requiresEngineering).toBe(false);
    expect(r.confidenceScore).toBe(80);
  });

  it('aceita área exatamente suficiente', () => {
    expect(runQuickCalculation(reference({ availableAreaM2: 20.64 })).trafficLight).toBe(
      TrafficLight.GREEN,
    );
  });

  it('vermelho quando o consumo não supera o custo de disponibilidade', () => {
    const r = runQuickCalculation(reference({ consumptionMonthlyKwh: [20] }));
    expect(r.trafficLight).toBe(TrafficLight.RED);
    expect(codes(r)).toContain('INCONSISTENT_INPUT');
    expect(r.moduleCount).toBe(0);
    expect(r.installedPowerKwp).toBe(0);
    expect(r.simplePaybackYears).toBeNull();
  });

  it('vermelho para PR e HSP fora da faixa configurada', () => {
    expect(codes(runQuickCalculation(reference({ performanceRatio: 0.95 })))).toContain(
      'ASSUMPTION_OUT_OF_RANGE',
    );
    const lowHsp = runQuickCalculation(reference({ hspMonthly: Array<number>(12).fill(1) }));
    expect(lowHsp.trafficLight).toBe(TrafficLight.RED);
  });

  it('respeita limites sobrescritos pelo Rules Engine', () => {
    const r = runQuickCalculation(
      reference({
        thresholds: {
          performanceRatioMin: 0.5,
          performanceRatioMax: 0.95,
          hspMin: 2,
          hspMax: 8,
          maxGenerationToConsumptionRatio: 1.0,
        },
      }),
    );
    expect(codes(r)).toContain('OVERSIZED_SYSTEM');
    expect(r.trafficLight).toBe(TrafficLight.GREEN);
  });

  it('vermelho tem precedência sobre amarelo', () => {
    const r = runQuickCalculation(
      reference({ availableAreaM2: 10, customerGroup: CustomerGroup.A }),
    );
    expect(r.trafficLight).toBe(TrafficLight.RED);
  });
});

describe('score de confiança', () => {
  it('desconta histórico incompleto, HSP manual e OCR fraco', () => {
    expect(
      runQuickCalculation(reference({ consumptionMonthlyKwh: Array<number>(6).fill(500) }))
        .confidenceScore,
    ).toBe(90);
    expect(runQuickCalculation(reference({ hspSource: 'MANUAL' })).confidenceScore).toBe(95);
    expect(runQuickCalculation(reference({ ocrConfidence: 0.5 })).confidenceScore).toBe(90);
    expect(runQuickCalculation(reference({ ocrConfidence: 0.95 })).confidenceScore).toBe(100);
  });

  it('desconta dado crítico ausente e nunca fica abaixo de zero', () => {
    const r = runQuickCalculation(
      reference({ missingCriticalData: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    );
    expect(r.confidenceScore).toBe(0);
  });
});

describe('validação de entrada', () => {
  it('rejeita entrada sem custo', () => {
    expect(() => runQuickCalculation(reference({ costPerWpCents: undefined }))).toThrow(ZodError);
  });

  it('rejeita HSP com menos de 12 meses, consumo vazio e PR zero', () => {
    expect(() => runQuickCalculation(reference({ hspMonthly: [5, 5] }))).toThrow(ZodError);
    expect(() => runQuickCalculation(reference({ consumptionMonthlyKwh: [] }))).toThrow(ZodError);
    expect(() => runQuickCalculation(reference({ performanceRatio: 0 }))).toThrow(ZodError);
  });
});

describe('funções puras', () => {
  it('weightedAverageHsp pondera pelos dias do mês', () => {
    const hsp = [...Array<number>(11).fill(4), 8];
    expect(weightedAverageHsp(hsp)).toBeCloseTo((4 * 334 + 8 * 31) / 365, 10);
    expect(() => weightedAverageHsp([1, 2])).toThrow(RangeError);
  });

  it('requiredPowerKwp e moduleCount validam argumentos', () => {
    expect(() => requiredPowerKwp(100, 0, 0.8)).toThrow(RangeError);
    expect(() => requiredPowerKwp(100, 5, 0)).toThrow(RangeError);
    expect(() => moduleCount(1, 0)).toThrow(RangeError);
    expect(moduleCount(0, 550)).toBe(0);
    expect(moduleCount(0.55, 550)).toBe(1); // sem módulo extra por ruído de ponto flutuante
    expect(moduleCount(0.551, 550)).toBe(2);
  });

  it('estimatedAreaM2, annualConsumption e compensationRatio', () => {
    expect(estimatedAreaM2(10, 2.5)).toBe(25);
    expect(annualConsumption(500)).toBe(6000);
    expect(compensationRatio(6000, 0)).toBe(0);
    expect(compensationRatio(6000, 500)).toBe(1);
  });

  it('monthlyGeneration valida tamanho e annualGeneration soma', () => {
    expect(() => monthlyGeneration(1, [1], 0.8)).toThrow(RangeError);
    expect(annualGeneration([1, 2, 3])).toBe(6);
  });

  it('investmentCents exige uma fonte de custo', () => {
    expect(investmentCents({ installedKwp: 1, costPerWpCents: 400 })).toBe(400_000);
    expect(() => investmentCents({ installedKwp: 1 })).toThrow(RangeError);
  });

  it('paybacks tratam economia nula', () => {
    expect(simplePaybackYears(1000, 0)).toBeNull();
    expect(
      cashFlowPaybackYears(0, [
        { year: 1, generationKwh: 0, compensatedKwh: 0, savingsCents: 0, cumulativeCents: 0 },
      ]),
    ).toBe(1);
  });
});
