import { describe, expect, it } from 'vitest';
import { GenerationClass, AlertSeverity, TrafficLight } from '@voltex/shared';
import {
  ALGORITHM_VERSION,
  azimuthDeviationDegrees,
  classifyGeneration,
  optimalAzimuthDegrees,
  performanceRatioFromLosses,
  recommendedTiltDegrees,
  runQuickCalculation,
  type QuickCalculationInput,
} from '../index.js';

const base = (o: Partial<QuickCalculationInput> = {}): QuickCalculationInput => ({
  consumptionMonthlyKwh: Array<number>(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array<number>(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
  ...o,
});
const codes = (r: ReturnType<typeof runQuickCalculation>) => r.alerts.map((a) => a.code);

describe('inclinação recomendada por latitude (EF-M04, Tabela 5.3)', () => {
  it.each([
    [0, 10],
    [5, 10],
    [10, 10],
    [11, 11],
    [15, 15],
    [20, 20],
    [21, 26],
    [23.5, 28.5],
    [30, 35],
    [31, 41],
    [35, 45],
    [40, 50],
    [41, 56],
    [60, 75],
  ])('latitude %f° → %f°', (latitude, expected) => {
    expect(recommendedTiltDegrees(latitude)).toBe(expected);
  });

  it('usa a latitude absoluta (hemisfério sul dá o mesmo resultado)', () => {
    expect(recommendedTiltDegrees(-23.5)).toBe(recommendedTiltDegrees(23.5));
    expect(recommendedTiltDegrees(-3.7)).toBe(10); // Fortaleza ≈ -3,7°
  });
});

describe('orientação (EF-M02)', () => {
  it('o azimute ideal é o Norte no hemisfério sul (padrão) e o Sul no hemisfério norte', () => {
    expect(optimalAzimuthDegrees()).toBe(0);
    expect(optimalAzimuthDegrees(-10)).toBe(0);
    expect(optimalAzimuthDegrees(2)).toBe(180);
  });

  it('a distância angular é a menor volta (0–180°)', () => {
    expect(azimuthDeviationDegrees(0, 0)).toBe(0);
    expect(azimuthDeviationDegrees(350, 0)).toBe(10);
    expect(azimuthDeviationDegrees(90, 0)).toBe(90);
    expect(azimuthDeviationDegrees(180, 0)).toBe(180);
    expect(azimuthDeviationDegrees(270, 0)).toBe(90);
    expect(azimuthDeviationDegrees(10, 350)).toBe(20);
  });

  it('avisa (sem mudar a cor) quando a face está longe do Norte', () => {
    const r = runQuickCalculation(base({ roofAzimuthDegrees: 180, latitude: -3.7 }));
    expect(codes(r)).toContain('ORIENTATION_NOT_OPTIMAL');
    expect(r.alerts.find((a) => a.code === 'ORIENTATION_NOT_OPTIMAL')?.severity).toBe(
      AlertSeverity.INFO,
    );
    expect(r.trafficLight).toBe(TrafficLight.GREEN);
    expect(runQuickCalculation(base({ roofAzimuthDegrees: 20 })).alerts).toEqual([]);
    expect(runQuickCalculation(base({ roofAzimuthDegrees: 45 })).alerts).toEqual([]); // no limite da tolerância
  });

  it('no hemisfério norte o ideal é o Sul', () => {
    expect(codes(runQuickCalculation(base({ roofAzimuthDegrees: 0, latitude: 2 })))).toContain(
      'ORIENTATION_NOT_OPTIMAL',
    );
    expect(
      codes(runQuickCalculation(base({ roofAzimuthDegrees: 180, latitude: 2 }))),
    ).not.toContain('ORIENTATION_NOT_OPTIMAL');
  });

  it('inclinação abaixo de 10° avisa (EF-M03); 10° ou mais não', () => {
    expect(codes(runQuickCalculation(base({ tiltDegrees: 5 })))).toContain(
      'TILT_BELOW_RECOMMENDED',
    );
    expect(codes(runQuickCalculation(base({ tiltDegrees: 10 })))).not.toContain(
      'TILT_BELOW_RECOMMENDED',
    );
    expect(codes(runQuickCalculation(base({ tiltDegrees: 0 })))).toContain(
      'TILT_BELOW_RECOMMENDED',
    );
  });

  it('devolve a inclinação recomendada só quando há latitude', () => {
    expect(runQuickCalculation(base()).recommendedTiltDegrees).toBeNull();
    expect(runQuickCalculation(base({ latitude: -23.5 })).recommendedTiltDegrees).toBe(28.5);
  });
});

describe('classe da geração (EF-M06)', () => {
  const limits = { microgenerationMaxKw: 75, minigenerationMaxKw: 5000 };

  it('classifica nos limites exatos', () => {
    expect(classifyGeneration(4.4, limits)).toBe(GenerationClass.MICRO);
    expect(classifyGeneration(75, limits)).toBe(GenerationClass.MICRO);
    expect(classifyGeneration(75.001, limits)).toBe(GenerationClass.MINI);
    expect(classifyGeneration(5000, limits)).toBe(GenerationClass.MINI);
    expect(classifyGeneration(5000.1, limits)).toBe(GenerationClass.UTILITY);
  });

  it('o resultado traz a classe e o limite é parametrizável', () => {
    expect(runQuickCalculation(base()).generationClass).toBe('MICRO');
    const big = runQuickCalculation(
      base({ consumptionMonthlyKwh: Array<number>(12).fill(15_000) }),
    );
    expect(big.installedPowerKwp).toBeGreaterThan(75);
    expect(big.generationClass).toBe('MINI');
    expect(codes(big)).toContain('MINIGENERATION_CLASS');
    expect(big.trafficLight).toBe(TrafficLight.YELLOW);
    expect(big.requiresEngineering).toBe(true);

    const custom = runQuickCalculation(base({ thresholds: { microgenerationMaxKw: 3 } as never }));
    expect(custom.generationClass).toBe('MINI');
  });

  it('usina (> 5 MW) é bloqueada como fora de escopo', () => {
    const huge = runQuickCalculation(
      base({ consumptionMonthlyKwh: Array<number>(12).fill(2_000_000) }),
    );
    expect(huge.generationClass).toBe('UTILITY');
    expect(huge.trafficLight).toBe(TrafficLight.RED);
    expect(codes(huge)).toContain('UTILITY_SCALE_OUT_OF_SCOPE');
  });
});

describe('performance ratio e premissas (EF-R08, EF-G01)', () => {
  it('sem PR nem perdas usa o padrão, avisa e registra a origem', () => {
    const { performanceRatio: _pr, ...rest } = base();
    const r = runQuickCalculation(rest);
    expect(r.assumptions).toMatchObject({
      performanceRatio: 0.8,
      performanceRatioSource: 'DEFAULT',
      losses: null,
    });
    expect(codes(r)).toContain('DEFAULT_PERFORMANCE_RATIO');
    expect(r.trafficLight).toBe(TrafficLight.GREEN);
    expect(r.installedPowerKwp).toBe(runQuickCalculation(base()).installedPowerKwp);
  });

  it('o PR padrão é um parâmetro (Rules Engine)', () => {
    const { performanceRatio: _pr, ...rest } = base();
    const r = runQuickCalculation({
      ...rest,
      thresholds: { defaultPerformanceRatio: 0.75 } as never,
    });
    expect(r.assumptions.performanceRatio).toBe(0.75);
    expect(r.moduleCount).toBeGreaterThan(runQuickCalculation(base()).moduleCount - 1);
  });

  it('PR informado é a origem INPUT e não gera aviso de padrão', () => {
    const r = runQuickCalculation(base({ performanceRatio: 0.82 }));
    expect(r.assumptions.performanceRatioSource).toBe('INPUT');
    expect(codes(r)).not.toContain('DEFAULT_PERFORMANCE_RATIO');
  });

  it('perdas se compõem multiplicativamente: PR = Π(1 − perda)', () => {
    expect(
      performanceRatioFromLosses({ temperatura: 0.1, sujeira: 0.05, cabos: 0.02 }),
    ).toBeCloseTo(0.9 * 0.95 * 0.98, 10);
    const { performanceRatio: _pr, ...rest } = base();
    const r = runQuickCalculation({
      ...rest,
      losses: { temperatura: 0.1, sujeira: 0.05, cabos: 0.02 },
    });
    expect(r.assumptions).toMatchObject({
      performanceRatioSource: 'LOSSES',
      performanceRatio: 0.8379,
    });
    expect(r.assumptions.losses).toEqual({ temperatura: 0.1, sujeira: 0.05, cabos: 0.02 });
  });

  it('informar PR e perdas ao mesmo tempo é recusado', () => {
    expect(() => runQuickCalculation(base({ losses: { a: 0.1 } }))).toThrow(/não os dois/);
    expect(() =>
      runQuickCalculation(base({ losses: { a: 1 } as never, performanceRatio: undefined })),
    ).toThrow();
  });

  it('perdas vazias equivalem a não informar', () => {
    const { performanceRatio: _pr, ...rest } = base();
    expect(runQuickCalculation({ ...rest, losses: {} }).assumptions.performanceRatioSource).toBe(
      'DEFAULT',
    );
  });

  it('o resultado carrega as premissas completas e a versão do algoritmo', () => {
    const r = runQuickCalculation(
      base({
        roofAzimuthDegrees: 10,
        tiltDegrees: 15,
        systemCostCents: 2_000_000,
        tariffEscalationRate: 0.05,
      }),
    );
    expect(r.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(ALGORITHM_VERSION).toBe('calc-1.1.0');
    expect(r.assumptions).toMatchObject({
      hspSource: 'DATASET',
      availabilityCostKwh: 30,
      tariffCentsPerKwh: 95,
      tariffEscalationRate: 0.05,
      moduleDegradationRate: 0.005,
      modulePowerWp: 550,
      moduleAreaM2: 2.58,
      horizonYears: 25,
      costModel: 'SYSTEM_COST',
      roofAzimuthDegrees: 10,
      tiltDegrees: 15,
    });
    expect(r.assumptions.thresholds.microgenerationMaxKw).toBe(75);
  });

  it('PR fora da faixa continua bloqueando também quando vem das perdas', () => {
    const { performanceRatio: _pr, ...rest } = base();
    const r = runQuickCalculation({ ...rest, losses: { tudo: 0.5 } });
    expect(r.trafficLight).toBe(TrafficLight.RED);
    expect(codes(r)).toContain('ASSUMPTION_OUT_OF_RANGE');
  });
});

describe('faixa típica de HSP (EF-M01)', () => {
  it('avisa fora de 4–6,5 (sem bloquear) e é silencioso dentro', () => {
    const low = runQuickCalculation(base({ hspMonthly: Array<number>(12).fill(3.5) }));
    expect(codes(low)).toContain('HSP_OUTSIDE_TYPICAL_RANGE');
    expect(low.trafficLight).toBe(TrafficLight.GREEN);
    expect(
      codes(runQuickCalculation(base({ hspMonthly: Array<number>(12).fill(6.4) }))),
    ).not.toContain('HSP_OUTSIDE_TYPICAL_RANGE');
    expect(
      codes(runQuickCalculation(base({ hspMonthly: Array<number>(12).fill(4.25) }))),
    ).not.toContain('HSP_OUTSIDE_TYPICAL_RANGE');
  });

  it('fora da faixa bloqueante (2–8) só aparece o bloqueio, não o aviso duplicado', () => {
    const r = runQuickCalculation(base({ hspMonthly: Array<number>(12).fill(1.5) }));
    expect(r.trafficLight).toBe(TrafficLight.RED);
    expect(codes(r)).not.toContain('HSP_OUTSIDE_TYPICAL_RANGE');
  });
});
