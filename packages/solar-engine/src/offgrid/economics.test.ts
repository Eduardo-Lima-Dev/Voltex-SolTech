import { describe, expect, it } from 'vitest';
import { offgridEconomicsSchema } from '@voltex/shared';
import { evaluateOffgridEconomics } from './economics.js';

const economics = offgridEconomicsSchema.parse({
  horizonYears: 10,
  discountRatePct: 0,
  maintenancePctPerYear: 1,
  installationCostCents: 100_000,
  otherCostCents: 50_000,
  avoidedCostCentsPerKwh: 200,
});
const lines = [
  { id: 'm', description: 'Módulo', quantity: 4, category: 'MODULE' as const },
  { id: 'b', description: 'Bateria', quantity: 2, category: 'BATTERY' as const },
  { id: 'x', description: 'Sem preço', quantity: 1, category: 'INVERTER' as const },
];
const prices = { m: { unitCostCents: 50_000 }, b: { unitCostCents: 400_000 } };
const base = {
  lines,
  prices,
  economics,
  servedKwhPerYear: 1000,
  fuelLitersPerYear: 100,
  fuelPriceCentsPerLiter: 600,
  gridKwhPerYear: 200,
  gridTariffCentsPerKwh: 90,
  batteryLifeYears: 4,
};

describe('economia off-grid', () => {
  it('soma o CAPEX, aponta o item sem preço e calcula OPEX', () => {
    const r = evaluateOffgridEconomics(base);
    expect(r.capexCents).toBe(4 * 50_000 + 2 * 400_000 + 150_000);
    expect(r.missingPrices).toEqual(['Sem preço']);
    expect(r.capexItems[2]?.totalCents).toBeNull();
    expect(r.annualOpexCents).toBe(Math.round(1_000_000 * 0.01));
    expect(r.annualFuelCents).toBe(60_000);
    expect(r.annualGridCents).toBe(18_000);
  });

  it('inclui a troca do banco no fim da vida e o custo nivelado', () => {
    const noReplacement = evaluateOffgridEconomics({ ...base, batteryLifeYears: null });
    const replacement = evaluateOffgridEconomics(base);
    // vida de 4 anos em 10: trocas nos anos 4 e 8
    expect(replacement.npvCostCents - noReplacement.npvCostCents).toBe(2 * 800_000);
    expect(replacement.lcoeCentsPerKwh).toBeCloseTo(replacement.npvCostCents / 10_000, 2);
  });

  it('desconta a taxa e calcula economia e retorno quando há custo evitado', () => {
    const r = evaluateOffgridEconomics({
      ...base,
      economics: { ...economics, discountRatePct: 10 },
    });
    expect(r.npvCostCents).toBeLessThan(evaluateOffgridEconomics(base).npvCostCents);
    const rich = evaluateOffgridEconomics({ ...base, fuelLitersPerYear: 0, gridKwhPerYear: 0 });
    expect(rich.annualSavingsCents).toBeGreaterThan(0);
    expect(rich.paybackYears).toBeGreaterThan(0);
  });

  it('sem custo evitado não há economia nem retorno; energia nula não dá custo nivelado', () => {
    const r = evaluateOffgridEconomics({
      ...base,
      economics: { ...economics, avoidedCostCentsPerKwh: 0 },
      servedKwhPerYear: 0,
    });
    expect(r.annualSavingsCents).toBeNull();
    expect(r.paybackYears).toBeNull();
    expect(r.lcoeCentsPerKwh).toBeNull();
  });

  it('economia negativa não gera retorno', () => {
    const r = evaluateOffgridEconomics({
      ...base,
      economics: { ...economics, avoidedCostCentsPerKwh: 1 },
    });
    expect(r.paybackYears).toBeNull();
  });
});
