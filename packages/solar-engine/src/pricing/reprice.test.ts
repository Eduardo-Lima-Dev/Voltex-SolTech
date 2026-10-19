import { describe, expect, it } from 'vitest';
import { calculateQuick } from '../calculator/run.js';
import { quickCalculationInputSchema } from '../calculator/types.js';
import { repriceCashFlow } from './reprice.js';

const input = quickCalculationInputSchema.parse({
  consumptionMonthlyKwh: Array(12).fill(500),
  availabilityCostKwh: 30,
  hspMonthly: Array(12).fill(5),
  performanceRatio: 0.8,
  modulePowerWp: 550,
  moduleAreaM2: 2.58,
  tariffCentsPerKwh: 95,
  costPerWpCents: 450,
});
const result = calculateQuick(input);

describe('repriceCashFlow', () => {
  it('com o mesmo preço do cálculo, reproduz o payback e a economia do cálculo', () => {
    const repriced = repriceCashFlow(result.cashFlow, result.investmentCents);
    expect(repriced.simplePaybackYears).toBe(result.simplePaybackYears);
    expect(repriced.cashFlowPaybackYears).toBe(result.cashFlowPaybackYears);
    expect(repriced.accumulatedSavingsCents).toBe(result.accumulatedSavingsCents);
    expect(repriced.firstYearSavingsCents).toBe(result.firstYearSavingsCents);
    expect(repriced.cashFlow.at(-1)?.cumulativeCents).toBe(result.cashFlow.at(-1)?.cumulativeCents);
  });

  it('preço maior alonga o retorno; preço menor encurta; a economia não muda', () => {
    const base = repriceCashFlow(result.cashFlow, result.investmentCents);
    const dearer = repriceCashFlow(result.cashFlow, result.investmentCents * 1.5);
    const cheaper = repriceCashFlow(result.cashFlow, result.investmentCents * 0.5);
    expect(dearer.simplePaybackYears!).toBeGreaterThan(base.simplePaybackYears!);
    expect(cheaper.simplePaybackYears!).toBeLessThan(base.simplePaybackYears!);
    expect(dearer.accumulatedSavingsCents).toBe(base.accumulatedSavingsCents);
    expect(dearer.cashFlow[0]!.cumulativeCents).toBe(
      base.cashFlow[0]!.cumulativeCents - result.investmentCents * 0.5,
    );
  });

  it('sem retorno no horizonte, o payback pelo fluxo é nulo', () => {
    expect(repriceCashFlow(result.cashFlow, 10_000_000_000).cashFlowPaybackYears).toBeNull();
  });

  it('sem economia, o payback simples é nulo', () => {
    const none = repriceCashFlow([{ year: 1, savingsCents: 0 }], 1_000_000);
    expect(none.simplePaybackYears).toBeNull();
    expect(none.cashFlowPaybackYears).toBeNull();
  });

  it('lista vazia não quebra', () => {
    expect(repriceCashFlow([], 100_000)).toMatchObject({
      cashFlow: [],
      firstYearSavingsCents: 0,
      accumulatedSavingsCents: 0,
    });
  });
});
