import { describe, expect, it } from 'vitest';
import { evaluateEconomics } from './economics.js';

describe('evaluateEconomics', () => {
  it('calcula fluxo, paybacks, VPL, TIR e LCOE a partir de premissas explícitas', () => {
    const result = evaluateEconomics({
      capexCents: 100_000,
      annualGenerationKwh: 2_000,
      monthlyConsumptionKwh: 200,
      tariffCentsPerKwh: 100,
      tariffEscalationPct: 0,
      degradationPctPerYear: 0,
      opexPctOfCapex: 0,
      discountRatePct: 0,
      compensationFactor: 1,
      horizonYears: 2,
    });
    expect(result.years).toHaveLength(2);
    expect(result.years[0]).toMatchObject({ compensatedKwh: 2000, savingsCents: 200_000 });
    expect(result.simplePaybackYears).toBe(0.5);
    expect(result.discountedPaybackYears).toBe(0.5);
    expect(result.npvCents).toBe(300_000);
    expect(result.irrPct).toBeGreaterThan(99);
    expect(result.lcoeCentsPerKwh).toBe(25);
  });

  it('não mascara fluxo que nunca recupera o investimento', () => {
    const result = evaluateEconomics({
      capexCents: 10_000,
      annualGenerationKwh: 0,
      monthlyConsumptionKwh: 1,
      tariffCentsPerKwh: 100,
      tariffEscalationPct: 0,
      degradationPctPerYear: 0,
      opexPctOfCapex: 0,
      discountRatePct: 10,
      compensationFactor: 1,
      horizonYears: 1,
    });
    expect(result.simplePaybackYears).toBeNull();
    expect(result.irrPct).toBeNull();
    expect(result.lcoeCentsPerKwh).toBeNull();
  });
});

import {
  evaluateFinancing,
  evaluateScenarios,
  evaluateSensitivity,
  financingSchedule,
} from './economics.js';

const base = {
  capexCents: 100_000,
  annualGenerationKwh: 2_000,
  monthlyConsumptionKwh: 200,
  tariffCentsPerKwh: 10,
  tariffEscalationPct: 0,
  degradationPctPerYear: 0,
  opexPctOfCapex: 0,
  discountRatePct: 0,
  compensationFactor: 1,
  horizonYears: 5,
};

describe('financiamento', () => {
  it('Price com juros zero divide o principal igualmente', () => {
    expect(financingSchedule(120_000, 0, 12, 'PRICE')).toEqual(Array(12).fill(10_000));
  });
  it('Price tem parcela constante; SAC decresce e paga menos juros no total', () => {
    const price = financingSchedule(100_000, 12, 12, 'PRICE');
    const sac = financingSchedule(100_000, 12, 12, 'SAC');
    expect(Math.max(...price) - Math.min(...price)).toBeLessThanOrEqual(1);
    expect(sac[0]).toBeGreaterThan(sac[11]!);
    expect(sac.reduce((a, b) => a + b, 0)).toBeLessThan(price.reduce((a, b) => a + b, 0));
    // juros mensais: (1,12)^(1/12) − 1 = 0,9489% → 1ª parcela SAC = 8333,33 + 948,89
    expect(sac[0]).toBe(Math.round(100_000 / 12 + 100_000 * (1.12 ** (1 / 12) - 1)));
  });
  it('rejeita prazo inválido', () => {
    expect(() => financingSchedule(1, 0, 0, 'PRICE')).toThrow(RangeError);
  });
  it('fluxo de quem financia: entrada no ano 0, parcelas abatem a economia', () => {
    const econ = evaluateEconomics(base);
    const f = evaluateFinancing(
      100_000,
      { downPaymentPct: 20, annualRatePct: 0, termMonths: 24, system: 'PRICE' },
      econ,
      0,
    );
    expect(f).toMatchObject({
      principalCents: 80_000,
      downPaymentCents: 20_000,
      firstInstallmentCents: 3_333,
    });
    expect(Math.abs(f.totalInterestCents)).toBeLessThanOrEqual(24); // arredondamento da parcela em centavos
    expect(f.annualInstallmentsCents.slice(0, 3)).toEqual([39_996, 39_996, 0]);
    // economia 20.000/ano; ano 1 e 2: -20.000; anos 3-5: +20.000 → VPL(0%) = -20.000 -40.000 + 60.000 = 0
    expect(Math.abs(f.npvCents)).toBeLessThanOrEqual(10);
  });
});

describe('cenários e sensibilidade', () => {
  it('cenários alteram premissas sobre o caso-base e são limitados a três', () => {
    const r = evaluateScenarios(base, [
      { name: 'Geração -50%', generationFactor: 0.5 },
      { name: 'CAPEX x2', capexFactor: 2 },
    ]);
    const baseline = evaluateEconomics(base);
    expect(r[0]!.npvCents).toBeLessThan(baseline.npvCents);
    expect(baseline.simplePaybackYears).toBe(5);
    expect(r[1]!.simplePaybackYears).toBeNull();
    expect(() => evaluateScenarios(base, Array(4).fill({ name: 'x' }))).toThrow(RangeError);
  });
  it('tornado ordena pelo maior efeito no VPL', () => {
    const t = evaluateSensitivity(base, 10);
    expect(t).toHaveLength(6);
    for (let i = 1; i < t.length; i++)
      expect(t[i - 1]!.swingCents).toBeGreaterThanOrEqual(t[i]!.swingCents);
    const gen = t.find((x) => x.variable === 'GENERATION')!;
    // ±10% da geração: economia anual 20.000 ± 2.000 → VPL 0% em 5 anos varia ±10.000
    expect(gen.highNpvCents - gen.lowNpvCents).toBe(20_000);
    expect(t.find((x) => x.variable === 'DISCOUNT_RATE')!.swingCents).toBe(0);
  });
});
